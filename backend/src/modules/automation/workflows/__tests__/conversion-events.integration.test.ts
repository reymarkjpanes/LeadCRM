import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { defaultContactForm } from '@leadcrm/shared';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { salesTransaction } from '../../../crm/leads/lead-automation.service';
import { convertClosedLead } from '../../../crm/leads/lead-conversion.service';
import { convertContact, updateContact } from '../../../crm/contacts/contacts.service';
import { listFields, saveField, saveValues } from '../../../crm/closing-requirements/closing-requirements.service';
import { submitPublicForm } from '../../../marketing/forms/public-forms.service';
import { createWorkflow } from '../workflows.service';
import * as triggers from '../../triggers/triggers.service';

vi.mock('../../../../shared/services/email.service', () => ({ sendMail: vi.fn().mockResolvedValue({ submitted: true }) }));
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('durable successful-sales conversion event parity', { timeout: 30000 }, () => {
  let tenantId: string, actorId: string, ownerId: string, pipelineId: string, qualifiedId: string, wonId: string, productId: string;
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const evidence = { 'confirmation-type': 'Approved Quotation', 'confirmation-date': '2026-10-01' };
  const activate = (trigger: string) => scope(() => createWorkflow(tenantId, actorId, {
    name: `${trigger} ${randomUUID()}`, trigger, isActive: true,
    actions: [trigger.startsWith('deal.') ? { type: 'create_task', config: { title: 'Conversion follow up', assignedUserId: ownerId } } : { type: 'update_field', config: { field: 'lastName', value: 'Conversion follow up' } }],
  }));
  const events = (entityId: string, type?: string) => prisma.workflowTriggerRecord.findMany({ where: { tenantId, entityId, ...(type ? { triggerType: type } : {}) }, orderBy: { triggerType: 'asc' } });
  async function inquiry(confirmed = false, extra: Record<string, unknown> = {}) {
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Conversion', lastName: 'Customer', email: `${randomUUID()}@example.test`,
      companyName: `Customer ${randomUUID()}`, status: 'Warm', assignedUserId: ownerId, productsNormalized: true,
      productLinks: { create: { productInterestId: productId, position: 0 } }, ...extra } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Original sale', assignedUserId: ownerId, pipelineId,
      stageId: confirmed ? wonId : qualifiedId, value: 125.5, currency: 'PHP', productInterestId: productId, productsNormalized: true,
      leadDeals: { create: { leadId: lead.id, position: 0 } }, ...(confirmed ? { wonConfirmedAt: new Date(), wonConfirmedById: actorId,
        hasEverBeenWon: true, wonHistoryVerified: true, closingValues: evidence, closingSnapshot: { fields: [], values: evidence } } : {}) } });
    return { lead, deal };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Conversion events', slug: randomUUID(), status: 'ACTIVE' } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: `${randomUUID()}@example.test`, firstName: 'Admin', lastName: 'Actor' } })).id;
    ownerId = (await prisma.user.create({ data: { tenantId, role: 'Sales', email: `${randomUUID()}@example.test`, firstName: 'Sales', lastName: 'Owner' } })).id;
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'contacts', 'deals', 'accounts', 'tasks'].map(module => ({ tenantId, roleId: role.id, module, canView: true, canEdit: true, canCreate: true })) });
    await prisma.userRole.create({ data: { tenantId, userId: ownerId, roleId: role.id } });
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Conversion pipeline' } })).id;
    qualifiedId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Qualified', order: 0 } })).id;
    wonId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Closed Deal', isWon: true, order: 1 } })).id;
    productId = (await prisma.productInterest.create({ data: { tenantId, name: 'Conversion Product', dealValue: 125.5 } })).id;
    await scope(async () => {
      const fields = await listFields(tenantId);
      for (const field of fields.filter(field => ['confirmation-type', 'confirmation-date'].includes(field.id))) {
        await saveField(tenantId, actorId, { required: true }, field.id);
      }
    });
  }, 30000);
  beforeEach(async () => { vi.restoreAllMocks(); await prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } }); });
  afterAll(async () => { vi.restoreAllMocks(); await prisma.$disconnect(); });

  it('automatically queues Lead and new Contact events once at Won, preserving every original Deal', async () => {
    for (const trigger of ['lead.updated', 'lead.status_changed', 'contact.created', 'deal.created', 'deal.updated', 'deal.closed_won']) await activate(trigger);
    const { lead, deal } = await inquiry();
    const historical = await prisma.deal.create({ data: { tenantId, pipelineId, stageId: wonId, title: 'Archived original sale', isArchived: true,
      value: 72.25, currency: 'USD', productInterestId: productId, assignedUserId: ownerId, wonConfirmedAt: new Date('2025-01-01'),
      leadDeals: { create: { leadId: lead.id, position: 0 } } } });
    const sibling = await prisma.deal.create({ data: { tenantId, pipelineId, stageId: qualifiedId, title: 'Another original opportunity',
      value: 55, currency: 'USD', productInterestId: productId, assignedUserId: ownerId, leadDeals: { create: { leadId: lead.id, position: 0 } } } });
    await scope(() => saveValues(tenantId, actorId, deal.id, { values: evidence }));
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    // The still-open sibling governs overall status while the successful sale converts the Lead.
    expect(converted).toMatchObject({ status: 'Inquiry', convertedById: actorId });
    expect(converted.convertedAt).toBeInstanceOf(Date);
    expect(await events(lead.id, 'lead.updated')).toHaveLength(1);
    expect(await events(lead.id, 'lead.status_changed')).toHaveLength(1);
    expect(await events(converted.contactId!, 'contact.created')).toHaveLength(1);
    // Closing writes the stage, engagement and relationships in one committed update.
    expect(await events(deal.id, 'deal.updated')).toHaveLength(1);
    expect(await events(deal.id, 'deal.closed_won')).toHaveLength(1);
    expect(await events(sibling.id, 'deal.updated')).toHaveLength(1);
    expect(await events(historical.id, 'deal.updated')).toHaveLength(0);
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId, triggerType: 'deal.created' } })).toBe(0);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).toBe(3);
    expect(await prisma.contactDeal.count({ where: { tenantId, contactId: converted.contactId! } })).toBe(3);
    expect(await prisma.leadDeal.count({ where: { tenantId, leadId: lead.id } })).toBe(3);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: historical.id } })).toMatchObject({ value: 72.25, currency: 'USD', productInterestId: productId, stageId: wonId, isArchived: true, wonConfirmedAt: historical.wonConfirmedAt });
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ value: 125.5, currency: 'PHP', productInterestId: productId });
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: sibling.id } })).toMatchObject({ value: 55, currency: 'USD', productInterestId: productId, stageId: qualifiedId, assignedUserId: ownerId });
    const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, entityId: lead.id, trigger: { triggerType: 'lead.updated' } } });
    expect(run.status).toBe('queued');
    expect((run.dispatchContext as any).context['event.changedFields']).toEqual(expect.arrayContaining(['contactId', 'accountId', 'convertedAt', 'convertedById']));
    const count = await prisma.workflowTriggerRecord.count({ where: { tenantId } });
    await scope(() => convertContact(lead.id, tenantId, actorId, { createContact: true, createDeal: false }));
    await scope(() => salesTransaction(tx => convertClosedLead(tx, tenantId, lead.id, actorId)));
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId } })).toBe(count);
  });

  it('manual conversion uses the same durable event contract and does not enqueue on replay', async () => {
    for (const trigger of ['lead.updated', 'lead.status_changed', 'contact.created', 'deal.created', 'deal.updated']) await activate(trigger);
    const { lead, deal } = await inquiry(true, { companyName: null });
    const original = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    const converted = await scope(() => convertContact(lead.id, tenantId, actorId, { createContact: true, createDeal: false, accountName: 'Manual selected company', dealId: deal.id }));
    expect(await events(lead.id, 'lead.updated')).toHaveLength(1);
    const transitions = await events(lead.id, 'lead.status_changed');
    expect(transitions).toHaveLength(1);
    expect(await prisma.workflowExecutionRun.findFirstOrThrow({ where: { triggerId: transitions[0].id } })).toMatchObject({
      dispatchContext: { context: { 'event.previousStatus': 'Warm', 'event.newStatus': 'Closed Deal' } },
    });
    expect(await events(converted.contact.id, 'contact.created')).toHaveLength(1);
    expect(await events(deal.id, 'deal.updated')).toHaveLength(1);
    expect(await events(deal.id, 'deal.created')).toHaveLength(0);
    const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, entityId: lead.id, trigger: { triggerType: 'lead.updated' } } });
    expect((run.dispatchContext as any).context['event.changedFields']).toEqual(expect.arrayContaining(['accountId', 'contactId', 'convertedAt', 'convertedById']));
    expect((run.dispatchContext as any).context['event.changedFields']).toContain('status');
    expect((run.dispatchContext as any).context['event.changedFields']).not.toContain('companyName');
    const persistedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(persistedLead).toMatchObject({ status: 'Closed Deal', companyName: null, convertedById: actorId, contactId: converted.contact.id });
    expect(await prisma.account.findUniqueOrThrow({ where: { id: persistedLead.accountId! } })).toMatchObject({ tenantId, name: 'Manual selected company' });
    const count = await prisma.workflowTriggerRecord.count({ where: { tenantId } });
    await scope(() => convertContact(lead.id, tenantId, actorId, { createContact: true, createDeal: false, contactId: randomUUID(), dealId: deal.id }));
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId } })).toBe(count);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ value: original.value, currency: original.currency, productInterestId: original.productInterestId, stageId: original.stageId, wonConfirmedAt: original.wonConfirmedAt, closingSnapshot: original.closingSnapshot });
  });

  it('reuses a matching Contact with update/status events and no creation event', async () => {
    for (const trigger of ['contact.created', 'contact.updated', 'contact.status_changed']) await activate(trigger);
    const { lead, deal } = await inquiry();
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Existing', lastName: 'Customer', email: lead.email, assignedUserId: ownerId, status: 'WARM' } });
    await scope(() => saveValues(tenantId, actorId, deal.id, { values: evidence }));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactId).toBe(contact.id);
    expect(await events(contact.id, 'contact.created')).toHaveLength(0);
    expect(await events(contact.id, 'contact.updated')).toHaveLength(1);
    expect(await events(contact.id, 'contact.status_changed')).toHaveLength(1);
    expect(await prisma.contact.count({ where: { tenantId, email: lead.email } })).toBe(1);
  });

  it('a historical Closed Lead edit emits one complete update while the converter emits Contact creation', async () => {
    for (const trigger of ['lead.updated', 'lead.status_changed', 'contact.created']) await activate(trigger);
    const { lead } = await inquiry(true, { status: 'Closed Deal' });
    await scope(() => updateContact(lead.id, tenantId, actorId, { status: 'Closed Deal', firstName: 'Edited during conversion' }));
    expect(await events(lead.id, 'lead.updated')).toHaveLength(1);
    expect(await events(lead.id, 'lead.status_changed')).toHaveLength(0);
    const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, entityId: lead.id, trigger: { triggerType: 'lead.updated' } } });
    expect((run.dispatchContext as any).context['event.changedFields']).toEqual(expect.arrayContaining(['firstName', 'contactId', 'convertedAt']));
    expect(await events((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactId!, 'contact.created')).toHaveLength(1);
  });

  it('does not infer confirmed sale evidence from a historical Closed Lead status alone', async () => {
    await activate('contact.created');
    const { lead } = await inquiry(false, { status: 'Closed Deal' });
    const where = { tenantId, triggerType: 'contact.created' };
    const previousCount = await prisma.workflowTriggerRecord.count({ where });
    await scope(() => updateContact(lead.id, tenantId, actorId, { status: 'Closed Deal', firstName: 'Edited without a confirmed sale' }));
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      firstName: 'Edited without a confirmed sale', contactId: null, convertedAt: null,
    });
    expect(await prisma.workflowTriggerRecord.count({ where })).toBe(previousCount);
  });

  it('a returning public Form inquiry queues conversion events once without creating another Product Deal', async () => {
    for (const trigger of ['lead.updated', 'lead.status_changed', 'contact.created', 'contact.updated', 'contact.status_changed', 'deal.created']) await activate(trigger);
    const { lead, deal } = await inquiry(true);
    const config = defaultContactForm();
    config.fields = config.fields.map(field => field.mapToField === 'productInterest' ? { ...field, required: false } : field);
    const form = await prisma.marketingForm.create({ data: { tenantId, createdById: actorId, name: config.name, status: 'published',
      fields: config.fields, design: config.design, settings: config.settings, publishedConfig: config, publishedVersion: 1 } });
    const input = { requestId: randomUUID(), version: 1, values: { firstName: lead.firstName, lastName: lead.lastName, email: lead.email, productInterest: [] } };
    await submitPublicForm(form.publicId, input);
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(await events(lead.id, 'lead.updated')).toHaveLength(1);
    const transitions = await events(lead.id, 'lead.status_changed');
    expect(transitions).toHaveLength(1);
    expect(await prisma.workflowExecutionRun.findFirstOrThrow({ where: { triggerId: transitions[0].id } })).toMatchObject({
      dispatchContext: { context: { 'event.previousStatus': 'Warm', 'event.newStatus': 'Closed Deal' } },
    });
    expect(await events(converted.contactId!, 'contact.created')).toHaveLength(1);
    expect(await events(deal.id, 'deal.created')).toHaveLength(0);
    const count = await prisma.workflowTriggerRecord.count({ where: { tenantId } });
    await submitPublicForm(form.publicId, input);
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId } })).toBe(count);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).toBe(1);
    const historical = await inquiry(true);
    const priorContact = await prisma.contact.create({ data: { tenantId, firstName: 'Changed', lastName: 'Email', email: `${randomUUID()}@example.test`, assignedUserId: ownerId, status: 'COLD' } });
    await prisma.contactDeal.create({ data: { tenantId, contactId: priorContact.id, dealId: historical.deal.id } });
    await submitPublicForm(form.publicId, { ...input, requestId: randomUUID(), values: { ...input.values, email: historical.lead.email } });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: historical.lead.id } })).contactId).toBe(priorContact.id);
    expect(await events(priorContact.id, 'contact.created')).toHaveLength(0);
    expect(await events(priorContact.id, 'contact.updated')).toHaveLength(1);
    expect(await events(priorContact.id, 'contact.status_changed')).toHaveLength(1);
    const run = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, entityId: historical.lead.id, trigger: { triggerType: 'lead.updated' } } });
    expect((run.dispatchContext as any).context['event.changedFields']).toContain('contactId');
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: historical.lead.id } } } })).toBe(1);
  });

  it('a combined Closed/Product/assignment edit converts without manufacturing another opportunity', async () => {
    await activate('deal.created');
    await activate('lead.updated');
    const { lead, deal } = await inquiry(true, { status: 'Closed Deal' });
    const added = await prisma.productInterest.create({ data: { tenantId, name: `Additional Product ${randomUUID()}`, dealValue: 950 } });
    const replacement = await prisma.user.create({ data: { tenantId, role: 'Sales', email: `${randomUUID()}@example.test`, firstName: 'New', lastName: 'Owner' } });
    const role = await prisma.roleDefinition.findFirstOrThrow({ where: { tenantId, name: 'Sales' } });
    await prisma.userRole.create({ data: { tenantId, roleId: role.id, userId: replacement.id } });
    await scope(() => updateContact(lead.id, tenantId, actorId, { status: 'Closed Deal', assignedUserId: replacement.id, productInterest: [productId, added.id] }));
    const converted = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(converted.contactId).toBeTruthy();
    expect(converted.productInterestIds.sort()).toEqual([productId, added.id].sort());
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: lead.id } } } })).toBe(1);
    expect(await prisma.contactDeal.findMany({ where: { tenantId, contactId: converted.contactId! }, select: { dealId: true } })).toEqual([{ dealId: deal.id }]);
    expect(await prisma.leadDeal.findMany({ where: { tenantId, leadId: lead.id }, select: { dealId: true } })).toEqual([{ dealId: deal.id }]);
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId, triggerType: 'deal.created' } })).toBe(0);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ value: 125.5, productInterestId: productId, stageId: wonId,
      assignedUserId: replacement.id, ownerId: deal.ownerId, revenueOwnerId: deal.revenueOwnerId, closingSnapshot: deal.closingSnapshot });
    const ordinary = await inquiry();
    await scope(() => updateContact(ordinary.lead.id, tenantId, actorId, { assignedUserId: replacement.id, productInterest: [productId, added.id] }));
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: ordinary.lead.id } } } })).toBe(2);
    const addedDeal = await prisma.deal.findFirstOrThrow({ where: { tenantId, productInterestId: added.id, leadDeals: { some: { leadId: ordinary.lead.id } } } });
    expect(addedDeal).toMatchObject({ value: 950, assignedUserId: replacement.id });
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: ordinary.deal.id } })).toMatchObject({ assignedUserId: replacement.id, ownerId: ordinary.deal.ownerId });
    expect(await events(addedDeal.id, 'deal.created')).toHaveLength(1);
  });

  it('a raw transaction caller binds conversion events to its transaction and rolls back when queue insertion fails', async () => {
    await activate('contact.created');
    const { lead, deal } = await inquiry(true, { status: 'Closed Deal' });
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    await expect(scope(() => prisma.$transaction(async tx => {
      const failing = new Proxy(tx, { get(target, key) {
        if (key === 'workflowTriggerRecord') return new Proxy(target.workflowTriggerRecord, { get(delegate, method) {
          if (method === 'createMany') return async () => { throw new Error('Queue insertion unavailable'); };
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(target, key);
      } });
      await convertClosedLead(failing, tenantId, lead.id, actorId);
    }, { timeout: 20000 }))).rejects.toThrow('Queue insertion unavailable');
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toEqual(before);
    expect(await prisma.contact.count({ where: { tenantId, email: lead.email } })).toBe(0);
    expect(await prisma.account.count({ where: { tenantId, name: lead.companyName! } })).toBe(0);
    expect(await prisma.contactDeal.count({ where: { tenantId, dealId: deal.id } })).toBe(0);
    expect(await prisma.activity.count({ where: { tenantId, leadId: lead.id, type: 'conversion' } })).toBe(0);
    expect(await events(lead.id)).toHaveLength(0);
    const converted = await scope(() => prisma.$transaction(tx => convertClosedLead(tx, tenantId, lead.id, actorId), { timeout: 20000 }));
    expect(await events(converted.contact.id, 'contact.created')).toHaveLength(1);
  });

  it('failed enqueue rolls the complete automatic Won transition and evidence back', async () => {
    await activate('contact.created');
    const { lead, deal } = await inquiry();
    const leadBefore = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const dealBefore = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    const historyBefore = await prisma.dealStageHistory.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { id: 'asc' } });
    const valuesBefore = await prisma.customFieldValue.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { id: 'asc' } });
    const triggerCount = await prisma.workflowTriggerRecord.count({ where: { tenantId } });
    vi.spyOn(triggers, 'fireContactCreated').mockRejectedValueOnce(new Error('Conversion queue unavailable'));
    await expect(scope(() => saveValues(tenantId, actorId, deal.id, { values: evidence }))).rejects.toThrow('Conversion queue unavailable');
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toEqual(leadBefore);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toEqual(dealBefore);
    expect(await prisma.contact.count({ where: { tenantId, email: lead.email } })).toBe(0);
    expect(await prisma.account.count({ where: { tenantId, name: lead.companyName! } })).toBe(0);
    expect(await prisma.dealStageHistory.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { id: 'asc' } })).toEqual(historyBefore);
    expect(await prisma.customFieldValue.findMany({ where: { tenantId, dealId: deal.id }, orderBy: { id: 'asc' } })).toEqual(valuesBefore);
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: lead.id, action: 'lead.converted' } })).toBe(0);
    expect(await prisma.workflowTriggerRecord.count({ where: { tenantId } })).toBe(triggerCount);
  });
});

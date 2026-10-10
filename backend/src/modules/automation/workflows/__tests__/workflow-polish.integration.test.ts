import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '../../../../config/database.config';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import * as workflows from '../workflows.service';
import { fireWorkflowTrigger } from '../workflow.engine';
import { fireDealStageChanged, fireDealCreated } from '../../triggers/triggers.service';
import { updateContact as updateLead } from '../../../crm/contacts/contacts.service';
import { updateContact } from '../../../crm/contacts-v2/contacts-v2.service';
import { updateCompany } from '../../../crm/companies/companies.service';
import { moveDealStage, updateDeal } from '../../../crm/deals/deals.service';
import { sendSms } from '../../../../shared/services/sms.service';
import { getAvailableActions, WORKFLOW_TRIGGERS, type WorkflowDraft } from '@leadcrm/shared';
import { getTasks } from '../../../operations/tasks/tasks.service';
import { saveField } from '../../../crm/closing-requirements/closing-requirements.service';
import { readRecordValues } from '../../../crm/closing-requirements/custom-field-values.repository';
import { entityContext } from '../workflows.repository';
import { getWorkflowConditionFields, getWorkflowUpdateFields } from '@leadcrm/shared';
vi.mock('../../../../shared/services/sms.service', async original => ({ ...await original<typeof import('../../../../shared/services/sms.service')>(), isSmsConfigured: () => true, sendSms: vi.fn(async () => ({ submitted: true, messageId: 'sms-test' })) }));
vi.mock('../../../../shared/services/email.service', async original => ({ ...await original<typeof import('../../../../shared/services/email.service')>(), sendMail: vi.fn(async () => ({ submitted: true, messageId: 'mail-test' })) }));
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/leadcrm_workflow_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('workflow polish with real persisted CRM records', { timeout: 30000 }, () => {
  let tenantId: string, actor: any, lead: any, contact: any, account: any, pipeline: any, initial: any, qualified: any, lost: any, won: any, others: any;
  const scope = <T>(fn: () => T) => tenantContext.run({ tenantId }, fn);
  const create = (extra: Partial<WorkflowDraft> = {}) => scope(() => workflows.createWorkflow(tenantId, actor.id, {
    name: `Polish ${randomUUID()}`, trigger: 'lead.updated', isActive: true,
    actions: [{ type: 'create_task', config: { title: 'Follow up', assignedUserId: actor.id } }], ...extra,
  }));
  const runs = (id: string) => scope(() => workflows.getWorkflowExecutions(id, tenantId));
  const newDeal = (extra = {}) => scope(() => prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: initial.id,
    title: 'Polish deal', value: 100, assignedUserId: actor.id, leadDeals: { create: { leadId: lead.id, position: 0 } }, contactDeals: { create: { contactId: contact.id, position: 0 } }, productInterests: [], tags: [], ...extra } }));
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Workflow polish', slug: `polish-${randomUUID()}`, status: 'ACTIVE' } })).id;
    actor = await prisma.user.create({ data: { tenantId, role: 'Client Admin', email: `polish-${randomUUID()}@camxian.com`, firstName: 'Test', lastName: 'Agent', emailVerified: new Date(), mustChangePassword: false } });
    await scope(async () => {
      account = await prisma.account.create({ data: { tenantId, name: 'Workflow account', assignedUserId: actor.id, tags: [], activeProducts: [], productInterests: [] } });
      lead = await prisma.lead.create({ data: { tenantId, firstName: 'Lead', lastName: 'Test', email: 'lead@example.test', phone: '+639171234567', assignedUserId: actor.id, productInterest: [] } });
      contact = await prisma.contact.create({ data: { tenantId, firstName: 'Contact', lastName: 'Test', email: 'contact@example.test', phone: '+639181234567', accountId: account.id, assignedUserId: actor.id, activeProducts: [], productInterests: [] } });
      others = await prisma.productInterest.create({ data: { tenantId, name: 'Others', dealValue: 0 } });
      pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Workflow pipeline' } });
      const stage = (name: string, order: number, extra = {}) => prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name, order, requiredFields: [], ...extra } });
      initial = await stage('Lead', 0); qualified = await stage('Qualified', 1); won = await stage('Won', 2, { isWon: true }); lost = await stage('Lost', 3, { isLost: true });
    });
  }, 60000);
  beforeEach(async () => { await scope(() => prisma.workflow.updateMany({ where: { tenantId }, data: { isActive: false } })); vi.mocked(sendSms).mockClear(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it.each([
    ['lead', 'leads', 'Text', 'Initial', 'Updated'],
    ['contact', 'contacts', 'Number', 10, 25],
    ['account', 'accounts', 'Dropdown', 'First', 'Second'],
    ['deal', 'deals', 'Date', '2026-10-01', '2026-10-02'],
  ] as const)('persists and evaluates %s Custom Fields through CRM services without recursive runs', async (entity, module, type, initialValue, nextValue) => {
    const record = entity === 'lead' ? lead : entity === 'contact' ? contact : entity === 'account' ? account : await newDeal();
    const field = await scope(() => saveField(tenantId, actor.id, { module, group: module === 'accounts' ? 'Notes' : module === 'deals' ? 'Additional Details' : 'Additional Information', name: `Workflow ${type}`, type, required: false, options: type === 'Dropdown' ? ['First', 'Second'] : [] }));
    const edit = (patch: any) => scope(() => entity === 'lead' ? updateLead(record.id, tenantId, actor.id, patch) : entity === 'contact' ? updateContact(record.id, tenantId, patch, actor.id) : entity === 'account' ? updateCompany(record.id, tenantId, actor.id, patch) : updateDeal(record.id, tenantId, actor.id, patch));
    await edit({ customFieldValues: { [field.id]: initialValue } });
    const workflow = await create({ trigger: `${entity}.updated`, conditions: { operator: 'AND', conditions: [{ field: `${entity}.customFieldValues.${field.id}`, operator: 'equals', value: initialValue }] }, actions: [{ type: 'update_field', config: { field: `customFieldValues.${field.id}`, value: nextValue } }] });
    await edit({ address: randomUUID() });
    expect(await scope(() => readRecordValues(prisma, tenantId, module, record.id))).toMatchObject({ [field.id]: nextValue });
    expect(await runs(workflow.id)).toHaveLength(1);
    expect((await runs(workflow.id))[0].status).toBe('completed');
    expect((await scope(() => entityContext(entity, record.id, tenantId)))![`${entity}.customFieldValues.${field.id}`]).toBe(nextValue);
    await edit({ customFieldValues: { [field.id]: nextValue } });
    expect(await runs(workflow.id)).toHaveLength(1);
    await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, false));
    const saved = await scope(() => workflows.updateWorkflow(workflow.id, tenantId, actor.id, { description: 'Edited while paused' }));
    expect(saved.status).toBe('PAUSED'); expect(saved.isActive).toBe(false);
    await scope(() => saveField(tenantId, actor.id, { active: false }, field.id));
    await expect(scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, true))).rejects.toThrow(/condition field/);
    expect(await scope(() => readRecordValues(prisma, tenantId, module, record.id))).toMatchObject({ [field.id]: nextValue });
    const copy = await scope(() => workflows.duplicateWorkflow(workflow.id, tenantId, actor.id));
    expect(copy.status).toBe('DRAFT'); expect(copy.isActive).toBe(false); expect(await runs(copy.id)).toHaveLength(0);
  });

  it.each(['contact', 'account'] as const)('uses normalized Product IDs for %s conditions and updates across rename', async entity => {
    const record = entity === 'contact' ? contact : account;
    const edit = (patch: any) => scope(() => entity === 'contact' ? updateContact(record.id, tenantId, patch, actor.id) : updateCompany(record.id, tenantId, actor.id, patch));
    await edit({ productInterestIds: [] });
    const product = await prisma.productInterest.create({ data: { tenantId, name: `Product ${randomUUID()}`, dealValue: 100 } });
    const workflow = await create({ trigger: `${entity}.updated`, conditions: { operator: 'AND', conditions: [{ field: `${entity}.productInterestIds`, operator: 'is_empty', value: null }] }, actions: [{ type: 'update_field', config: { field: 'productInterestIds', value: [product.id] } }] });
    await edit({ address: randomUUID() });
    expect((await runs(workflow.id))[0].status).toBe('completed');
    await prisma.productInterest.update({ where: { id: product.id }, data: { name: `Renamed ${randomUUID()}` } });
    const context = await scope(() => entityContext(entity, record.id, tenantId));
    expect(context![`${entity}.productInterestIds`]).toEqual([product.id]);
    await expect(create({ trigger: `${entity}.updated`, actions: [{ type: 'update_field', config: { field: 'productInterestIds', value: [randomUUID()] } }] })).rejects.toThrow(/available Product/);
    await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, false));
    const clear = await create({ trigger: `${entity}.updated`, actions: [{ type: 'update_field', config: { field: 'productInterestIds', clear: true } }] });
    await edit({ address: randomUUID() });
    expect((await runs(clear.id))[0].status).toBe('completed');
    expect((await scope(() => entityContext(entity, record.id, tenantId)))![`${entity}.productInterestIds`]).toEqual([]);
  });

  it('evaluates canonical previous/new status and rejects stale or no-op status events', async () => {
    await scope(() => updateLead(lead.id, tenantId, actor.id, { status: 'Cold' }));
    const workflow = await create({ trigger: 'lead.status_changed', conditions: { operator: 'AND', conditions: [
      { field: 'event.previousStatus', operator: 'equals', value: 'Cold' }, { field: 'event.newStatus', operator: 'equals', value: 'Warm' },
    ] } });
    await scope(() => updateLead(lead.id, tenantId, actor.id, { status: 'Warm' }));
    await scope(() => updateLead(lead.id, tenantId, actor.id, { status: 'Warm' }));
    expect(await runs(workflow.id)).toHaveLength(1);
    expect((await runs(workflow.id))[0].status).toBe('completed');
    await scope(() => fireWorkflowTrigger({ tenantId, actorId: actor.id, eventId: randomUUID(), triggerType: 'lead.status_changed', entityType: 'lead', entityId: lead.id, context: { 'event.previousStatus': 'Warm', 'event.newStatus': 'Cold', 'lead.status': 'Cold' } }));
    expect(await runs(workflow.id)).toHaveLength(1);
  });

  it('records a failed run for a missing actor and ignores metadata-only/retired field updates', async () => {
    const workflow = await create();
    const event = { tenantId, triggerType: 'lead.updated', entityType: 'lead', entityId: lead.id, eventId: randomUUID(), context: { 'event.changedFields': ['updatedAt', 'description'] } };
    await scope(() => fireWorkflowTrigger(event));
    expect(await runs(workflow.id)).toHaveLength(0);
    await scope(() => fireWorkflowTrigger({ ...event, context: { 'event.changedFields': ['address'] } }));
    const [run] = await runs(workflow.id);
    expect(run.status).toBe('failed'); expect(run.errorMessage).toMatch(/actor/);
    expect(run.steps.map(step => step.status)).toEqual(['failed', 'skipped']);
  });

  it('keeps dry run read-only and rejects hidden, foreign-module, and invalid custom values', async () => {
    const field = await scope(() => saveField(tenantId, actor.id, { module: 'leads', group: 'Additional Information', name: 'Workflow Long Text', type: 'Long Text', required: false }));
    const workflow = await create({ isActive: false, actions: [{ type: 'update_field', config: { field: `customFieldValues.${field.id}`, value: 'A detailed note' } }] });
    const before = await Promise.all([prisma.customFieldValue.count({ where: { tenantId } }), prisma.activity.count({ where: { tenantId } }), prisma.auditLog.count({ where: { tenantId } })]);
    expect((await scope(() => workflows.testWorkflow(workflow.id, tenantId, lead.id, actor.id))).valid).toBe(true);
    expect(await Promise.all([prisma.customFieldValue.count({ where: { tenantId } }), prisma.activity.count({ where: { tenantId } }), prisma.auditLog.count({ where: { tenantId } })])).toEqual(before);
    await expect(create({ actions: [{ type: 'update_field', config: { field: `customFieldValues.${field.id}`, value: 42 } }] })).rejects.toThrow();
    await expect(create({ trigger: 'contact.updated', actions: [{ type: 'update_field', config: { field: `customFieldValues.${field.id}`, value: 'Wrong module' } }] })).rejects.toThrow(/editable/);
    await scope(() => saveField(tenantId, actor.id, { visibleInForm: false }, field.id));
    const options = await scope(() => workflows.getOptions(tenantId, actor.id));
    expect(getWorkflowUpdateFields('lead', options.customFields).some(f => f.customFieldId === field.id)).toBe(false);
    expect(getWorkflowConditionFields('lead', undefined, options.customFields).some(f => f.customFieldId === field.id)).toBe(false);
  });

  it('advertises four update triggers, Contact labels and SMS but no retired actions', () => {
    expect(WORKFLOW_TRIGGERS.filter(t => t.type.endsWith('.updated')).map(t => t.type)).toEqual(['lead.updated', 'contact.updated', 'deal.updated', 'account.updated']);
    expect(WORKFLOW_TRIGGERS.some(t => t.label.includes('Client Profile'))).toBe(false);
    expect(getAvailableActions().map(a => a.type)).toContain('send_sms');
    expect(getAvailableActions().some(a => ['send_campaign', 'create_notification'].includes(a.type))).toBe(false);
  });
  it('runs once on entering Qualified, allows never-Won re-entry, ignores edits and retries', async () => {
    const deal = await newDeal();
    const workflow = await create({ trigger: 'deal.stage_changed', conditions: { operator: 'AND', conditions: [
      { field: 'deal.stageId', operator: 'equals', value: qualified.id }, { field: 'deal.hasEverBeenWon', operator: 'equals', value: false }, { field: 'deal.wonHistoryVerified', operator: 'equals', value: true },
    ] } });
    const transition = await scope(() => moveDealStage(deal.id, tenantId, actor.id, { stageId: qualified.id }));
    expect((await runs(workflow.id)).filter(r => r.status === 'completed')).toHaveLength(1);
    await scope(() => updateDeal(deal.id, tenantId, actor.id, { title: 'Edited while Qualified' }));
    await scope(() => moveDealStage(deal.id, tenantId, actor.id, { stageId: qualified.id }));
    await scope(() => fireDealStageChanged({ tenantId, actorId: actor.id, eventId: transition.stageHistory!.id, deal: transition.deal, newStageId: qualified.id, newStageName: 'Qualified', prevStageId: initial.id, isWon: false, isLost: false }));
    expect(await runs(workflow.id)).toHaveLength(1);
    await scope(() => moveDealStage(deal.id, tenantId, actor.id, { stageId: lost.id, lostReason: 'Changed plans' }));
    await scope(() => moveDealStage(deal.id, tenantId, actor.id, { stageId: qualified.id }));
    expect((await runs(workflow.id)).filter(r => r.status === 'completed')).toHaveLength(2);
    const already = await newDeal({ stageId: qualified.id });
    await scope(() => fireDealCreated({ tenantId, actorId: actor.id, deal: already }));
    expect((await runs(workflow.id)).filter(r => r.status === 'completed')).toHaveLength(2);
  });
  it('blocks Won exits and excludes historical Won and unverified histories from Qualified follow-up', async () => {
    const wonDeal = await newDeal({ stageId: won.id });
    await expect(scope(() => moveDealStage(wonDeal.id, tenantId, actor.id, { stageId: qualified.id }))).rejects.toThrow(/won/i);
    const workflow = await create({ trigger: 'deal.stage_changed' });
    for (const flags of [{ hasEverBeenWon: true }, { wonHistoryVerified: false }]) {
      const deal = await newDeal({ stageId: qualified.id, ...flags });
      await scope(() => fireDealStageChanged({ tenantId, actorId: actor.id, eventId: randomUUID(), deal, newStageId: qualified.id, newStageName: 'Qualified', prevStageId: lost.id, isWon: false, isLost: false }));
    }
    expect((await runs(workflow.id)).every(r => r.status === 'skipped')).toBe(true);
    expect(await runs(workflow.id)).toHaveLength(2);
  });
  it('emits real Lead, Contact, Account, and Deal updates but suppresses no-op saves', async () => {
    const deal = await newDeal();
    for (const [trigger, edit] of [
      ['lead.updated', () => updateLead(lead.id, tenantId, actor.id, { address: 'Changed lead' })],
      ['contact.updated', () => updateContact(contact.id, tenantId, { address: 'Changed contact' }, actor.id)],
      ['account.updated', () => updateCompany(account.id, tenantId, actor.id, { notes: 'Changed account' })],
      ['deal.updated', () => updateDeal(deal.id, tenantId, actor.id, { title: 'Changed deal' })],
    ] as const) {
      const workflow = await create({ trigger });
      await scope(edit); await scope(edit);
      expect(await runs(workflow.id), trigger).toHaveLength(1);
      expect((await runs(workflow.id))[0].status, trigger).toBe('completed');
    }
  });
  it('keeps workflow-created Deal tasks connected to the source Deal and its CRM records', async () => {
    const deal = await newDeal({ accountId: account.id });
    const workflow = await create({ trigger: 'deal.updated' });
    await scope(() => updateDeal(deal.id, tenantId, actor.id, { title: 'Workflow linked context' }));
    expect((await runs(workflow.id))[0].status).toBe('completed');
    const tasks = await scope(() => getTasks(tenantId, { dealId: deal.id }));
    expect(tasks.data).toHaveLength(1);
    expect(tasks.data[0].dealIds).toEqual([deal.id]);
    expect(tasks.data[0].relatedRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lead', id: lead.id }),
      expect.objectContaining({ kind: 'contact', id: contact.id }),
      expect.objectContaining({ kind: 'account', id: account.id }),
    ]));
  });
  it('treats empty and catalog Others separately without retired Lead details', async () => {
    const legacy = await create({ isActive: false, actions: [{ type: 'update_field', config: { field: 'productInterestIds', value: [others.id], otherDetails: 'Historical details' } }] });
    expect(legacy.actions[0].config.otherDetails).toBe('Historical details');
    await expect(scope(() => workflows.toggleWorkflow(legacy.id, tenantId, actor.id, true))).rejects.toThrow('retired product details');
    const workflow = await create({ conditions: { operator: 'AND', conditions: [{ field: 'lead.productInterestIds', operator: 'is_empty', value: null }] },
      actions: [{ type: 'update_field', config: { field: 'productInterestIds', value: [others.id] } }] });
    await scope(() => updateLead(lead.id, tenantId, actor.id, { address: randomUUID() }));
    const updated = await scope(() => prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id } }));
    expect(updated.productInterest).toEqual(['Others']); expect(updated).not.toHaveProperty('productInterestOther');
    expect(await runs(workflow.id)).toHaveLength(1); // own update cannot loop
    await scope(() => updateLead(lead.id, tenantId, actor.id, { address: randomUUID() }));
    expect((await runs(workflow.id)).filter(r => r.status === 'completed')).toHaveLength(1);
    await scope(() => updateLead(lead.id, tenantId, actor.id, { productInterest: [] }));
    // The still-active empty-interest workflow intentionally selects Others again.
    await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, false));
    const clearing = await create({ actions: [{ type: 'update_field', config: { field: 'productInterestIds', value: [others.id], clear: true } }] });
    await scope(() => updateLead(lead.id, tenantId, actor.id, { address: randomUUID() }));
    expect((await runs(clearing.id))[0].status).toBe('completed');
    const empty = await scope(() => prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id } }));
    expect(empty.productInterest).toEqual([]); expect(empty).not.toHaveProperty('productInterestOther');
  });
  it('preserves legacy price actions for review and prevents historical price changes', async () => {
    const deal = await newDeal({ productInterestId: others.id, productInterestIds: [others.id], productInterests: ['Others'] });
    const workflow = await create({ isActive: false, trigger: 'deal.updated', actions: [{ type: 'update_field', config: { field: 'value', value: 4321.5 } }] });
    await expect(scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, true))).rejects.toThrow(/historical snapshots/);
    // Simulate a workflow already active when the new pricing rule is deployed.
    await prisma.workflow.update({ where: { id: workflow.id }, data: { isActive: true, status: 'ACTIVE' } });
    await scope(() => updateDeal(deal.id, tenantId, actor.id, { priority: 'HIGH' }));
    const saved = await scope(() => prisma.deal.findFirstOrThrow({ where: { id: deal.id, tenantId } }));
    expect(saved.value).toBe(deal.value); expect(saved.title).toBe(deal.title); expect(saved.priority).toBe('HIGH');
    expect((await runs(workflow.id))[0].status).toBe('failed');
    await expect(create({ trigger: 'deal.updated', actions: [{ type: 'update_field', config: { field: 'id', value: 'bad' } }] })).rejects.toThrow(/editable/);
  });
  it('sends SMS once for an event and reports a missing phone without submission', async () => {
    const workflow = await create({ actions: [{ type: 'send_sms', config: { recipient: 'record', message: 'Hello {{first_name}}' } }] });
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), triggerType: 'lead.updated', entityType: 'lead', entityId: lead.id, context: { 'event.changedFields': ['address'] } };
    await scope(() => fireWorkflowTrigger(event)); await scope(() => fireWorkflowTrigger(event));
    expect(sendSms).toHaveBeenCalledTimes(1); expect((await runs(workflow.id))[0].status).toBe('completed');
    expect(sendSms).toHaveBeenCalledWith('+639171234567', 'Hello Lead');
    await scope(() => updateLead(lead.id, tenantId, actor.id, { phone: '' }));
    expect(sendSms).toHaveBeenCalledTimes(1); expect((await runs(workflow.id))[0].status).toBe('failed');
  });
  it('uses the explicitly selected SMS relationship for recipient personalization', async () => {
    const deal = await newDeal();
    const workflow = await create({ trigger: 'deal.updated', actions: [{ type: 'send_sms', config: { recipient: 'primary_contact', message: 'Hello {{first_name}}' } }] });
    await scope(() => updateDeal(deal.id, tenantId, actor.id, { title: 'SMS recipient test' }));
    expect(sendSms).toHaveBeenCalledWith('+639181234567', 'Hello Contact');
    expect((await runs(workflow.id))[0].status).toBe('completed');
  });
  it('preserves retired steps in drafts but refuses activation until they are disabled or removed', async () => {
    const workflow = await create({ isActive: false, actions: [{ type: 'create_notification', config: { title: 'Legacy' } }] });
    await expect(scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, true))).rejects.toThrow(/retired/);
    expect((await scope(() => workflows.getWorkflowById(workflow.id, tenantId))).actions).toEqual([{ type: 'create_notification', config: { title: 'Legacy' } }]);
  });
  it('rejects incomplete activation even after saving a draft, and preserves previously active blank literals', async () => {
    const conditions = { operator: 'AND' as const, conditions: [{ field: 'lead.firstName', operator: 'equals' as const, value: '' }] };
    await expect(create({ conditions })).rejects.toThrow('Condition 1: Enter a value');
    const draft = await create({ isActive: false, conditions });
    await expect(scope(() => workflows.toggleWorkflow(draft.id, tenantId, actor.id, true))).rejects.toThrow('Condition 1: Enter a value');
    await expect(scope(() => workflows.validateDraft(tenantId, actor.id, { name: draft.name, trigger: draft.trigger, conditions, actions: draft.actions, isActive: false, workflowId: draft.id }))).rejects.toThrow('Condition 1: Enter a value');
    // Represents a historical workflow that used a valid literal empty-string comparison.
    await scope(() => prisma.workflow.update({ where: { id: draft.id }, data: { status: 'PAUSED', activatedById: actor.id, conditions } }));
    await expect(scope(() => workflows.toggleWorkflow(draft.id, tenantId, actor.id, true))).resolves.toMatchObject({ isActive: true, conditions });
    await scope(() => fireWorkflowTrigger({ tenantId, actorId: actor.id, eventId: randomUUID(), triggerType: 'lead.updated', entityType: 'lead', entityId: lead.id, context: { 'event.changedFields': ['address'] } }));
    expect((await runs(draft.id))[0].status).toBe('skipped');
    await expect(scope(() => workflows.validateDraft(tenantId, actor.id, { name: draft.name, trigger: draft.trigger, conditions, actions: draft.actions, isActive: false, workflowId: draft.id }))).resolves.toMatchObject({ valid: true });
    const previouslyActive = await create({ conditions: { operator: 'AND', conditions: [{ field: 'lead.firstName', operator: 'equals', value: 'Fixture' }] } });
    const incomplete = await scope(() => workflows.updateWorkflow(previouslyActive.id, tenantId, actor.id, { isActive: false, conditions }));
    expect(incomplete.status).toBe('PAUSED');
    expect(incomplete.conditions).toMatchObject({ conditions: [{ value: '', incompleteValue: true }] });
    // Stripping client metadata cannot turn this newly missing input into a legacy literal.
    await scope(() => workflows.updateWorkflow(previouslyActive.id, tenantId, actor.id, { isActive: false, conditions }));
    await expect(scope(() => workflows.toggleWorkflow(previouslyActive.id, tenantId, actor.id, true))).rejects.toThrow('Condition 1: Enter a value');
    await expect(scope(() => workflows.validateDraft(tenantId, actor.id, { name: previouslyActive.name, trigger: previouslyActive.trigger, conditions, actions: previouslyActive.actions, isActive: false, workflowId: previouslyActive.id }))).rejects.toThrow('Condition 1: Enter a value');
    await expect(scope(() => workflows.updateWorkflow(previouslyActive.id, tenantId, actor.id, { isActive: true, conditions: { operator: 'AND', conditions: [{ field: 'lead.firstName', operator: 'equals', value: 'Fixture' }] } }))).resolves.toMatchObject({ isActive: true, conditions: { conditions: [{ value: 'Fixture' }] } });
    const foreign = await prisma.tenant.create({ data: { name: 'Foreign validation', slug: randomUUID() } });
    await expect(tenantContext.run({ tenantId: foreign.id }, () => workflows.validateDraft(foreign.id, actor.id, { name: draft.name, trigger: draft.trigger, conditions, actions: draft.actions, isActive: false, workflowId: draft.id }))).rejects.toThrow('Workflow not found');
  });
});

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
    title: 'Polish deal', value: 100, assignedUserId: actor.id, leadId: lead.id, contactId: contact.id, productInterests: [], tags: [], ...extra } }));
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
      ['lead.updated', () => updateLead(lead.id, tenantId, actor.id, { description: 'Changed lead' })],
      ['contact.updated', () => updateContact(contact.id, tenantId, { notes: 'Changed contact' }, actor.id)],
      ['account.updated', () => updateCompany(account.id, tenantId, actor.id, { notes: 'Changed account' })],
      ['deal.updated', () => updateDeal(deal.id, tenantId, actor.id, { title: 'Changed deal' })],
    ] as const) {
      const workflow = await create({ trigger });
      await scope(edit); await scope(edit);
      expect(await runs(workflow.id), trigger).toHaveLength(1);
      expect((await runs(workflow.id))[0].status, trigger).toBe('completed');
    }
  });
  it('treats empty and Others separately and persists optional details through Update Fields', async () => {
    const workflow = await create({ conditions: { operator: 'AND', conditions: [{ field: 'lead.productInterest', operator: 'is_empty', value: null }] },
      actions: [{ type: 'update_field', config: { field: 'productInterest', value: [others.id], otherDetails: 'Custom service' } }] });
    await scope(() => updateLead(lead.id, tenantId, actor.id, { description: randomUUID() }));
    const updated = await scope(() => prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id } }));
    expect(updated.productInterest).toEqual(['Others']); expect(updated.productInterestOther).toBe('Custom service');
    expect(await runs(workflow.id)).toHaveLength(1); // own update cannot loop
    await scope(() => updateLead(lead.id, tenantId, actor.id, { description: randomUUID() }));
    expect((await runs(workflow.id)).filter(r => r.status === 'completed')).toHaveLength(1);
    await scope(() => updateLead(lead.id, tenantId, actor.id, { productInterest: [] }));
    // The still-active empty-interest workflow intentionally selects Others again.
    await scope(() => workflows.toggleWorkflow(workflow.id, tenantId, actor.id, false));
    const clearing = await create({ actions: [{ type: 'update_field', config: { field: 'productInterest', value: [others.id], otherDetails: 'Saved details', clear: true } }] });
    await scope(() => updateLead(lead.id, tenantId, actor.id, { description: randomUUID() }));
    expect((await runs(clearing.id))[0].status).toBe('completed');
    const empty = await scope(() => prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id } }));
    expect(empty.productInterest).toEqual([]); expect(empty.productInterestOther).toBeNull();
  });
  it('supports a numeric Deal Value Custom Fields action and leaves unrelated fields intact', async () => {
    const deal = await newDeal({ productInterestId: others.id, productInterestIds: [others.id], productInterests: ['Others'] });
    const workflow = await create({ trigger: 'deal.updated', actions: [{ type: 'update_field', config: { field: 'value', value: 4321.5 } }] });
    await scope(() => updateDeal(deal.id, tenantId, actor.id, { priority: 'HIGH' }));
    const saved = await scope(() => prisma.deal.findFirstOrThrow({ where: { id: deal.id, tenantId } }));
    expect(saved.value).toBe(4321.5); expect(saved.title).toBe(deal.title); expect(saved.priority).toBe('HIGH');
    expect((await runs(workflow.id))[0].status).toBe('completed');
    await expect(create({ trigger: 'deal.updated', actions: [{ type: 'update_field', config: { field: 'id', value: 'bad' } }] })).rejects.toThrow(/editable/);
  });
  it('sends SMS once for an event and reports a missing phone without submission', async () => {
    const workflow = await create({ actions: [{ type: 'send_sms', config: { recipient: 'record', message: 'Hello {{first_name}}' } }] });
    const event = { tenantId, actorId: actor.id, eventId: randomUUID(), triggerType: 'lead.updated', entityType: 'lead', entityId: lead.id, context: { 'event.changedFields': ['description'] } };
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
});

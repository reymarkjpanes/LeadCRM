import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { replayCrmMigrations } from '../../../tests/replay-crm-migrations';
import { installTenantScoping } from '../../../core/tenant/tenant-prisma';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { crmActor } from '../access/crm-record-access.service';
import type { GmailEmail } from '../../../integrations/gmail/gmail.types';
import { EMPTY_PERMISSION_FLAGS, type CrmStatus } from '@leadcrm/shared';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('../../../config/database.config', () => ({ default: new Proxy({}, { get: (_target, property) => {
  const value = (holder.client as any)[property]; return typeof value === 'function' ? value.bind(holder.client) : value;
} }) }));
let pg: PGlite, socket: PGLiteSocketServer, db: PrismaClient;
let service: typeof import('../deals/deals.service');
let customer: typeof import('../customer-classification.service');
let ingestion: typeof import('../../../integrations/gmail/mailbox-ingestion.service');
let audiences: typeof import('../../marketing/campaigns/audiences.service');
let contactRepo: typeof import('../contacts-v2/contacts-v2.repository');
let tenantId: string, actorId: string, pipelineId: string, leadId: string, email: string, accountId: string;
let a: string, b: string;
let stages: Record<string, string>;
const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: actorId }, work));
const permissions = { leadsView: true, contactsView: true, leadsEdit: true, contactsEdit: true, dealsEdit: true, dealsView: true, clientAdmin: true };
beforeAll(async () => {
  pg = await PGlite.create(); await replayCrmMigrations(pg);
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
  db = new PrismaClient({ datasources: { db: { url: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1` } } });
  holder.client = db; installTenantScoping(db);
  service = await import('../deals/deals.service'); customer = await import('../customer-classification.service');
  ingestion = await import('../../../integrations/gmail/mailbox-ingestion.service');
  audiences = await import('../../marketing/campaigns/audiences.service');
  contactRepo = await import('../contacts-v2/contacts-v2.repository');
  tenantId = (await db.tenant.create({ data: { name: 'Status isolation', slug: randomUUID(), status: 'ACTIVE' } })).id;
  actorId = (await db.user.create({ data: { tenantId, email: 'status-admin@camxian.com', firstName: 'Status', lastName: 'Admin', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } })).id;
  pipelineId = (await db.pipeline.create({ data: { tenantId, name: 'Sales Pipeline' } })).id;
  stages = {};
  for (const [order, name] of ['Lead', 'Contacted', 'Qualified', 'Closed Deal', 'Cancelled'].entries()) stages[name] = (await db.stage.create({ data: { tenantId, pipelineId, name, order, isWon: name === 'Closed Deal', isLost: name === 'Cancelled', isDefault: name === 'Lead' } })).id;
  accountId = (await db.emailAccount.create({ data: { tenantId, userId: actorId, email: 'status-admin@camxian.com', accessToken: 'fixture', scopes: [], syncCursor: 'verified', lastSyncAt: new Date() } })).id;
}, 90000);
afterAll(async () => { await db?.$disconnect(); await socket?.stop(); await pg?.close(); });
beforeEach(async () => {
  await db.workflow.updateMany({ where: { tenantId }, data: { isActive: false } });
  email = `${randomUUID()}@example.test`;
  leadId = (await db.lead.create({ data: { tenantId, firstName: 'Lead', lastName: 'Fixture', email, phone: '+639123456789', assignedUserId: actorId } })).id;
  const ids = [];
  for (let i = 0; i < 2; i++) ids.push((await db.deal.create({ data: { tenantId, title: `Deal ${i}`, pipelineId, stageId: stages.Lead, assignedUserId: actorId, leadDeals: { create: { leadId } } } })).id);
  [a, b] = ids;
});
const deal = (id: string) => db.deal.findUniqueOrThrow({ where: { id } });
const person = () => db.lead.findUniqueOrThrow({ where: { id: leadId } });
async function editPerson(kind: 'lead' | 'contact', id: string, status: CrmStatus) {
  if (kind === 'lead') return scope(async () => (await import('../contacts/contacts.service')).updateContact(id, tenantId, actorId, { status }));
  return scope(async () => (await import('../contacts-v2/contacts-v2.service')).updateContact(id, tenantId, { status }, actorId));
}
async function qualificationWorkflow(matches = true) {
  const { createWorkflow } = await import('../../automation/workflows/workflows.service');
  const workflow = await scope(() => createWorkflow(tenantId, actorId, { name: `Qualification ${randomUUID()}`, trigger: 'deal.updated', isActive: true,
    conditions: { operator: 'AND', conditions: [{ field: 'deal.stageId', operator: 'equals', value: matches ? stages.Lead : stages.Contacted }] },
    actions: [{ type: 'move_deal_stage', config: { stageId: stages.Qualified } }] }));
  return workflow;
}
async function qualifyByWorkflow() {
  const workflow = await qualificationWorkflow();
  await scope(() => service.updateDeal(a, tenantId, actorId, { title: `Qualified ${randomUUID()}` }));
  const { flushWorkflowQueue } = await import('../../automation/workflows/__tests__/workflow-queue-test-helper');
  await flushWorkflowQueue(tenantId);
  const run = await db.workflowExecutionRun.findFirstOrThrow({ where: { tenantId, workflowId: workflow.id, status: 'completed' }, include: { steps: true } });
  expect(run.steps[0]).toMatchObject({ actionType: 'move_deal_stage', status: 'success', output: { movedDealIds: [a], stageId: stages.Qualified } });
  expect(await deal(a)).toMatchObject({ stageId: stages.Qualified, engagementStatus: 'Hot' });
  await db.workflow.update({ where: { id: workflow.id }, data: { isActive: false } });
  return { workflow, run, step: run.steps[0] };
}
async function ingest(direction: 'inbound' | 'outbound', dealId?: string, overrides: Partial<GmailEmail> = {}) {
  const threadId = overrides.threadId ?? randomUUID(), parent = `<parent-${randomUUID()}@example.test>`;
  if (dealId) await db.mailboxMessage.create({ data: { tenantId, accountId, providerMessageId: randomUUID(), threadId, direction: 'outbound', from: 'status-admin@camxian.com', fromAddress: 'status-admin@camxian.com', recipients: [email], recipientAddresses: [email], subject: 'Outreach', body: '', snippet: '', labels: ['SENT'], sentAt: new Date(Date.now() - 60000), leadId, dealId, dealAttribution: { kind: 'explicit_send' }, rfcMessageId: parent, engagementRuleVersion: 2, participantPolicyVersion: 1 } });
  const message: GmailEmail = { id: randomUUID(), threadId, from: direction === 'inbound' ? email : 'status-admin@camxian.com', to: [direction === 'inbound' ? 'status-admin@camxian.com' : email], subject: 'Reply', body: 'A real customer reply', snippet: '', date: new Date().toISOString(), labels: direction === 'inbound' ? ['INBOX'] : ['SENT'], direction, rfcMessageId: `<${randomUUID()}@example.test>`, ...(dealId ? { rfcInReplyTo: parent } : {}), ...overrides };
  const account = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } });
  await scope(() => ingestion.ingestMailboxMessages(account, [message], permissions));
  return { account, message };
}

describe('isolated Deal and inbound reply transitions', () => {
  it.each(['lead', 'contact'] as const)('records a manual %s Hot to Warm in its readable timeline with employee and time', async kind => {
    const record = kind === 'lead' ? await db.lead.update({ where: { id: leadId }, data: { status: 'Hot' } })
      : await db.contact.create({ data: { tenantId, firstName: 'Contact', lastName: 'Timeline', status: 'HOT', assignedUserId: actorId } });
    const sibling = await deal(b), selected = await deal(a), startedAt = new Date();
    if (kind === 'lead') await db.leadDeal.deleteMany({ where: { tenantId, leadId } });
    await editPerson(kind, record.id, 'Warm');
    const { findAllActivities } = await import('../activities/activities.repository');
    const page = await scope(() => findAllActivities(tenantId, { [`${kind}Id`]: record.id, type: 'stage_change' }));
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ title: 'Status changed from Hot to Warm', createdBy: { id: actorId, firstName: 'Status', lastName: 'Admin' },
      metadata: { previousStatus: 'Hot', newStatus: 'Warm', source: 'manual' } });
    expect(page.data[0].createdAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
    expect(await db.auditLog.count({ where: { tenantId, entityId: record.id, action: 'customer.status_changed' } })).toBe(1);
    expect(await deal(a)).toEqual(selected); expect(await deal(b)).toEqual(sibling);
  });
  it.each(['lead', 'contact'] as const)('does not record an unchanged legacy %s status', async kind => {
    const record = kind === 'lead' ? await db.lead.update({ where: { id: leadId }, data: { status: 'HOT' } })
      : await db.contact.create({ data: { tenantId, firstName: 'Unchanged', lastName: 'Contact', status: 'HOT', assignedUserId: actorId } });
    if (kind === 'lead') await db.leadDeal.deleteMany({ where: { tenantId, leadId } });
    await editPerson(kind, record.id, 'Hot');
    expect(await db.activity.count({ where: { tenantId, [`${kind}Id`]: record.id, type: 'stage_change' } })).toBe(0);
    expect(await db.auditLog.count({ where: { tenantId, entityId: record.id, action: 'customer.status_changed' } })).toBe(0);
  });
  it('records Hot to Cold once without a stage change and keeps existing Deal audit', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    const before = await deal(a), histories = await db.dealStageHistory.findMany({ where: { tenantId, dealId: a } });
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cold' }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cold' }));
    expect(await deal(a)).toMatchObject({ stageId: before.stageId, currentStageHistoryId: before.currentStageHistoryId, engagementStatus: 'Cold' });
    expect(await db.dealStageHistory.findMany({ where: { tenantId, dealId: a } })).toEqual(histories);
    const entries = await db.activity.findMany({ where: { tenantId, dealId: a, title: 'Deal engagement changed from Hot to Cold' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ createdById: actorId, metadata: { source: 'manual', previousStatus: 'Hot', newStatus: 'Cold', occurredAt: expect.any(String) } });
    expect(await db.auditLog.count({ where: { tenantId, entityId: a, action: 'deal.updated' } })).toBe(3);
  });
  it('moves a manually qualified Deal back to Contacted with distinct status and stage entries', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    const sibling = await deal(b);
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Contacted, engagementStatus: 'Warm' });
    const entries = await db.activity.findMany({ where: { tenantId, dealId: a, OR: [{ title: 'Deal engagement changed from Hot to Warm' }, { title: 'Deal moved from "Qualified" to "Contacted"' }] } });
    expect(entries).toHaveLength(2);
    expect(await person()).toMatchObject({ status: 'Warm' }); expect(await deal(b)).toEqual(sibling);
  });
  it('retains Workflow qualification and quotation evidence after Hot to Warm and later engagement edits', async () => {
    const { workflow } = await qualifyByWorkflow();
    // Current definitions can change after a committed execution; saved evidence remains authoritative.
    await db.workflow.update({ where: { id: workflow.id }, data: { actions: [] } });
    const receipt = await db.mailboxSendReceipt.create({ data: { tenantId, accountId, requestId: randomUUID(), payloadHash: 'qualification quotation', operation: 'send', status: 'sent',
      authorizationContext: { quotation: { fingerprint: 'a'.repeat(64), draft: { quotationId: randomUUID(), templateId: randomUUID(), recipientType: 'Lead', recipientId: leadId,
        dealId: a, products: [{ productId: randomUUID(), quantity: 1 }], quotationDate: '2026-11-01', validUntil: '2026-12-01', notes: '' } } } } });
    const before = await deal(a), sibling = await deal(b);
    const history = await db.dealStageHistory.findMany({ where: { tenantId, dealId: a } });
    for (const engagementStatus of ['Warm', 'Inquiry', 'Hot', 'Cold'] as const) {
      await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus }));
      expect(await deal(a)).toMatchObject({ stageId: stages.Qualified, currentStageHistoryId: before.currentStageHistoryId, engagementStatus });
    }
    expect(await db.dealStageHistory.findMany({ where: { tenantId, dealId: a } })).toEqual(history);
    expect(await db.mailboxSendReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
    expect(await deal(b)).toEqual(sibling); expect(await person()).toMatchObject({ status: 'Inquiry' });
  });
  it.each([true, false])('does not protect a Deal from a definition alone or unmet conditions (definition only=%s)', async definitionOnly => {
    const workflow = await qualificationWorkflow(false);
    if (!definitionOnly) {
      await scope(() => service.updateDeal(a, tenantId, actorId, { title: 'Unmatched conditions' }));
      const { flushWorkflowQueue } = await import('../../automation/workflows/__tests__/workflow-queue-test-helper');
      await flushWorkflowQueue(tenantId);
      expect(await db.workflowExecutionRun.findFirst({ where: { tenantId, workflowId: workflow.id }, include: { steps: true } })).toMatchObject({ status: 'skipped', steps: [{ status: 'skipped' }] });
    }
    await db.workflow.update({ where: { id: workflow.id }, data: { isActive: false } });
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Contacted, engagementStatus: 'Warm' });
  });
  it.each(['failed step', 'skipped step', 'failed run', 'skipped run', 'other Deal', 'other destination', 'other action', 'conflicting saved action', 'wrong source', 'missing output', 'outside action window'] as const)(
    'rejects qualification evidence with %s', async invalid => {
      const { run, step } = await qualifyByWorkflow();
      if (invalid === 'failed step' || invalid === 'skipped step') await db.workflowExecutionStep.update({ where: { id: step.id }, data: { status: invalid.split(' ')[0] } });
      else if (invalid === 'failed run' || invalid === 'skipped run') await db.workflowExecutionRun.update({ where: { id: run.id }, data: { status: invalid.split(' ')[0] } });
      else if (invalid === 'other Deal' || invalid === 'other destination' || invalid === 'missing output') await db.workflowExecutionStep.update({ where: { id: step.id }, data: { output: invalid === 'missing output' ? {} : { movedDealIds: [invalid === 'other Deal' ? b : a], stageId: invalid === 'other destination' ? stages.Contacted : stages.Qualified } } });
      else if (invalid === 'other action') await db.workflowExecutionStep.update({ where: { id: step.id }, data: { actionType: 'update_field' } });
      else if (invalid === 'outside action window') await db.workflowExecutionStep.create({ data: { tenantId, executionId: run.id, stepIndex: 1, actionType: 'create_task', status: 'skipped', executedAt: step.executedAt } });
      else await db.workflowExecutionStep.update({ where: { id: step.id }, data: { resolvedInput: { action: { type: 'move_deal_stage', config: { stageId: invalid === 'conflicting saved action' ? stages.Contacted : stages.Qualified, ...(invalid === 'wrong source' ? { currentStageId: stages.Contacted } : {}) } } } } });
      await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
      expect(await deal(a)).toMatchObject({ stageId: stages.Contacted, engagementStatus: 'Warm' });
    });
  it('does not reuse an older Workflow qualification after leaving and manually re-entering Qualified', async () => {
    await qualifyByWorkflow();
    await scope(() => service.moveDealStage(a, tenantId, actorId, { stageId: stages.Contacted }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Contacted, engagementStatus: 'Warm' });
  });
  it('accepts the saved run action when an older successful step has no resolved input', async () => {
    const { step } = await qualifyByWorkflow();
    await db.workflowExecutionStep.update({ where: { id: step.id }, data: { resolvedInput: {} } });
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Qualified, engagementStatus: 'Warm' });
  });
  it('rejects ambiguous re-entry even when it falls inside the same successful action window', async () => {
    const { run } = await qualifyByWorkflow();
    await scope(() => service.moveDealStage(a, tenantId, actorId, { stageId: stages.Contacted }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    await db.workflowExecutionRun.update({ where: { id: run.id }, data: { completedAt: new Date() } });
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Contacted, engagementStatus: 'Warm' });
  });
  it('does not use another tenant’s successful execution even with matching Deal and stage IDs in its output', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    const entry = await db.dealStageHistory.findUniqueOrThrow({ where: { id: (await deal(a)).currentStageHistoryId! } });
    const foreign = await db.tenant.create({ data: { name: 'Foreign execution', slug: randomUUID(), status: 'ACTIVE' } });
    const action = { type: 'move_deal_stage', config: { stageId: stages.Qualified } };
    const workflow = await db.workflow.create({ data: { tenantId: foreign.id, name: 'Other tenant', trigger: 'deal.updated', actions: [action] } });
    const trigger = await db.workflowTriggerRecord.create({ data: { tenantId: foreign.id, workflowId: workflow.id, triggerType: workflow.trigger, entityType: 'deal', entityId: a } });
    const run = await db.workflowExecutionRun.create({ data: { tenantId: foreign.id, workflowId: workflow.id, triggerId: trigger.id, entityType: 'deal', entityId: a, status: 'completed',
      startedAt: new Date(+entry.movedAt - 100), completedAt: new Date(), definitionSnapshot: { actions: [action] } } });
    await db.workflowExecutionStep.create({ data: { tenantId: foreign.id, executionId: run.id, actionType: 'move_deal_stage', status: 'success', stepIndex: 0,
      executedAt: new Date(+entry.movedAt - 50), output: { movedDealIds: [a], stageId: stages.Qualified } } });
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Contacted, engagementStatus: 'Warm' });
  });
  it.each(['lead', 'contact', 'deal'] as const)('rolls back %s status Activities and audits with their mutation', async kind => {
    const { salesTransaction } = await import('../leads/lead-automation.service');
    const contact = kind === 'contact' ? await db.contact.create({ data: { tenantId, firstName: 'Rollback', lastName: 'Contact', status: 'HOT', assignedUserId: actorId } }) : undefined;
    if (kind === 'lead') await db.leadDeal.deleteMany({ where: { tenantId, leadId } });
    const id = kind === 'deal' ? a : contact?.id ?? leadId;
    const activityCount = await db.activity.count({ where: { tenantId } }), auditCount = await db.auditLog.count({ where: { tenantId } });
    const before = kind === 'deal' ? await deal(id) : kind === 'lead' ? await person() : contact;
    await expect(scope(() => salesTransaction(async () => {
      if (kind === 'deal') await service.updateDeal(id, tenantId, actorId, { engagementStatus: 'Warm' });
      else await editPerson(kind, id, 'Warm');
      throw new Error('Forced rollback after Activity write');
    }))).rejects.toThrow('Forced rollback');
    expect(await db.activity.count({ where: { tenantId } })).toBe(activityCount);
    expect(await db.auditLog.count({ where: { tenantId } })).toBe(auditCount);
    expect(kind === 'deal' ? await deal(id) : kind === 'lead' ? await person() : await db.contact.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });
  it('keeps confirmed Won validation and writes no Activity for the rejected reopening', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Closed Deal' }));
    const before = await deal(a), count = await db.activity.count({ where: { tenantId } });
    await expect(scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Warm' }))).rejects.toThrow('confirmed sale cannot be reopened');
    expect(await deal(a)).toEqual(before);
    expect(await db.activity.count({ where: { tenantId } })).toBe(count);
  });
  it('cancels and reopens only the selected Deal and keeps Inquiry after a sweep', async () => {
    const before = await person(), sibling = await deal(b);
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cancelled', lostReason: 'Selected opportunity ended.' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Cancelled, engagementStatus: 'Cancelled' });
    expect(await deal(b)).toEqual(sibling); expect(await person()).toEqual(before);
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Inquiry' }));
    await scope(() => import('../leads/lead-automation.service').then(({ salesTransaction }) => salesTransaction(tx => customer.refreshDealClassification(tx, tenantId, a, actorId, [], new Date(Date.now() + 90 * 86400000)))));
    expect(await deal(a)).toMatchObject({ stageId: stages.Lead, engagementStatus: 'Inquiry', closedAt: null, lostReason: null });
    expect(await deal(b)).toEqual(sibling); expect(await person()).toEqual(before);
  });
  it('applies Warm, Hot and Inquiry-over-Cold to the customer without changing the sibling', async () => {
    const sibling = await deal(b);
    for (const [status, stage] of [['Warm', 'Contacted'], ['Hot', 'Qualified'], ['Cold', 'Qualified']] as const) {
      await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: status }));
      expect(await deal(a)).toMatchObject({ engagementStatus: status, stageId: stages[stage] });
      expect(await person()).toMatchObject({ status: status === 'Cold' ? 'Inquiry' : status });
    }
    expect(await deal(b)).toEqual(sibling);
  });
  it('protects a same-value Deal selection against scheduled aging', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Inquiry' }));
    expect((await deal(a)).manualStatusContext).toMatchObject({ source: 'manual', status: 'Inquiry' });
    await scope(() => import('../leads/lead-automation.service').then(({ salesTransaction }) => salesTransaction(tx => customer.refreshDealClassification(tx, tenantId, a, actorId, [], new Date(Date.now() + 90 * 86400000)))));
    expect(await deal(a)).toMatchObject({ engagementStatus: 'Inquiry', stageId: stages.Lead });
  });
  it('isolates cancellation and reopening for multiple Deals sharing a Contact', async () => {
    const contact = await db.contact.create({ data: { tenantId, firstName: 'Contact', lastName: 'Deals', email: `${randomUUID()}@example.test`, assignedUserId: actorId } });
    for (const id of [a,b]) {
      await db.leadDeal.deleteMany({ where: { tenantId, dealId: id } });
      await db.contactDeal.create({ data: { tenantId, dealId: id, contactId: contact.id } });
    }
    const sibling = await deal(b);
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cancelled', lostReason: 'Only this Deal.' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Cancelled, engagementStatus: 'Cancelled' });
    expect(await deal(b)).toEqual(sibling);
    expect(await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).toEqual(contact);
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Inquiry' }));
    expect(await deal(a)).toMatchObject({ stageId: stages.Lead, engagementStatus: 'Inquiry', lostReason: null });
    expect(await deal(b)).toEqual(sibling);
    expect(await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).toEqual(contact);
  });
  it('keeps outbound activity without changing customer status or entering Contacted', async () => {
    await ingest('outbound', a);
    expect(await person()).toMatchObject({ status: 'Inquiry' });
    expect(await deal(a)).toMatchObject({ engagementStatus: 'Inquiry', stageId: stages.Lead });
    expect(await db.activity.count({ where: { tenantId, leadId, type: 'email' } })).toBe(1);
  });
  it('warms one customer and moves only the explicitly attributed Deal on a fresh reply', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    const sibling = await deal(b);
    const { account, message } = await ingest('inbound', a);
    expect(await person()).toMatchObject({ status: 'Warm' });
    expect(await deal(a)).toMatchObject({ engagementStatus: 'Warm', stageId: stages.Contacted });
    expect(await deal(b)).toEqual(sibling);
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cold' }));
    await scope(() => ingestion.ingestMailboxMessages(account, [message], permissions));
    expect(await deal(a)).toMatchObject({ engagementStatus: 'Cold', stageId: stages.Contacted });
    expect(await db.activity.count({ where: { tenantId, leadId, type: 'email' } })).toBe(1);
  });
  it('does not guess a Deal for customer-only replies', async () => {
    await ingest('inbound');
    expect(await person()).toMatchObject({ status: 'Inquiry' });
    for (const id of [a, b]) expect(await deal(id)).toMatchObject({ engagementStatus: 'Inquiry', stageId: stages.Lead });
  });
  it('does not classify a Deal when a sender matches multiple customer records', async () => {
    await db.contact.create({ data: { tenantId, firstName: 'Duplicate', lastName: 'Identity', email, assignedUserId: actorId } });
    const before = await person(), selected = await deal(a);
    await ingest('inbound', a);
    expect(await person()).toEqual(before);
    expect(await deal(a)).toEqual(selected);
  });
  it('does not renew reply evidence from a duplicate RFC message in a different provider copy', async () => {
    const { account, message } = await ingest('inbound', a, { date: new Date(Date.now() - 60000).toISOString() });
    const before = await person();
    await scope(() => ingestion.ingestMailboxMessages(account, [{ ...message, id: randomUUID(), date: new Date().toISOString() }], permissions));
    expect((await person()).lastCustomerReplyAt).toEqual(before.lastCustomerReplyAt);
    expect((await deal(a)).manualStatusContext).toMatchObject({ source: 'reply', replyAt: message.date });
    expect(await db.mailboxMessage.count({ where: { tenantId, rfcMessageId: message.rfcMessageId, meaningful: true } })).toBe(1);
  });
  it.each([true, false])('prevents derived customer status from moving Deals back through workflows (associated=%s)', async associated => {
    const { createWorkflow, getWorkflowById } = await import('../../automation/workflows/workflows.service');
    const { flushWorkflowQueue } = await import('../../automation/workflows/__tests__/workflow-queue-test-helper');
    await db.deal.update({ where: { id: b }, data: { stageId: associated ? stages.Contacted : stages.Lead } });
    const legacy = { name: `Reply scoped action ${associated}`, trigger: 'lead.status_changed', isActive: true,
      conditions: { operator: 'AND', conditions: [{ field: 'event.newStatus', operator: 'equals', value: 'Warm' }] },
      actions: [{ type: 'move_deal_stage', config: { stageId: stages.Qualified, currentStageId: associated ? stages.Contacted : stages.Lead, targetMode: 'all_matching' } }] };
    await expect(scope(() => createWorkflow(tenantId, actorId, legacy))).rejects.toThrow('Use a Deal-based stage rule');
    expect(await db.workflow.count({ where: { tenantId, name: legacy.name } })).toBe(0);
    // Older saved definitions remain readable for repair and cannot feed derived status back into Deals.
    const saved = await db.workflow.create({ data: { ...legacy, tenantId, createdById: actorId, activatedById: actorId, status: 'ACTIVE' } });
    await ingest('inbound', associated ? a : undefined);
    await flushWorkflowQueue(tenantId);
    expect(await deal(a)).toMatchObject({ stageId: associated ? stages.Contacted : stages.Lead });
    expect(await deal(b)).toMatchObject({ stageId: associated ? stages.Contacted : stages.Lead });
    expect((await scope(() => getWorkflowById(saved.id, tenantId))).repairReason).toContain('Use a Deal-based stage rule');
  });
  it('retains the originating Deal through confirmed-sale conversion workflows', async () => {
    const { createWorkflow } = await import('../../automation/workflows/workflows.service');
    const { flushWorkflowQueue } = await import('../../automation/workflows/__tests__/workflow-queue-test-helper');
    await scope(() => createWorkflow(tenantId, actorId, { name: 'Converted Contact action', trigger: 'contact.created', isActive: true,
      actions: [{ type: 'move_deal_stage', config: { stageId: stages.Qualified, currentStageId: stages.Lead, targetMode: 'all_matching' } }] }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Hot' }));
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Closed Deal' }));
    await flushWorkflowQueue(tenantId);
    expect(await deal(a)).toMatchObject({ stageId: stages['Closed Deal'], engagementStatus: 'Closed Deal' });
    expect(await deal(b)).toMatchObject({ stageId: stages.Lead, engagementStatus: 'Inquiry' });
    const lead = await person(); expect(lead.status).toBe('Inquiry'); expect(lead.contactId).toBeTruthy();
    expect(await db.contact.findUniqueOrThrow({ where: { id: lead.contactId! } })).toMatchObject({ status: 'INQUIRY', lifecycleStage: 'CUSTOMER' });
  });
  it('preserves manual selections against delayed history and duplicate RFC identities', async () => {
    const { account, message } = await ingest('inbound', a);
    await db.leadDeal.deleteMany({ where: { tenantId, leadId, dealId: b } });
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cold' }));
    await scope(() => ingestion.ingestMailboxMessages(account, [{ ...message, id: randomUUID() }, { ...message, id: randomUUID(), rfcMessageId: '<old-newly-discovered@example.test>', date: new Date(Date.now() - 86400000).toISOString() }], permissions));
    expect(await person()).toMatchObject({ status: 'Cold' });
    expect(await deal(a)).toMatchObject({ engagementStatus: 'Cold' });
    await ingest('inbound', a);
    expect(await person()).toMatchObject({ status: 'Warm' });
    expect(await deal(a)).toMatchObject({ engagementStatus: 'Warm', stageId: stages.Contacted });
  });
  it('protects a same-value Contact selection and allows only a later genuine reply', async () => {
    const contact = await db.contact.create({ data: { tenantId, firstName: 'Contact', lastName: 'Fixture', email: `${randomUUID()}@example.test`, assignedUserId: actorId } });
    await scope(() => contactRepo.updateContact(contact.id, tenantId, { status: 'Inquiry' }, actorId));
    const saved = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(saved.manualStatusContext).toMatchObject({ source: 'manual', status: 'Inquiry' });
    await scope(() => import('../leads/lead-automation.service').then(({ salesTransaction }) => salesTransaction(tx => customer.classifyCustomerRecord(tx, tenantId, { contactId: contact.id }, actorId, {}, new Date(Date.now() + 90 * 86400000)))));
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe('INQUIRY');
    email = contact.email!;
    await ingest('inbound');
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe('WARM');
  });
  it('keeps cancelled terminal records closed to email activity', async () => {
    await scope(() => service.updateDeal(a, tenantId, actorId, { engagementStatus: 'Cancelled', lostReason: 'Ended' }));
    await scope(() => service.updateDeal(b, tenantId, actorId, { engagementStatus: 'Cancelled', lostReason: 'Other Deal ended' }));
    await ingest('inbound', a);
    expect(await person()).toMatchObject({ status: 'Cancelled' });
    expect(await deal(a)).toMatchObject({ stageId: stages.Cancelled, engagementStatus: 'Cancelled' });
  });
  it('returns scoped canonical phone/email options and evaluates a saved condition unchanged', async () => {
    const fields = await scope(() => audiences.audienceFieldsWithOptions(tenantId, 'LEADS'));
    expect(fields.find(field => field.technicalKey === 'email')?.options).toContain(email);
    expect(fields.find(field => field.technicalKey === 'phone')?.options).toContain('+639123456789');
    const result = await scope(() => audiences.previewAudience(tenantId, { source: 'LEADS', conditions: [{ field: 'email', operator: 'equals', value: email }], channel: 'EMAIL', page: 1, limit: 25 }));
    expect(result.recipients.map(row => row.id)).toContain(leadId);
    const byPhone = await scope(() => audiences.previewAudience(tenantId, { source: 'LEADS', conditions: [{ field: 'phone', operator: 'equals', value: '+639123456789' }, { field: 'email', operator: 'equals', value: email }], channel: 'EMAIL', page: 1, limit: 25 }));
    expect(byPhone.recipients.map(row => row.id)).toContain(leadId);
  });
  it('isolates both audience pickers by source, assignment, active state and tenant', async () => {
    const role = await db.roleDefinition.create({ data: { tenantId, name: randomUUID(), permissions: { create: ['leads', 'contacts'].map(module => ({ ...EMPTY_PERMISSION_FLAGS, module, canView: true, canViewAll: true })) } } });
    const agent = await db.user.create({ data: { tenantId, firstName: 'Picker', lastName: 'Agent', email: `${randomUUID()}@camxian.com`, role: role.name, userRoles: { create: { roleId: role.id } } } });
    const foreign = await db.tenant.create({ data: { name: 'Other picker tenant', slug: randomUUID(), status: 'ACTIVE' } });
    for (const source of ['LEADS', 'CONTACTS'] as const) {
      const create = source === 'LEADS' ? db.lead.create.bind(db.lead) : db.contact.create.bind(db.contact);
      const ownEmail = `${randomUUID()}@example.test`, ownPhone = '+639998887777';
      await create({ data: { tenantId, firstName: 'Own', lastName: 'Value', assignedUserId: agent.id, email: ownEmail, phone: ownPhone } });
      for (const data of [{ tenantId, isArchived: true, assignedUserId: agent.id }, { tenantId, assignedUserId: actorId }, { tenantId: foreign.id }]) await create({ data: { ...data, firstName: 'Hidden', lastName: 'Value', email: `${randomUUID()}@example.test`, phone: '+639111110000' } });
      const fields = await tenantContext.run({ tenantId }, () => crmActor.run({ tenantId, userId: agent.id }, () => audiences.audienceFieldsWithOptions(tenantId, source)));
      expect(fields.find(field => field.technicalKey === 'email')?.options).toEqual([ownEmail]);
      expect(fields.find(field => field.technicalKey === 'phone')?.options).toEqual([ownPhone]);
    }
  });
  it('does not move a Deal whose verified participants do not match the replying customer', async () => {
    const other = await db.lead.create({ data: { tenantId, firstName: 'Other', lastName: 'Customer', email: `${randomUUID()}@example.test`, assignedUserId: actorId } });
    const foreign = await db.deal.create({ data: { tenantId, title: 'Other customer Deal', pipelineId, stageId: stages.Lead, assignedUserId: actorId, leadDeals: { create: { leadId: other.id } } } });
    await ingest('inbound', foreign.id);
    expect(await person()).toMatchObject({ status: 'Inquiry' });
    for (const id of [a,b,foreign.id]) expect(await deal(id)).toMatchObject({ stageId: stages.Lead, engagementStatus: 'Inquiry' });
  });
  it('inventories archived IDs and active dependency blockers without performing deletion', async () => {
    await db.deal.update({ where: { id: a }, data: { isArchived: true } });
    const { inventoryArchived } = require('../../../../scripts/inventory-archived-records.cjs');
    const before = await db.deal.count();
    const manifest = await inventoryArchived(db, tenantId);
    const archived = manifest.records.find((row: { id: string }) => row.id === a);
    expect(archived).toMatchObject({ table: 'Deal', id: a, proposedForDeletion: false });
    expect(archived.blockers).toContain('Dependency links active records: LeadDeal');
    expect(await db.deal.count()).toBe(before);
  });
});

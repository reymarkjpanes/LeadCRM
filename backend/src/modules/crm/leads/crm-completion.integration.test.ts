import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { issueAuthSession } from '../../../core/auth/auth-session';
import { salesPipeline, salesTransaction } from './lead-automation.service';
import { saveValues } from '../closing-requirements/closing-requirements.service';
import { moveDealStage } from '../deals/deals.repository';
import { updateContact as updateLead } from '../contacts/contacts.repository';
import { ingestMailboxMessages } from '../../../integrations/gmail/mailbox-ingestion.service';
import { dispatchTenantNotifications as dispatchBatch, dispatchTaskReminders, deliverEvent } from '../../notifications/notification-events.service';
import { createNotification } from '../../notifications/notifications.service';
import { writeAuditLog } from '../../../core/audit/audit.service';
import app from '../../../app';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
async function dispatchTenantNotifications(tenantId: string, now = new Date()) {
  for (let batch = 0; batch < 100; batch++) if (!(await dispatchBatch(tenantId, now, 100)).claimed) break;
}
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_completion_test_1')('CRM completion with real database and HTTP', () => {
  let tenantId: string, adminId: string, agentId: string, otherAgentId: string, foreignId: string, token: string, agentToken: string, otherToken: string;
  let pipelineId: string, stages: Record<string, string>, server: Server, base: string;
  const scope = <T>(run: () => T) => tenantContext.run({ tenantId }, run);
  const before = new Date(Date.now() - 86400000);
  async function call(path: string, method = 'GET', body?: unknown, auth = token) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function customer(companyName: string | null = 'Example Company', count = 2) {
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Customer', lastName: 'Test', email: `${randomUUID()}@example.test`, companyName,
      productInterest: ['Camera', 'Access Control'], assignedUserId: agentId, createdAt: before, source: 'Website' } });
    const deals = [];
    for (let n = 0; n < count; n++) deals.push(await prisma.deal.create({ data: { tenantId, leadDeals: { create: { leadId: lead.id, position: 0 } }, pipelineId, stageId: stages.Qualified,
      title: `Deal ${n}`, productInterests: [n === 0 ? 'Camera' : 'Access Control'], value: 100 + n, assignedUserId: agentId, createdAt: before,
      closingValues: { 'reference-number': `REF-${randomUUID()}` }, tags: [] } }));
    return { lead, deals };
  }
  const close = (id: string) => scope(() => saveValues(tenantId, adminId, id, { values: { 'confirmation-type': 'Approved Quotation', 'confirmation-date': new Date().toISOString().slice(0, 10) } }));
  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Completion tests', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
    tenantId = tenant.id;
    const user = async (name: string, role: string, target = tenantId) => prisma.user.create({ data: { tenantId: target, firstName: name, lastName: 'Test', email: `${name}@camxian.com`, role, status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const admin = await user('admin', 'Client Admin'); adminId = admin.id; token = (await issueAuthSession(admin)).token;
    const adminRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true } });
    await prisma.userRole.create({ data: { tenantId, roleId: adminRole.id, userId: adminId } });
    const agent = await user('sales', 'Sales Rep'); agentId = agent.id; agentToken = (await issueAuthSession(agent)).token;
    const other = await user('other', 'Sales Rep'); otherAgentId = other.id; otherToken = (await issueAuthSession(other)).token;
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Sales Rep' } });
    await prisma.rolePermission.createMany({ data: ['leads', 'contacts', 'deals', 'tasks'].map(module => ({ tenantId, roleId: role.id, module, canView: true, canCreate: true, canEdit: true })) });
    await prisma.userRole.createMany({ data: [agentId, otherAgentId].map(userId => ({ tenantId, roleId: role.id, userId })) });
    const foreign = await prisma.tenant.create({ data: { name: 'Foreign', slug: randomUUID() } });
    foreignId = (await user('foreign', 'Client Admin', foreign.id)).id;
    pipelineId = (await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)))).pipeline.id;
    stages = Object.fromEntries((await prisma.stage.findMany({ where: { tenantId, pipelineId } })).map(stage => [stage.name, stage.id]));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('converts Closed transactionally, hides the Lead, preserves all Deals and exposes source activity', async () => {
    const { lead, deals } = await customer();
    const activity = await prisma.activity.create({ data: { tenantId, leadId: lead.id, createdById: adminId, type: 'note', title: 'Original audit history' } });
    const result = await close(deals[0].id); expect(result.locked).toBe(true);
    const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved).toMatchObject({ status: 'Closed', isArchived: false }); expect(saved.convertedAt).not.toBeNull();
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: saved.contactId! } });
    expect(contact).toMatchObject({ status: 'CLOSED', accountId: saved.accountId, assignedUserId: agentId });
    expect(saved.accountId).toBeTruthy();
    expect((await call(`/crm/leads?search=${lead.email}`)).body.data).toEqual([]);
    expect((await call(`/crm/contacts/${contact.id}`)).body.data.status).toBe('Closed');
    expect((await call(`/crm/contacts/${contact.id}/relationships`)).body.data.activities.map((row: { id: string }) => row.id)).toContain(activity.id);
    for (const original of deals) {
      const persisted = await prisma.deal.findUniqueOrThrow({ where: { id: original.id }, include: { leadDeals: true } });
      expect(persisted).toMatchObject({ id: original.id, leadDeals: [{ leadId: lead.id }], value: original.value, productInterests: original.productInterests, assignedUserId: agentId, accountId: saved.accountId });
      expect(await prisma.contactDeal.count({ where: { contactId: contact.id, dealId: original.id } })).toBe(1);
    }
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[1].id } })).stageId).toBe(stages.Qualified);
    expect(await prisma.activity.count({ where: { leadId: lead.id, type: 'conversion' } })).toBe(1);
    await scope(() => moveDealStage(deals[0].id, tenantId, stages['Closed Won'], adminId));
    expect(await prisma.activity.count({ where: { leadId: lead.id, type: 'conversion' } })).toBe(1);
  });
  it('reuses normalized email and company identity while retaining prior Contact history', async () => {
    const { lead, deals } = await customer('  EXAMPLE   company ');
    const existing = await prisma.contact.create({ data: { tenantId, email: ` ${lead.email!.toUpperCase()} `, firstName: 'Existing', lastName: 'Customer', notes: 'Keep this history', productInterests: ['Prior Product'], activeProducts: [] } });
    const count = await prisma.account.count({ where: { tenantId } });
    await close(deals[0].id);
    const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved.contactId).toBe(existing.id); expect(await prisma.account.count({ where: { tenantId } })).toBe(count);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: existing.id } })).notes).toBe('Keep this history');
  });
  it('preserves Contact without a fabricated Account and does not match only by name', async () => {
    const { lead, deals } = await customer(null, 1);
    await close(deals[0].id);
    const saved = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved.contactId).toBeTruthy(); expect(saved.accountId).toBeNull();
  });
  it('rolls back stage, evidence, Account and conversion when Contact identity is ambiguous', async () => {
    const { lead, deals } = await customer('Rollback Company', 1);
    for (let n = 0; n < 2; n++) await prisma.contact.create({ data: { tenantId, firstName: 'Duplicate', lastName: String(n), email: lead.email, productInterests: [], activeProducts: [] } });
    await expect(close(deals[0].id)).rejects.toThrow('matches found');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedAt).toBeNull();
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).stageId).toBe(stages.Qualified);
    expect(await prisma.account.count({ where: { tenantId, name: 'Rollback Company' } })).toBe(0);
  });
  it('manual Closed update requires successful Won and then performs the same conversion', async () => {
    const { lead, deals } = await customer(null, 1);
    await expect(scope(() => updateLead(lead.id, tenantId, { status: 'Closed' }, adminId))).rejects.toThrow('Closed Won');
    await prisma.deal.update({ where: { id: deals[0].id }, data: { stageId: stages['Closed Won'], wonConfirmedAt: new Date(), wonConfirmedById: adminId } });
    await scope(() => updateLead(lead.id, tenantId, { status: 'Closed' }, adminId));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).contactId).toBeTruthy();
  });
  it('legacy conversion endpoint uses successful sales, reuses explicit relations and is idempotent', async () => {
    const { lead, deals } = await customer('Do not duplicate company', 1);
    expect((await call(`/crm/leads/${lead.id}/convert`, 'POST', {})).status).toBe(400);
    const account = await prisma.account.create({ data: { tenantId, name: 'Explicit company' } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Known', lastName: 'Person', email: 'different@example.test', accountId: account.id } });
    await prisma.deal.update({ where: { id: deals[0].id }, data: { accountId: account.id, stageId: stages['Closed Won'], wonConfirmedAt: new Date() } });
    const result = await call(`/crm/leads/${lead.id}/convert`, 'POST', { contactId: contact.id });
    expect(result.status).toBe(200); expect(result.body.data.contact).toMatchObject({ id: contact.id, status: 'Closed', accountId: account.id });
    expect((await call(`/crm/leads/${lead.id}/convert`, 'POST', {})).status).toBe(200);
    expect(await prisma.activity.count({ where: { tenantId, leadId: lead.id, type: 'conversion' } })).toBe(1);
  });
  it('creates separate custom-field rows, updates by ID, preserves values and enforces RBAC', async () => {
    const input = { name: 'New evidence', type: 'Text', appliesTo: 'Closed Won Requirements', required: false, active: true, options: [], description: '' };
    const created = await call('/administration/closing-requirements', 'POST', input);
    expect(created.status).toBe(200); const field = created.body.data;
    expect(field.id).toBeTruthy(); expect(field.version).toBe(1);
    expect(await prisma.closingFieldDefinition.count({ where: { tenantId, id: field.id } })).toBe(1);
    const { deals } = await customer(null, 1);
    await prisma.deal.update({ where: { id: deals[0].id }, data: { closingValues: { [field.id]: 'Existing evidence' } } });
    expect((await call(`/administration/closing-requirements/${field.id}`, 'PATCH', { ...input, name: 'Edited evidence' })).body.data).toMatchObject({ id: field.id, version: 2 });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).closingValues).toMatchObject({ [field.id]: 'Existing evidence' });
    expect((await call('/administration/closing-requirements', 'POST', input, agentToken)).status).toBe(403);
  });
  it('engagement updates status but retired configuration cannot enable Deal-stage changes', async () => {
    const { lead, deals } = await customer(null);
    await prisma.deal.updateMany({ where: { leadDeals: { some: { leadId: lead.id } } }, data: { stageId: stages.Lead, stageChangedAt: before } });
    const account = await prisma.emailAccount.create({ data: { tenantId, userId: agentId, email: 'sales@camxian.com', accessToken: 'test-only', scopes: [], connectedAt: before } });
    const message = (subject: string) => ({ id: randomUUID(), threadId: randomUUID(), rfcMessageId: randomUUID(), from: lead.email!, to: [account.email], subject,
      body: 'We want to proceed with the product purchase.', snippet: 'Purchase request', date: new Date().toISOString(), isRead: false, labels: ['INBOX'] });
    const rights = { leadsView: true, contactsView: true, leadsEdit: true, contactsEdit: true, dealsEdit: true, dealsView: true };
    await scope(() => ingestMailboxMessages(account, [message('Camera quotation')], rights));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('Hot');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).stageId).toBe(stages.Lead);
    await scope(() => ingestMailboxMessages(account, [message('Camera quotation')], rights));
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[0].id } })).stageId).toBe(stages.Lead);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deals[1].id } })).stageId).toBe(stages.Lead);
    await prisma.deal.updateMany({ where: { leadDeals: { some: { leadId: lead.id } } }, data: { stageId: stages.Lead, stageChangedAt: before } });
    await scope(() => ingestMailboxMessages(account, [message('Product quotation')], rights));
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: lead.id } }, stageId: stages.Lead } })).toBe(2);
    await scope(() => ingestMailboxMessages(account, [{ ...message('Camera cancellation'), body: 'Please cancel my order. We are no longer interested.' }], rights));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('Hot');
    expect(await prisma.deal.count({ where: { leadDeals: { some: { leadId: lead.id } }, stageId: stages.Lead } })).toBe(2);
  });
  it('delivers role/owner notifications, deduplicates retries and never creates a foreign recipient', async () => {
    await scope(() => dispatchTenantNotifications(tenantId));
    const count = await prisma.notification.count({ where: { tenantId } }); expect(count).toBeGreaterThan(0);
    await scope(() => dispatchTenantNotifications(tenantId));
    expect(await prisma.notification.count({ where: { tenantId } })).toBe(count);
    expect(await prisma.notification.count({ where: { tenantId, userId: otherAgentId } })).toBe(0);
    for (const type of ['deal_won', 'closing_requirements_completed', 'customer_hot']) expect(await prisma.notification.count({ where: { tenantId, userId: adminId, type } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { tenantId, type: 'customer_cancelled' } })).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId, userId: agentId, type: 'customer_reply' } })).toBeGreaterThan(0);
    await deliverEvent({ tenantId, eventKey: 'foreign-attempt', type: 'lead_assigned', title: 'Test', ownerId: foreignId });
    expect(await prisma.notification.count({ where: { tenantId, userId: foreignId } })).toBe(0);
  });
  it('persists read state, counts all unread rows and prevents another user reading or marking the feed', async () => {
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Feed', lastName: 'Fixture', assignedUserId: agentId } });
    for (let n = 0; n < 25; n++) await createNotification({ tenantId, userId: agentId, eventKey: `test:${n}`, type: 'contact_assigned', title: `Notification ${n}`, entityType: 'Contact', entityId: contact.id });
    const mine = await call('/notifications?limit=2', 'GET', undefined, agentToken);
    expect(mine.body.data).toHaveLength(2); expect(mine.body.unreadCount).toBeGreaterThan(25); expect(mine.body.meta.hasMore).toBe(true);
    const id = mine.body.data[0].id;
    await call(`/notifications/${id}/read`, 'PATCH', undefined, otherToken);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).isRead).toBe(false);
    const other = await call(`/notifications?userId=${agentId}`, 'GET', undefined, otherToken); expect(other.status).toBe(400);
    await call(`/notifications/${id}/read`, 'PATCH', undefined, agentToken);
    expect((await call('/notifications?limit=2', 'GET', undefined, agentToken)).body.unreadCount).toBe(mine.body.unreadCount - 1);
    await call('/notifications/read-all', 'PATCH', undefined, agentToken);
    expect((await call('/notifications', 'GET', undefined, agentToken)).body.unreadCount).toBe(0);
  });
  it('assigns Task reminders to their owners once per due date and does not fail CRM writes on notification errors', async () => {
    const task = await prisma.task.create({ data: { tenantId, title: 'Assigned task', assignedUserId: agentId, dueDate: new Date(Date.now() + 3600000) } });
    await writeAuditLog({ tenantId, userId: adminId, action: 'task.created', entityType: 'Task', entityId: task.id, after: { title: task.title, assignedUserId: agentId } });
    await scope(() => dispatchTenantNotifications(tenantId));
    await scope(() => dispatchTaskReminders(tenantId, new Date(Date.now() + 7200000)));
    await scope(() => dispatchTaskReminders(tenantId, new Date(Date.now() + 7200000)));
    expect(await prisma.notification.count({ where: { tenantId, entityId: task.id, userId: agentId } })).toBe(3);
    let fail = true;
    prisma.$use(async (params, next) => { if (fail && params.model === 'Notification' && params.action === 'create') { fail = false; throw Error('Unavailable'); } return next(params); });
    await expect(createNotification({ tenantId, userId: agentId, eventKey: 'failure', type: 'task_assigned', title: 'Test', entityType: 'Task', entityId: task.id })).rejects.toThrow('Unavailable');
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });
  it('orders all requested modules globally before pagination and honors manual sorting', async () => {
    const prefix = `Sort-${randomUUID()}`;
    const older = new Date(Date.now() - 60000), newer = new Date(Date.now() - 30000);
    const paths = ['/crm/leads', '/crm/contacts', '/crm/accounts', '/marketing/campaigns', '/automation/workflows', '/administration/users', '/operations/tasks'];
    const pairs: string[][] = paths.map(() => []);
    for (const [index, createdAt] of [older, newer].entries()) {
      const name = `${prefix}-${index === 0 ? 'A' : 'Z'}`;
      pairs[0].push((await prisma.lead.create({ data: { tenantId, firstName: name, lastName: 'Order', createdAt } })).id);
      pairs[1].push((await prisma.contact.create({ data: { tenantId, firstName: name, lastName: 'Order', createdAt } })).id);
      pairs[2].push((await prisma.account.create({ data: { tenantId, name, createdAt } })).id);
      pairs[3].push((await prisma.campaign.create({ data: { tenantId, name, type: 'EMAIL', createdAt } })).id);
      pairs[4].push((await prisma.workflow.create({ data: { tenantId, name, trigger: 'lead.created', actions: [], createdAt } })).id);
      pairs[5].push((await prisma.user.create({ data: { tenantId, firstName: name, lastName: 'Order', email: `${randomUUID()}@camxian.com`, role: 'Sales Rep', createdAt } })).id);
      pairs[6].push((await prisma.task.create({ data: { tenantId, title: name, assignedUserId: agentId, createdAt, dueDate: new Date(Date.now() + (index + 1) * 86400000) } })).id);
    }
    for (const [index, path] of paths.entries()) {
      const query = `${path}?search=${prefix}&limit=1`;
      const first = await call(query), second = await call(`${query}&page=2`);
      expect(first.status, path).toBe(200); expect(first.body.data[0]?.id, path).toBe(pairs[index][1]);
      expect(second.body.data[0]?.id, path).toBe(pairs[index][0]);
      const field = index < 2 ? 'firstName' : index === 5 ? 'firstName' : index === 6 ? 'title' : 'name';
      const manual = await call(`${query}&${index === 6 ? 'sortBy=title&sortOrder=asc' : `sort=${field}:asc`}`);
      expect(manual.body.data[0]?.id, `${path} manual`).toBe(pairs[index][0]);
    }
    await prisma.lead.update({ where: { id: pairs[0][0] }, data: { isArchived: true, deletedAt: older } });
    await prisma.campaign.update({ where: { id: pairs[3][0] }, data: { isArchived: true } });
    await prisma.auditLog.create({ data: { tenantId, userId: adminId, action: 'campaign.archived', entityType: 'Campaign', entityId: pairs[3][0], createdAt: newer } });
    expect((await call('/administration/archived-data?limit=1')).body.data[0]?.id).toBe(pairs[3][0]);
    expect((await call('/administration/archived-data?limit=1&page=2')).body.data[0]?.id).toBe(pairs[0][0]);
  });
  it('delivers reassignment, lost, failure and mailbox alerts once to the correct roles', async () => {
    const { lead, deals } = await customer(null, 1);
    await scope(() => updateLead(lead.id, tenantId, { assignedUserId: otherAgentId }, adminId));
    await scope(() => moveDealStage(deals[0].id, tenantId, stages['Closed Lost'], adminId, undefined, undefined, 'Customer declined'));
    const workflow = await prisma.workflow.create({ data: { tenantId, name: 'Failed workflow', trigger: 'lead.created', actions: [] } });
    const trigger = await prisma.workflowTriggerRecord.create({ data: { tenantId, workflowId: workflow.id, triggerType: 'lead.created', entityType: 'Lead', entityId: lead.id } });
    await prisma.workflowExecutionRun.create({ data: { tenantId, workflowId: workflow.id, triggerId: trigger.id, entityType: 'Lead', entityId: lead.id, status: 'failed', completedAt: new Date() } });
    await prisma.campaign.create({ data: { tenantId, name: 'Failed campaign', type: 'EMAIL', failedCount: 1, createdById: agentId } });
    const statusUser = await prisma.user.create({ data: { tenantId, firstName: 'Account', lastName: 'Status', email: randomUUID()+'@camxian.com', role: 'Sales Rep' } });
    await prisma.user.update({ where: { id: statusUser.id }, data: { status: 'INACTIVE' } });
    await writeAuditLog({ tenantId, userId: adminId, action: 'lead.restored', entityType: 'Lead', entityId: lead.id });
    const form = await prisma.marketingForm.create({ data: { tenantId, name: 'Failed form', createdById: adminId } });
    await writeAuditLog({ tenantId, userId: adminId, action: 'form.processing_failed', entityType: 'Form', entityId: form.id });
    const mailbox = await prisma.emailAccount.update({ where: { tenantId_userId_provider: { tenantId, userId: agentId, provider: 'gmail' } }, data: { isActive: false } });
    await scope(() => dispatchTenantNotifications(tenantId));
    expect(await prisma.notification.count({ where: { userId: otherAgentId, entityId: lead.id, type: 'lead_assigned' } })).toBe(1);
    for (const type of ['deal_lost', 'workflow_failed', 'campaign_failed', 'user_created', 'user_status_changed', 'record_restored', 'form_processing_failed', 'mailbox_disconnected']) expect(await prisma.notification.count({ where: { tenantId, userId: adminId, type } }), type).toBeGreaterThan(0);
    await prisma.emailAccount.update({ where: { id: mailbox.id }, data: { isActive: true, syncError: 'Persistent test error' } });
    await scope(() => dispatchTenantNotifications(tenantId));
    await scope(() => dispatchTenantNotifications(tenantId, new Date(Date.now() + 16 * 60000)));
    expect(await prisma.notification.count({ where: { tenantId, userId: agentId, type: 'mailbox_sync_failed' } })).toBe(1);
    const count = await prisma.notification.count({ where: { tenantId } });
    await scope(() => dispatchTenantNotifications(tenantId, new Date(Date.now() + 16 * 60000)));
    expect(await prisma.notification.count({ where: { tenantId } })).toBe(count);
  });
  it('retries failed notification delivery without changing the CRM event or duplicating successful recipients', async () => {
    const at = new Date(Date.now() + 17 * 60000);
    const isolatedUser = await prisma.user.create({ data: { tenantId, firstName: 'Retry', lastName: 'User', email: randomUUID()+'@camxian.com', role: 'Sales Rep' } });
    await scope(() => dispatchTenantNotifications(tenantId, at));
    await prisma.user.update({ where: { id: isolatedUser.id }, data: { status: 'INACTIVE' } });
    const event = await prisma.notificationEvent.findFirstOrThrow({ where: { tenantId, entityId: isolatedUser.id, type: 'user_status_changed', processedAt: null } });
    let fail = true;
    prisma.$use(async (params, next) => { if (fail && params.model === 'Notification' && params.action === 'create') { fail = false; throw Error('Unavailable'); } return next(params); });
    expect((await scope(() => dispatchBatch(tenantId, at, 100))).failed).toBe(1);
    expect((await prisma.notificationEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: isolatedUser.id } })).status).toBe('INACTIVE');
    await scope(() => dispatchTenantNotifications(tenantId, new Date(+at + 10000)));
    await scope(() => dispatchTenantNotifications(tenantId, new Date(+at + 10000)));
    expect(await prisma.notification.count({ where: { tenantId, userId: adminId, eventKey: event.eventKey } })).toBe(1);
  });
});

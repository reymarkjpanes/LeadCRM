import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../config/database.config';
import app from '../../app';
import { issueAuthSession } from '../../core/auth/auth-session';
import { dispatchTenantNotifications } from './notification-events.service';
import { deliverNotification } from './notifications.service';
import { notificationActor } from './notification-actor';
import { createContact } from '../crm/contacts-v2/contacts-v2.service';
import { saveNotificationPreferences } from './notification-preferences.service';
import { findNotifications, deleteNotifications } from './notifications.repository';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@leadcrm/shared';
import { deactivateUser } from '../administration/users/user-deactivation.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
describe.skipIf(url.hostname !== '127.0.0.1' || url.pathname !== '/leadcrm_forms_test_2')('Durable notification delivery', () => {
  let tenantId: string, agentId: string, otherId: string, adminId: string, foreignId: string, roleId: string;
  let pipelineId: string, stageId: string, token: string, adminToken: string, server: Server, base: string;
  const processEvents = (now = new Date()) => dispatchTenantNotifications(tenantId, now, 100);
  const contact = (owner = agentId) => prisma.contact.create({ data: { tenantId, firstName: 'Assigned', lastName: 'Contact', email: randomUUID() + '@example.test', assignedUserId: owner } });
  const notifications = (entityId: string, userId = agentId) => prisma.notification.findMany({ where: { tenantId, entityId, userId } });
  const request = async (path: string, method = 'GET', body?: unknown, auth = token) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  beforeAll(async () => {
    // Regression: UTC timestamp columns must behave the same in a non-UTC session.
    await prisma.$executeRawUnsafe("SET TIME ZONE 'Asia/Manila'");
    tenantId = (await prisma.tenant.create({ data: { name: 'Delivery', slug: randomUUID() } })).id;
    const agentRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Agent' } }); roleId = agentRole.id;
    const adminRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Client Admin', isSystemRole: true } });
    for (const module of ['leads', 'contacts', 'accounts', 'deals', 'tasks', 'campaigns']) await prisma.rolePermission.create({ data: { tenantId, roleId, module, canView: true, canEdit: true, canCreate: true } });
    const user = async (role: string, rid?: string, tid = tenantId) => {
      const row = await prisma.user.create({ data: { tenantId: tid, role, email: randomUUID() + '@camxian.com', firstName: 'Staff', lastName: 'Member', mustChangePassword: false, onboardingCompletedAt: new Date() } });
      if (rid) await prisma.userRole.create({ data: { tenantId: tid, userId: row.id, roleId: rid } });
      return row;
    };
    const agent = await user('Agent', roleId); agentId = agent.id; token = (await issueAuthSession(agent)).token;
    otherId = (await user('Agent', roleId)).id;
    const admin = await user('Client Admin', adminRole.id); adminId = admin.id; adminToken = (await issueAuthSession(admin)).token;
    const foreignTenant = await prisma.tenant.create({ data: { name: 'Foreign', slug: randomUUID() } });
    foreignId = (await user('Agent', undefined, foreignTenant.id)).id;
    pipelineId = (await prisma.pipeline.create({ data: { tenantId, name: 'Sales' } })).id;
    stageId = (await prisma.stage.create({ data: { tenantId, pipelineId, name: 'Lead', order: 0, requiredFields: [] } })).id;
    await processEvents();
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/v1';
  });
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('stores new trigger occurrence and availability instants in UTC in a non-UTC session', async () => {
    const before = Date.now();
    const row = await contact();
    const event = await prisma.notificationEvent.findFirstOrThrow({ where: { tenantId, entityId: row.id, type: 'contact_assigned' } });
    for (const instant of [event.occurredAt, event.createdAt, event.availableAt]) {
      expect(+instant).toBeGreaterThanOrEqual(before - 1000);
      expect(+instant).toBeLessThanOrEqual(Date.now() + 1000);
    }
    await processEvents();
    expect(await notifications(row.id)).toHaveLength(1);
  });

  it('direct Contact API creates one Contact event and an authorized Contact destination', async () => {
    const created = await request('/crm/contacts', 'POST', { firstName: 'Direct', lastName: 'Contact', email: 'direct@example.test', assignedUserId: agentId }, adminToken);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect(await notifications(id)).toHaveLength(0);
    await processEvents(); await processEvents();
    const rows = await notifications(id); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'contact_assigned', entityType: 'Contact', eventKey: 'contact:created:' + id });
    expect((await request('/notifications/' + rows[0].id + '/destination')).body.destination).toBe('/crm/contacts/' + id);
    expect(await notifications(id, adminId)).toHaveLength(0);
  });

  it('captures assignment transactionally, ignores title edits and respects self-assignment', async () => {
    const row = await notificationActor.run(agentId, () => createContact(tenantId, { firstName: 'Self', lastName: 'Contact', email: 'self@example.test', assignedUserId: agentId }, agentId));
    await processEvents(); expect(await notifications(row.id)).toHaveLength(0);
    await prisma.contact.update({ where: { id: row.id }, data: { assignedUserId: otherId } });
    await prisma.contact.update({ where: { id: row.id }, data: { firstName: 'Edited' } });
    expect(await prisma.notificationEvent.count({ where: { tenantId, entityId: row.id, type: 'contact_assigned' } })).toBe(2);
    await processEvents(); expect(await notifications(row.id, otherId)).toHaveLength(1);
    let rolledId = '';
    await expect(prisma.$transaction(async tx => { rolledId = (await tx.contact.create({ data: { tenantId, firstName: 'Rolled', lastName: 'Back', assignedUserId: agentId } })).id; throw Error('rollback'); })).rejects.toThrow('rollback');
    expect(await prisma.notificationEvent.count({ where: { tenantId, entityId: rolledId } })).toBe(0);
  });

  it('preserves deletion identity through event replay and a later distinct assignment', async () => {
    const row = await contact(); await processEvents();
    const [delivered] = await notifications(row.id);
    await deleteNotifications([delivered.id], tenantId, agentId);
    await prisma.notificationEvent.updateMany({ where: { tenantId, entityId: row.id }, data: { processedAt: null } });
    await processEvents(); expect(await notifications(row.id)).toHaveLength(0);
    expect(await prisma.notificationDelivery.findFirst({ where: { tenantId, userId: agentId, eventKey: delivered.eventKey! } })).toMatchObject({ outcome: 'deleted' });
    await prisma.contact.update({ where: { id: row.id }, data: { assignedUserId: otherId } });
    await processEvents();
    await prisma.contact.update({ where: { id: row.id }, data: { assignedUserId: agentId } });
    await processEvents(); expect(await notifications(row.id)).toHaveLength(1);
  });

  it('recovers a leased Deal reassignment after worker restart and tolerates simultaneous workers', async () => {
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId, stageId, title: 'Durable Deal', assignedUserId: agentId, tags: [], productInterests: [] } });
    await processEvents();
    await prisma.deal.update({ where: { id: deal.id }, data: { assignedUserId: otherId } });
    const leaseCheckAt = new Date();
    await prisma.notificationEvent.updateMany({ where: { tenantId, entityId: deal.id, processedAt: null }, data: { leaseToken: 'crashed', leaseUntil: new Date(+leaseCheckAt + 1000) } });
    await processEvents(leaseCheckAt); expect(await notifications(deal.id, otherId)).toHaveLength(0);
    const later = new Date(+leaseCheckAt + 2000);
    await Promise.all([processEvents(later), processEvents(later)]);
    expect(await notifications(deal.id, otherId)).toHaveLength(1);
  });

  it('rolls back a failed delivery claim and retries with bounded backoff without undoing the CRM operation', async () => {
    const row = await contact();
    let fail = true;
    prisma.$use(async (params, next) => {
      if (fail && params.model === 'Notification' && params.action === 'create') { fail = false; throw new Error('sensitive-provider-detail'); }
      return next(params);
    });
    const result = await processEvents(); expect(result.failed).toBe(1);
    expect(await prisma.contact.findUnique({ where: { id: row.id } })).not.toBeNull();
    const event = await prisma.notificationEvent.findFirstOrThrow({ where: { tenantId, entityId: row.id } });
    expect(event).toMatchObject({ attempts: 1, lastError: 'delivery_failed', processedAt: null, leaseToken: null });
    expect(await prisma.notificationDelivery.count({ where: { tenantId, eventKey: event.eventKey } })).toBe(0);
    await processEvents(new Date(+event.availableAt + 1));
    expect(await notifications(row.id)).toHaveLength(1);
  });

  it('rejects foreign/inactive recipients and obsolete admin roles', async () => {
    const row = await contact();
    await deliverNotification({ tenantId, userId: foreignId, eventKey: 'foreign', type: 'contact_assigned', title: 'Contact', entityType: 'Contact', entityId: row.id });
    expect(await prisma.notification.count({ where: { tenantId, userId: foreignId } })).toBe(0);
    const inactive = await prisma.user.create({ data: { tenantId, email: randomUUID() + '@camxian.com', firstName: 'Inactive', lastName: 'Member', role: 'Agent', status: 'INACTIVE' } });
    await deliverNotification({ tenantId, userId: inactive.id, eventKey: 'inactive', type: 'contact_assigned', title: 'Contact', entityType: 'Contact', entityId: row.id });
    expect(await notifications(row.id, inactive.id)).toHaveLength(0);
    const obsoleteRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Obsolete', isArchived: true } });
    const obsolete = await prisma.user.create({ data: { tenantId, email: randomUUID() + '@camxian.com', firstName: 'Former', lastName: 'Admin', role: 'Client Admin' } });
    await prisma.userRole.create({ data: { tenantId, userId: obsolete.id, roleId: obsoleteRole.id } });
    await prisma.contact.update({ where: { id: row.id }, data: { status: 'HOT' } });
    await processEvents();
    expect((await notifications(row.id, adminId)).some(n => n.type === 'customer_hot')).toBe(true);
    expect(await notifications(row.id, obsolete.id)).toHaveLength(0);
    expect(await notifications(row.id, otherId)).toHaveLength(0);
  });

  it('redacts historical customer data after reassignment, archive and permission revocation', async () => {
    const row = await contact(); await processEvents(); const [notice] = await notifications(row.id);
    await prisma.contact.update({ where: { id: row.id }, data: { assignedUserId: otherId } });
    expect((await request('/notifications/' + notice.id + '/destination')).body.destination).toBeNull();
    const feed = await findNotifications(tenantId, agentId, { limit: '100' });
    expect(feed.data.find(n => n.id === notice.id)).toMatchObject({ available: false, entityType: null, entityId: null });
    expect((await request('/notifications/' + notice.id + '/read', 'PATCH')).status).toBe(200);
    const next = await contact(); await processEvents(); const [newNotice] = await notifications(next.id);
    await prisma.rolePermission.update({ where: { roleId_module: { roleId, module: 'contacts' } }, data: { canView: false } });
    expect((await request('/notifications/' + newNotice.id + '/destination')).body.destination).toBeNull();
    await prisma.rolePermission.update({ where: { roleId_module: { roleId, module: 'contacts' } }, data: { canView: true } });
    await prisma.contact.update({ where: { id: next.id }, data: { isArchived: true } });
    expect((await request('/notifications/' + newNotice.id + '/destination')).body.destination).toBeNull();
  });

  it('persists isolated preferences across sessions, enforces in-app choice and rejects unsupported channels', async () => {
    const settings = { ...DEFAULT_NOTIFICATION_PREFERENCES, inAppGeneral: false };
    expect((await request('/notifications/preferences', 'PUT', settings)).status).toBe(200);
    const agent = await prisma.user.findUniqueOrThrow({ where: { id: agentId } });
    const newToken = (await issueAuthSession(agent)).token;
    expect((await request('/notifications/preferences', 'GET', undefined, newToken)).body.data.inAppGeneral).toBe(false);
    expect((await request('/notifications/preferences', 'GET', undefined, adminToken)).body.data.inAppGeneral).toBe(true);
    expect((await request('/notifications/preferences', 'PUT', { ...settings, urgentHotLeadSms: true })).status).toBe(400);
    expect((await request('/notifications/preferences', 'PUT', { ...settings, userId: otherId })).status).toBe(400);
    const row = await contact(); await processEvents(); expect(await notifications(row.id)).toHaveLength(0);
    await saveNotificationPreferences(tenantId, agentId, DEFAULT_NOTIFICATION_PREFERENCES);
    await prisma.notificationEvent.updateMany({ where: { tenantId, entityId: row.id }, data: { processedAt: null } });
    await processEvents(); expect(await notifications(row.id)).toHaveLength(0);
  });

  it('uses configured reminder time, versions changes, separates overdue and cancels old pending alerts', async () => {
    const now = new Date(), due = new Date(+now + 7200000), reminder = new Date(+now + 3600000);
    const task = await prisma.task.create({ data: { tenantId, assignedUserId: agentId, title: 'Timed task', dueDate: due, reminderAt: reminder } });
    await processEvents(new Date(+now + 500));
    expect((await notifications(task.id)).map(n => n.type)).toEqual(['task_assigned']);
    await processEvents(new Date(+reminder + 1)); await processEvents(new Date(+reminder + 2));
    expect((await notifications(task.id)).filter(n => n.type === 'task_due')).toHaveLength(1);
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date(+due + 7200000), reminderAt: new Date(+due + 3600000), assignedUserId: otherId } });
    await processEvents(new Date(+due + 1));
    expect((await notifications(task.id)).filter(n => n.type === 'task_overdue')).toHaveLength(0);
    await processEvents(new Date(+due + 7200001));
    expect((await notifications(task.id, otherId)).filter(n => n.type === 'task_overdue')).toHaveLength(1);
    for (const status of ['completed', 'cancelled']) {
      const stopped = await prisma.task.create({ data: { tenantId, assignedUserId: agentId, title: status, dueDate: due, reminderAt: reminder } });
      await prisma.task.update({ where: { id: stopped.id }, data: { status } });
      await processEvents(new Date(+due + 1));
      expect((await notifications(stopped.id)).filter(n => ['task_due','task_overdue'].includes(n.type))).toHaveLength(0);
    }
  });

  it('does not deliver a reminder across a concurrent Task completion commit', async () => {
    const task = await prisma.task.create({ data: { tenantId, assignedUserId: agentId, title: 'Completing task', dueDate: new Date(Date.now()+3600000) } });
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const completing = prisma.$transaction(async tx => { await tx.task.update({ where: { id: task.id }, data: { status: 'completed' } }); locked(); await gate; });
    await ready;
    const delivery = deliverNotification({ tenantId, userId: agentId, type: 'task_due', title: 'Task reminder', entityType: 'Task', entityId: task.id,
      eventKey: 'concurrent-completion:' + task.id, taskVersion: task.notificationVersion, eligibilityAt: new Date() });
    await new Promise(resolve => setTimeout(resolve, 50)); release(); await completing; await delivery;
    expect(await notifications(task.id)).toHaveLength(0);
  });

  it('alerts again for a distinct campaign run while collapsing failures within the same run', async () => {
    const campaign = await prisma.campaign.create({ data: { tenantId, name: 'Repeated failures', type: 'EMAIL', createdById: agentId, status: 'SENDING', submissionStartedAt: new Date() } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { failedCount: 1, status: 'FAILED' } });
    await processEvents();
    await prisma.campaign.update({ where: { id: campaign.id }, data: { failedCount: 2 } }); await processEvents();
    expect(await notifications(campaign.id)).toHaveLength(1);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { failedCount: 0, status: 'SENDING', submissionStartedAt: new Date(Date.now() + 1000) } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { failedCount: 1, status: 'FAILED' } }); await processEvents();
    expect(await notifications(campaign.id)).toHaveLength(2); expect(await notifications(campaign.id, adminId)).toHaveLength(2);
  });

  it('collapses pre-submission scheduling failures and permits a later distinct retry', async () => {
    const campaign = await prisma.campaign.create({ data: { tenantId, name: 'Scheduled failure', type: 'EMAIL', createdById: agentId } });
    const audit = () => prisma.auditLog.create({ data: { tenantId, userId: agentId, action: 'campaign.scheduled_failed', entityType: 'Campaign', entityId: campaign.id } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { failedCount: 1 } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'FAILED' } });
    await audit(); await audit(); await processEvents();
    expect(await notifications(campaign.id)).toHaveLength(1);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'DRAFT', failedCount: 0 } });
    await audit(); await processEvents();
    expect(await notifications(campaign.id)).toHaveLength(2);
  });

  it('deduplicates inbound message identity, enforces mailbox access, excludes history and resolves recovery incidents', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: agentId } });
    const now = new Date(), customer = await contact();
    const account = await prisma.emailAccount.create({ data: { tenantId, userId: agentId, email: owner.email, accessToken: 'test-encrypted', scopes: [], connectedAt: new Date(+now - 60000) } });
    const messageData = { tenantId, accountId: account.id, providerMessageId: 'one', threadId: 'thread', direction: 'inbound',
      from: customer.email!, fromAddress: customer.email!, recipients: [owner.email], recipientAddresses: [owner.email],
      subject: 'Private subject', body: 'Private body', snippet: 'Private preview', labels: ['INBOX','UNREAD'], sentAt: now, contactId: customer.id, rfcMessageId: 'canonical' };
    const copiedAccount = await prisma.emailAccount.create({ data: { tenantId, userId: adminId, email: 'copy@camxian.com', accessToken: 'test-encrypted', scopes: [], connectedAt: new Date(+now - 60000) } });
    await prisma.mailboxMessage.create({ data: { ...messageData, accountId: copiedAccount.id, providerMessageId: 'admin-copy' } });
    const message = await prisma.mailboxMessage.create({ data: messageData });
    await prisma.mailboxMessage.create({ data: { ...messageData, providerMessageId: 'two' } });
    await prisma.mailboxMessage.create({ data: { ...messageData, providerMessageId: 'history', rfcMessageId: 'old', sentAt: new Date(+now - 120000) } });
    await processEvents();
    const rows = await prisma.notification.findMany({ where: { tenantId, userId: agentId, type: 'customer_reply' } }); expect(rows).toHaveLength(1);
    expect(await prisma.notification.count({ where: { tenantId, userId: adminId, type: 'customer_reply' } })).toBe(0);
    expect(rows[0].body).not.toContain('Private');
    expect((await request('/notifications/' + rows[0].id + '/destination')).body.destination).toBe('/inbox?threadId=thread');
    await request('/notifications/' + rows[0].id + '/read', 'PATCH');
    expect((await prisma.mailboxMessage.findUniqueOrThrow({ where: { id: message.id } })).labels).toContain('UNREAD');
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncError: 'temporary' } });
    await processEvents(); expect((await notifications(account.id)).filter(n => n.type === 'mailbox_sync_failed')).toHaveLength(0);
    const incident = await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(Math.abs(+incident.notificationFailedAt! - Date.now())).toBeLessThan(2000);
    await processEvents(new Date(+incident.notificationFailedAt! + 15 * 60000 - 1));
    expect((await notifications(account.id)).filter(n => n.type === 'mailbox_sync_failed')).toHaveLength(0);
    await processEvents(new Date(+incident.notificationFailedAt! + 15 * 60000));
    expect((await notifications(account.id)).filter(n => n.type === 'mailbox_sync_failed')).toHaveLength(1);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncError: null } });
    await prisma.emailAccount.update({ where: { id: account.id }, data: { isActive: false } });
    await processEvents();
    await prisma.emailAccount.update({ where: { id: account.id }, data: { isActive: true } });
    await prisma.emailAccount.update({ where: { id: account.id }, data: { isActive: false } });
    await processEvents(); expect((await notifications(account.id)).filter(n => n.type === 'mailbox_disconnected')).toHaveLength(2);
  });

  it('validates query and IDs, denies same-tenant mutations, paginates through deletes and keeps new arrivals unread', async () => {
    for (const query of ['?limit=101','?page=0','?isRead=maybe','?userId=' + otherId,'?cursor=bad']) expect((await request('/notifications' + query)).status).toBe(400);
    expect((await request('/notifications/bad/read','PATCH')).status).toBe(400);
    const first = await request('/notifications?limit=2'); const selected = first.body.data[0].id;
    const before = first.body.meta.snapshot;
    const future = await prisma.notification.create({ data: { tenantId, userId: agentId, type: 'task_due', title: 'New arrival', createdAt: new Date(Date.parse(before) + 10) } });
    await deleteNotifications([selected],tenantId,agentId);
    const second = await request('/notifications?limit=2&cursor=' + encodeURIComponent(first.body.meta.nextCursor));
    expect(second.body.data.some((n: {id:string}) => first.body.data.some((old:{id:string})=> old.id === n.id))).toBe(false);
    expect(second.body.data.some((n:{id:string})=>n.id===future.id)).toBe(false);
    expect((await request('/notifications/read-all','PATCH',{ before })).status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({where:{id:future.id}})).isRead).toBe(false);
  });

  it('processes old pending events without scanning historical CRM rows and bounds each batch', async () => {
    const ids = [];
    for (let i=0;i<7;i++) ids.push((await contact()).id);
    await prisma.notificationEvent.updateMany({ where: { tenantId, entityId: { in: ids } }, data: { occurredAt: new Date('2020-01-01'), availableAt: new Date('2020-01-01') } });
    expect((await dispatchTenantNotifications(tenantId, new Date(), 3)).claimed).toBe(3);
    expect(await prisma.notificationEvent.count({ where: { tenantId, entityId: { in: ids }, processedAt: null } })).toBe(4);
    await processEvents();
    expect(await prisma.notification.count({ where: { tenantId, entityId: { in: ids } } })).toBe(7);
  });

  it('covers Lead, Account, Workflow, Form and deactivation events without transferring private history', async () => {
    const staff = await prisma.user.create({ data: { tenantId, role: 'Agent', email: randomUUID() + '@camxian.com', firstName: 'Leaving', lastName: 'Agent' } });
    await prisma.userRole.create({ data: { tenantId, userId: staff.id, roleId } });
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Website', lastName: 'Lead', source: 'Website', assignedUserId: staff.id } });
    const account = await prisma.account.create({ data: { tenantId, name: 'Owned account', assignedUserId: staff.id } });
    const deal = await prisma.deal.create({ data: { tenantId, pipelineId, stageId, title: 'Transferred Deal', assignedUserId: staff.id } });
    await processEvents();
    expect(await notifications(lead.id, staff.id)).toHaveLength(1);
    expect(await notifications(lead.id, adminId)).toHaveLength(1);
    expect(await notifications(account.id, staff.id)).toHaveLength(1);
    const oldCount = await prisma.notification.count({ where: { tenantId, userId: staff.id } });
    await notificationActor.run(adminId, () => deactivateUser(staff.id, tenantId, adminId, otherId));
    await processEvents(); await processEvents();
    for (const id of [lead.id, account.id, deal.id]) expect(await notifications(id, otherId)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { tenantId, userId: staff.id } })).toBe(oldCount);
    expect(await prisma.notification.count({ where: { tenantId, userId: adminId, entityId: staff.id, type: 'user_status_changed' } })).toBe(1);
    const workflow = await prisma.workflow.create({ data: { tenantId, name: 'Failed workflow', trigger: 'lead.created', actions: [] } });
    const trigger = await prisma.workflowTriggerRecord.create({ data: { tenantId, workflowId: workflow.id, triggerType: 'lead.created', entityType: 'Lead', entityId: lead.id } });
    const run = await prisma.workflowExecutionRun.create({ data: { tenantId, workflowId: workflow.id, triggerId: trigger.id, entityType: 'Lead', entityId: lead.id } });
    await prisma.workflowExecutionRun.update({ where: { id: run.id }, data: { status: 'failed', completedAt: new Date() } });
    const form = await prisma.marketingForm.create({ data: { tenantId, name: 'Failed form', createdById: adminId } });
    await prisma.auditLog.create({ data: { tenantId, userId: adminId, action: 'form.processing_failed', entityType: 'Form', entityId: form.id } });
    await processEvents();
    expect((await notifications(workflow.id, adminId)).map(n => n.type)).toEqual(['workflow_failed']);
    expect((await notifications(form.id, adminId)).map(n => n.type)).toEqual(['form_processing_failed']);
    expect(await notifications(workflow.id, otherId)).toHaveLength(0);
    expect((await request('/notifications/operations')).status).toBe(403);
    expect((await request('/notifications/operations','GET',undefined,adminToken)).status).toBe(200);
  });
});

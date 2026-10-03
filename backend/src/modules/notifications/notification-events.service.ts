import { Role } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';
import { deliverNotification, type CreateNotificationParams } from './notifications.service';

type Event = Omit<CreateNotificationParams, 'userId'> & { eventKey: string; ownerId?: string | null; admins?: boolean };

export async function deliverEvent({ ownerId, admins, ...event }: Event) {
  const recipients = new Set<string>(ownerId ? [ownerId] : []);
  if (admins) {
    const users = await prisma.user.findMany({ where: { tenantId: event.tenantId, status: 'ACTIVE', OR: [
      { role: Role.CLIENT_ADMIN },
      { userRoles: { some: { tenantId: event.tenantId, role: { tenantId: event.tenantId, name: Role.CLIENT_ADMIN, isArchived: false } } } },
    ] }, select: { id: true } });
    users.forEach(user => recipients.add(user.id));
  }
  for (const userId of recipients) await deliverNotification({ ...event, userId });
}

async function batches<T>(load: (skip: number) => Promise<T[]>, visit: (row: T) => Promise<void>) {
  for (let skip = 0; ; skip += 200) {
    const rows = await load(skip);
    for (const row of rows) await visit(row);
    if (rows.length < 200) return;
  }
}

/** Projects committed CRM history. Optional notification failures never participate in CRM transactions. */
export async function dispatchTenantNotifications(tenantId: string, now = new Date()) {
  const key = { tenantId, module: 'notifications', key: 'delivery-cursor' };
  const checkpoint = await prisma.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { createdAt: true } });
  const last = typeof checkpoint?.value === 'string' ? new Date(checkpoint.value) : tenant.createdAt;
  // Revisit the overlap to cover transactions whose timestamp preceded their commit.
  const range = { gte: new Date(Math.max(tenant.createdAt.getTime(), last.getTime() - 300_000)), lte: now };
  const page = (skip: number) => ({ skip, take: 200, orderBy: { id: 'asc' as const } });
  const emit = (event: Omit<Event, 'tenantId'>) => deliverEvent({ tenantId, ...event });

  await batches(skip => prisma.lead.findMany({ where: { tenantId, createdAt: range }, ...page(skip) }), async lead => {
    await emit({ eventKey: `lead:created:${lead.id}`, type: 'lead_assigned', title: 'New Lead assigned',
      body: `${lead.firstName} ${lead.lastName}`, entityType: 'Lead', entityId: lead.id, ownerId: lead.assignedUserId,
      admins: ['website', 'form'].includes(lead.source?.toLowerCase() ?? '') });
  });
  await batches(skip => prisma.contact.findMany({ where: { tenantId, createdAt: range }, ...page(skip) }), async contact => {
    await emit({ eventKey: `contact:created:${contact.id}`, type: 'contact_assigned', title: 'Contact assigned',
      body: `${contact.firstName} ${contact.lastName}`, entityType: 'Contact', entityId: contact.id, ownerId: contact.assignedUserId });
  });
  await batches(skip => prisma.activity.findMany({ where: { tenantId, createdAt: range, type: 'assignment' }, ...page(skip) }), async activity => {
    const metadata = activity.metadata as { assignedUserId?: string } | null;
    if (!metadata?.assignedUserId || !activity.leadId && !activity.contactId) return;
    const entityType = activity.leadId ? 'Lead' : 'Contact';
    await emit({ eventKey: `assignment:${activity.id}`, type: `${entityType.toLowerCase()}_assigned`, title: `${entityType} reassigned to you`,
      entityType, entityId: activity.leadId ?? activity.contactId!, ownerId: metadata.assignedUserId });
  });
  await batches(skip => prisma.activity.findMany({ where: { tenantId, createdAt: range, type: 'stage_change', OR: [{ leadId: { not: null } }, { contactId: { not: null } }] }, ...page(skip) }), async activity => {
    const status = / to (Hot|Cold|Cancelled)$/.exec(activity.title)?.[1];
    if (!status) return;
    const customer = activity.leadId ? await prisma.lead.findFirst({ where: { tenantId, id: activity.leadId } }) : await prisma.contact.findFirst({ where: { tenantId, id: activity.contactId! } });
    if (!customer) return;
    await emit({ eventKey: `status:${activity.id}`, type: `customer_${status.toLowerCase()}`, title: `${activity.leadId ? 'Lead' : 'Contact'} became ${status}`,
      body: `${customer.firstName} ${customer.lastName}`, entityType: activity.leadId ? 'Lead' : 'Contact', entityId: customer.id,
      ownerId: customer.assignedUserId, admins: status === 'Hot' || status === 'Cancelled' });
  });
  await batches(skip => prisma.dealStageHistory.findMany({ where: { tenantId, movedAt: range }, include: { deal: true, newStage: true }, ...page(skip) }), async history => {
    const stage = history.newStage;
    if (!stage.isWon && !stage.isLost && !['contacted', 'qualified'].includes(stage.name.toLowerCase())) return;
    await emit({ eventKey: `deal-stage:${history.id}`, type: stage.isWon ? 'deal_won' : stage.isLost ? 'deal_lost' : 'deal_progressed',
      title: `Deal moved to ${stage.name}`, body: history.deal.title, entityType: 'Deal', entityId: history.dealId,
      ownerId: history.deal.assignedUserId ?? history.deal.ownerId, admins: stage.isWon || stage.isLost || stage.name.toLowerCase() === 'qualified' });
    if (stage.name.toLowerCase() === 'qualified') await emit({ eventKey: `closing-needed:${history.id}`, type: 'closing_requirements_needed',
      title: 'Closed Won requirements need completion', body: history.deal.title, entityType: 'Deal', entityId: history.dealId, ownerId: history.deal.assignedUserId ?? history.deal.ownerId });
    if (stage.isWon) await emit({ eventKey: `closing-completed:${history.id}`, type: 'closing_requirements_completed',
      title: 'Closed Won requirements completed', body: history.deal.title, entityType: 'Deal', entityId: history.dealId, admins: true });
  });
  await batches(skip => prisma.mailboxMessage.findMany({ where: { tenantId, createdAt: range, direction: 'inbound' }, include: { account: { select: { connectedAt: true } } }, ...page(skip) }), async message => {
    if (message.sentAt <= message.account.connectedAt || !message.leadId && !message.contactId) return;
    const customer = message.leadId ? await prisma.lead.findFirst({ where: { tenantId, id: message.leadId } }) : await prisma.contact.findFirst({ where: { tenantId, id: message.contactId! } });
    if (!customer) return;
    const entityType = message.leadId ? 'Lead' : 'Contact';
    await emit({ eventKey: `reply:${message.rfcMessageId ?? `${message.accountId}:${message.providerMessageId}`}:${entityType}:${customer.id}`,
      type: 'customer_reply', title: 'Customer sent a new reply', body: message.subject, entityType, entityId: customer.id, ownerId: customer.assignedUserId });
  });
  await batches(skip => prisma.auditLog.findMany({ where: { tenantId, createdAt: range }, ...page(skip) }), async audit => {
    const changes = audit.changeset as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
    const before = changes?.before, after = changes?.after;
    if (audit.entityType === 'Task' && audit.entityId && ['task.created', 'task.updated', 'task.reassigned'].includes(audit.action)
      && typeof after?.assignedUserId === 'string' && (audit.action === 'task.created' || before?.assignedUserId !== after.assignedUserId)) {
      await emit({ eventKey: `task-assignment:${audit.id}`, type: 'task_assigned', title: audit.action === 'task.created' ? 'New Task assigned' : 'Task reassigned to you',
        body: String(after.title ?? 'Open the Task for details.'), entityType: 'Task', entityId: audit.entityId, ownerId: after.assignedUserId });
    }
    const userEvent = audit.entityType === 'User' && (['user.created', 'user.archived', 'user.restored', 'user.deleted'].includes(audit.action)
      || audit.action === 'user.updated' && typeof after?.status === 'string' && before?.status !== after.status
      || audit.action === 'user.bulk_updated' && !!(after?.updates as Record<string, unknown> | undefined)?.status);
    const archiveEvent = /\.(archived|restored)$/.test(audit.action) && ['Lead', 'Contact', 'Account', 'Deal', 'Workflow', 'Campaign'].includes(audit.entityType);
    if (audit.entityType === 'Campaign' && audit.entityId && ['campaign.delivery_interrupted', 'campaign.scheduled_failed'].includes(audit.action)) {
      const campaign = await prisma.campaign.findFirst({ where: { tenantId, id: audit.entityId } });
      if (campaign) await emit({ eventKey: `campaign-failed:${campaign.id}`, type: 'campaign_failed', title: 'Campaign delivery failed',
        body: campaign.name, entityType: 'Campaign', entityId: campaign.id, ownerId: campaign.createdById, admins: true });
    }
    if (userEvent || archiveEvent || audit.action === 'form.processing_failed') await emit({ eventKey: `audit:${audit.id}`, type: audit.action.replace(/\./g, '_'),
      title: audit.action === 'user.updated' ? `User ${after?.status === 'ACTIVE' ? 'activated' : 'inactivated'}` : audit.action.replace(/\./g, ' ').replace(/_/g, ' '),
      entityType: audit.entityType, entityId: audit.entityId ?? undefined, admins: true });
  });
  await batches(skip => prisma.workflowExecutionRun.findMany({ where: { tenantId, completedAt: range, status: 'failed' }, ...page(skip) }), async run => {
    await emit({ eventKey: `workflow-failed:${run.id}`, type: 'workflow_failed', title: 'Workflow failed', body: 'Review the execution history for details.', entityType: 'Workflow', entityId: run.workflowId, admins: true });
  });
  await batches(skip => prisma.campaign.findMany({ where: { tenantId, updatedAt: range, OR: [{ failedCount: { gt: 0 } }, { status: 'FAILED' }] }, ...page(skip) }), async campaign => {
    await emit({ eventKey: `campaign-failed:${campaign.id}`, type: 'campaign_failed',
      title: 'Campaign delivery failed', body: campaign.name, entityType: 'Campaign', entityId: campaign.id, ownerId: campaign.createdById, admins: true });
  });
  // Advance only after all committed event deliveries succeed. Unique event keys make retries safe.
  await prisma.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value: now.toISOString() }, update: { value: now.toISOString() } });
  await dispatchTaskReminders(tenantId, now);
  await dispatchMailboxAlerts(tenantId, now);
}

export async function dispatchTaskReminders(tenantId: string, now = new Date()) {
  await batches(skip => prisma.task.findMany({ where: { tenantId, isArchived: false, status: { notIn: ['completed', 'cancelled'] },
    dueDate: { lte: new Date(now.getTime() + 86400000) } }, orderBy: { id: 'asc' }, skip, take: 200 }), async task => {
    const overdue = task.dueDate < now;
    await deliverEvent({ tenantId, eventKey: `task:${overdue ? 'overdue' : 'due'}:${task.id}:${task.dueDate.toISOString()}:${task.assignedUserId}`,
      type: overdue ? 'task_overdue' : 'task_due', title: overdue ? 'Task overdue' : 'Task due soon', body: task.title,
      entityType: 'Task', entityId: task.id, ownerId: task.assignedUserId });
  });
}

async function dispatchMailboxAlerts(tenantId: string, now: Date) {
  const accounts = await prisma.emailAccount.findMany({ where: { tenantId, provider: 'gmail' }, select: { id: true, userId: true, isActive: true, syncError: true, connectedAt: true } });
  for (const account of accounts) {
    const key = { tenantId, module: 'notification-mailbox-health', key: account.id };
    const stored = await prisma.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
    const previous = stored?.value as { failedSince?: string; connection?: string } | null;
    const connection = account.connectedAt.toISOString();
    const failedSince = account.syncError ? previous?.connection === connection && previous.failedSince ? previous.failedSince : now.toISOString() : undefined;
    if (!account.isActive || failedSince && now.getTime() - Date.parse(failedSince) >= 15 * 60000) {
      await deliverEvent({ tenantId, ownerId: account.userId, admins: true,
        eventKey: `mailbox:${account.id}:${connection}:${account.isActive ? failedSince : 'disconnected'}`,
        type: account.isActive ? 'mailbox_sync_failed' : 'mailbox_disconnected', title: account.isActive ? 'Persistent Gmail sync failure' : 'Gmail mailbox disconnected',
        body: 'Reconnect or review the mailbox connection.', entityType: 'Mailbox', entityId: account.id });
    }
    const value = { connection, ...(failedSince ? { failedSince } : {}) };
    await prisma.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value }, update: { value } });
  }
}

export function startNotificationScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const tenants = await prisma.tenant.findMany({ where: { id: { not: 'system' } }, select: { id: true } });
      for (const tenant of tenants) {
        try { await tenantContext.run({ tenantId: tenant.id }, () => dispatchTenantNotifications(tenant.id)); }
        catch { console.warn('[Notifications] Delivery deferred; retrying next run', { tenantId: tenant.id }); }
      }
    } catch { console.warn('[Notifications] Workspace discovery failed'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

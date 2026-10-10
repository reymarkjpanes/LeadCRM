import { randomUUID } from 'node:crypto';
import type { NotificationEvent } from '@prisma/client';
import { NotificationTypes, type NotificationType } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';
import { activeAdminWhere } from './notification-access';
import { deliverNotification, type CreateNotificationParams } from './notifications.service';

type Event = Omit<CreateNotificationParams, 'userId'> & { ownerId?: string | null; actorId?: string | null; admins?: boolean };
export async function deliverEvent({ ownerId, actorId, admins, ...event }: Event) {
  const recipients = new Set<string>(ownerId && ownerId !== actorId ? [ownerId] : []);
  if (admins) {
    const users = await prisma.user.findMany({ where: activeAdminWhere(event.tenantId), select: { id: true } });
    users.forEach(user => recipients.add(user.id));
  }
  for (const userId of recipients) await deliverNotification({ ...event, userId });
}

const titles: Record<NotificationType, string> = {
  lead_assigned: 'Lead assigned to you', contact_assigned: 'Contact assigned to you', account_assigned: 'Account assigned to you',
  deal_assigned: 'Deal assigned to you', task_assigned: 'Task assigned to you', customer_hot: 'Customer became Hot',
  customer_cold: 'Customer became Cold', customer_cancelled: 'Customer became Cancelled', deal_progressed: 'Deal progressed',
  deal_won: 'Deal moved to Closed Won', deal_lost: 'Deal moved to Closed Lost', closing_requirements_needed: 'Closing requirements need attention',
  closing_requirements_completed: 'Closing requirements completed', task_due: 'Task reminder', task_overdue: 'Task overdue',
  customer_reply: 'Customer sent a new reply', campaign_failed: 'Campaign delivery failed', workflow_failed: 'Workflow execution failed',
  user_created: 'Team member created', user_status_changed: 'Team member account status changed', mailbox_disconnected: 'Gmail mailbox disconnected',
  mailbox_sync_failed: 'Persistent Gmail sync failure', form_processing_failed: 'Form processing failed',
  record_archived: 'Record archived', record_restored: 'Record restored',
};

async function project(event: NotificationEvent, now: Date) {
  if (!NotificationTypes.includes(event.type as NotificationType)) throw new Error('INVALID_EVENT_TYPE');
  const facts = event.payload as { version?: number; incidentId?: string; stage?: string; status?: string };
  if (['task_due', 'task_overdue'].includes(event.type)) {
    const task = await prisma.task.findFirst({ where: { tenantId: event.tenantId, id: event.entityId, isArchived: false,
      assignedUserId: event.ownerId ?? '', status: { notIn: ['completed', 'cancelled'] }, notificationVersion: facts.version } });
    if (!task || (event.type === 'task_due' && task.dueDate <= now) || (event.type === 'task_overdue' && task.dueDate > now)) return;
  }
  if (event.entityType === 'Mailbox') {
    const account = await prisma.emailAccount.findFirst({ where: { tenantId: event.tenantId, id: event.entityId, notificationIncidentId: facts.incidentId } });
    if (!account || (!account.syncError && account.isActive) || (event.type === 'mailbox_sync_failed' && !account.isActive)) return;
  }
  const type = event.type as NotificationType;
  const title = type.startsWith('customer_') && type !== 'customer_reply'
    ? event.entityType + titles[type].slice('Customer'.length)
    : type === 'deal_progressed' && facts.stage ? 'Deal moved to ' + facts.stage
    : type === 'user_status_changed' && facts.status ? 'Team member is now ' + facts.status.toLowerCase()
    : titles[type];
  await deliverEvent({ tenantId: event.tenantId, eventKey: event.eventKey, type, title,
    body: 'Open the related record for details.', entityType: event.entityType, entityId: event.entityId,
    ownerId: event.ownerId, actorId: event.actorId, admins: event.admins, occurredAt: event.occurredAt,
    taskVersion: facts.version, eligibilityAt: now });
}

/** A bounded lease claim never advances past unprocessed work. Expired leases recover on restart. */
export async function dispatchTenantNotifications(tenantId: string, now = new Date(), batchSize = 25) {
  const leaseToken = randomUUID();
  // These columns store UTC in timestamp-without-time-zone values. A Date bound
  // as timestamptz otherwise changes comparison meaning with the SQL session zone.
  const utcNow = now.toISOString();
  const utcLeaseUntil = new Date(+now + 120000).toISOString();
  const limit = Math.min(100, Math.max(1, batchSize));
  const scope = tenantContext.getStore();
  if (scope && scope.tenantId !== tenantId) throw new Error('NOTIFICATION_TENANT_MISMATCH');
  const events = await tenantContext.exit(async () => await prisma.$queryRaw<NotificationEvent[]>`
    WITH pending AS (
      SELECT id FROM "NotificationEvent"
      WHERE "tenantId"=${tenantId} AND "processedAt" IS NULL AND "availableAt"<=${utcNow}::timestamp
        AND ("leaseUntil" IS NULL OR "leaseUntil"<=${utcNow}::timestamp)
      ORDER BY "availableAt",id FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "NotificationEvent" e SET "leaseToken"=${leaseToken}, "leaseUntil"=${utcLeaseUntil}::timestamp, attempts=attempts+1
    FROM pending WHERE e.id=pending.id RETURNING e.*`);
  let processed = 0, failed = 0;
  for (const event of events) {
    try {
      await project(event, now);
      await prisma.notificationEvent.updateMany({ where: { id: event.id, tenantId, leaseToken },
        data: { processedAt: new Date(), leaseUntil: null, leaseToken: null, lastError: null } });
      processed++;
    } catch (error) {
      // Never persist exception text: database/provider errors can contain sensitive inputs.
      const category = error instanceof Error && error.message === 'INVALID_EVENT_TYPE' ? 'invalid_event_type' : 'delivery_failed';
      const delay = Math.min(3600000, 1000 * 2 ** Math.min(event.attempts, 12));
      await prisma.notificationEvent.updateMany({ where: { id: event.id, tenantId, leaseToken },
        data: { availableAt: new Date(+now + delay), leaseUntil: null, leaseToken: null, lastError: category } });
      failed++;
      console.warn('[Notifications] Delivery deferred', { tenantId, eventId: event.id, type: event.type, attempts: event.attempts, category });
    }
  }
  return { claimed: events.length, processed, failed };
}

// Compatibility entrypoint: reminders now live in the same durable queue.
export const dispatchTaskReminders = dispatchTenantNotifications;
let discoveryAfter: string | undefined;
export async function runNotificationWorker() {
  // Traverse a bounded tenant window fairly, including idle tenants. Delivery state
  // remains in the outbox; restarting this discovery cursor cannot skip an event.
  let tenants = await prisma.tenant.findMany({ where: discoveryAfter ? { id: { gt: discoveryAfter } } : {}, orderBy: { id: 'asc' }, take: 50, select: { id: true } });
  if (!tenants.length && discoveryAfter) {
    discoveryAfter = undefined;
    tenants = await prisma.tenant.findMany({ orderBy: { id: 'asc' }, take: 50, select: { id: true } });
  }
  discoveryAfter = tenants[tenants.length - 1]?.id;
  for (const tenant of tenants) {
    try { await tenantContext.run({ tenantId: tenant.id }, () => dispatchTenantNotifications(tenant.id)); }
    catch { console.warn('[Notifications] Tenant delivery unavailable', { tenantId: tenant.id }); }
  }
}
export function startNotificationScheduler() {
  let stopped = false;
  let running: Promise<void> | undefined;
  const run = () => {
    if (stopped || running) return;
    running = runNotificationWorker().catch(() => { console.warn('[Notifications] Queue unavailable'); }).finally(() => { running = undefined; });
  };
  run();
  const timer = setInterval(run, 5000);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await running; };
}

import prisma from '../../config/database.config';
import * as repo from './notifications.repository';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateNotificationParams {
  tenantId:    string;
  userId:      string;
  /** Notification type — drives the icon shown in the frontend dropdown. */
  type:        string;
  title:       string;
  body?:       string;
  entityType?: string;
  entityId?:   string;
  eventKey?:   string;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Create a single in-app notification for a user.
 *
 * Design rules:
 * - Non-blocking at the call-site: always called with `.catch(() => {})` by services.
 * - Never throws — notification failure must NEVER block the primary CRM operation.
 * - tenantId is always from the authenticated session, never from client input.
 * - Only creates for users who exist in the tenant (no cross-tenant writes possible
 *   because userId is resolved inside the CRM service from real record data).
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try { await deliverNotification(params); }
  catch { console.warn('[Notifications] Delivery failed', { tenantId: params.tenantId, type: params.type }); }
}

/** Worker uses the throwing variant so a failed delivery is retried without advancing its cursor. */
export async function deliverNotification(params: CreateNotificationParams): Promise<void> {
  if (!await prisma.user.findFirst({ where: { tenantId: params.tenantId, id: params.userId, status: 'ACTIVE' }, select: { id: true } })) return;
  if (params.eventKey) await prisma.notification.upsert({
    where: { tenantId_userId_eventKey: { tenantId: params.tenantId, userId: params.userId, eventKey: params.eventKey } },
    create: params, update: {},
  });
  else await prisma.notification.create({ data: params });
}

// ─── Read / Mark ──────────────────────────────────────────────────────────────

export async function getNotifications(
  tenantId: string,
  userId:   string,
  query:    Record<string, unknown>,
) {
  return repo.findNotifications(tenantId, userId, query);
}

export async function markRead(id: string, tenantId: string, userId: string): Promise<void> {
  await repo.markNotificationRead(id, tenantId, userId);
}

export async function markAllRead(tenantId: string, userId: string): Promise<void> {
  await repo.markAllNotificationsRead(tenantId, userId);
}

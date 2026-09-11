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
  await prisma.notification.create({
    data: {
      tenantId:    params.tenantId,
      userId:      params.userId,
      type:        params.type,
      title:       params.title,
      body:        params.body,
      entityType:  params.entityType,
      entityId:    params.entityId,
    },
  });
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

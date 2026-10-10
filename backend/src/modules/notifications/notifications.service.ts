import type { NotificationType } from '@leadcrm/shared';
import { NotificationTypes } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import * as repo from './notifications.repository';
import { notificationAccess } from './notification-access';
import { getNotificationPreferences, mandatoryNotification } from './notification-preferences.service';
import { tenantContext } from '../../core/tenant/tenant-context';

export interface CreateNotificationParams {
  tenantId: string; userId: string; type: NotificationType; title: string; body?: string;
  entityType?: string; entityId?: string; eventKey: string; occurredAt?: Date;
  taskVersion?: number; eligibilityAt?: Date;
}

/** Internal compatibility entrypoint. Business producers use the transactional outbox. */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  await deliverNotification(params);
}

/** Ledger claim and visible delivery commit together. Retry is safe even after deletion. */
export async function deliverNotification(params: CreateNotificationParams): Promise<void> {
  if (!NotificationTypes.includes(params.type) || !params.eventKey) throw new Error('INVALID_NOTIFICATION_EVENT');
  const access = await notificationAccess(params.tenantId, params.userId);
  if (!access.active) return;
  const authorized = !!await access.resolve(params.entityType, params.entityId);
  const preferences = await getNotificationPreferences(params.tenantId, params.userId);
  const enabled = mandatoryNotification(params.type) || preferences.data.inAppGeneral;
  await prisma.$transaction(async tx => {
    let currentTask = true;
    if (params.type === 'task_due' || params.type === 'task_overdue') {
      const scope = tenantContext.getStore();
      if (scope && scope.tenantId !== params.tenantId) throw new Error('NOTIFICATION_TENANT_MISMATCH');
      const at = params.eligibilityAt ?? new Date();
      const utcAt = at.toISOString();
      // Hold a read lock through delivery, so completion/reassignment cannot commit
      // between the final eligibility check and the reminder insert.
      const eligible = await tenantContext.exit(async () => await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Task" WHERE "tenantId"=${params.tenantId} AND id=${params.entityId ?? ''}
          AND "assignedUserId"=${params.userId} AND "notificationVersion"=${params.taskVersion ?? -1}
          AND NOT "isArchived" AND status NOT IN ('completed','cancelled')
          AND ((${params.type}='task_due' AND "dueDate">${utcAt}::timestamp) OR (${params.type}='task_overdue' AND "dueDate"<=${utcAt}::timestamp))
        FOR SHARE`);
      currentTask = eligible.length > 0;
    }
    const claim = await tx.notificationDelivery.createMany({ data: [{
      tenantId: params.tenantId, userId: params.userId, eventKey: params.eventKey,
      outcome: !authorized || !currentTask ? 'ineligible' : !enabled ? 'disabled' : 'delivered',
    }], skipDuplicates: true });
    const { taskVersion: _version, eligibilityAt: _at, ...data } = params;
    if (claim.count && authorized && currentTask && enabled) await tx.notification.create({ data });
  });
}

export const getNotifications = repo.findNotifications;
export const markRead = repo.markNotificationRead;
export const markAllRead = repo.markAllNotificationsRead;
export const deleteNotifications = repo.deleteNotifications;

import prisma from '../../config/database.config';
import { getPaginationParams } from '../../shared/helpers/pagination';

// All queries are scoped to tenantId + userId — cross-tenant access is impossible by design

export async function findNotifications(tenantId: string, userId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  const where = {
    tenantId,
    userId,
    ...(query.unreadOnly === 'true' || query.isRead === 'false' ? { isRead: false } : query.isRead === 'true' ? { isRead: true } : {}),
  };

  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { tenantId, userId, isRead: false } }),
  ]);

  return { data, meta: { total, page, limit, hasMore: page * limit < total }, unreadCount };
}

export async function markNotificationRead(id: string, tenantId: string, userId: string): Promise<void> {
  // Single update — Prisma returns RecordNotFound error if the WHERE doesn't match, caught silently
  await prisma.notification.updateMany({
    where: { id, tenantId, userId },
    data:  { isRead: true, readAt: new Date() },
  });
}

export async function markAllNotificationsRead(tenantId: string, userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { tenantId, userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

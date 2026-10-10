import prisma from '../../config/database.config';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { NotificationQuerySchema } from '@leadcrm/shared';
import { NotFoundError, ValidationError } from '../../shared/errors/http-error';
import { presentNotifications } from './notification-access';

const cursorSchema = z.object({ createdAt: z.string().datetime(), id: z.string().uuid(), snapshot: z.string().datetime() }).strict();
export async function findNotifications(tenantId: string, userId: string, input: Record<string, unknown>) {
  const query = NotificationQuerySchema.parse(input);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString())); }
    catch { throw new ValidationError('Invalid notification cursor'); }
  }
  const snapshot = cursor?.snapshot ?? query.snapshot ?? new Date().toISOString();
  const where: Prisma.NotificationWhereInput = { tenantId, userId, createdAt: { lte: new Date(snapshot) },
    ...(query.unreadOnly === 'true' || query.isRead === 'false' ? { isRead: false } : query.isRead === 'true' ? { isRead: true } : {}) };
  const after: Prisma.NotificationWhereInput = cursor ? { OR: [
    { createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
  ] } : {};
  const [rows, total, totals] = await prisma.$transaction(async tx => Promise.all([
    tx.notification.findMany({ where: { AND: [where, after] }, take: query.limit + 1,
      ...(cursor ? {} : { skip: (query.page - 1) * query.limit }), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    tx.notification.count({ where }), counts(tx, tenantId, userId),
  ]), { isolationLevel: 'RepeatableRead' });
  const hasMore = rows.length > query.limit;
  const records = rows.slice(0, query.limit), last = records[records.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id, snapshot })).toString('base64url') : null;
  return { data: await presentNotifications(tenantId, userId, records),
    meta: { total, page: query.page, limit: query.limit, hasMore, nextCursor, snapshot }, ...totals };
}

async function counts(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  // Both values come from one SQL snapshot, including inside mutation transactions.
  const groups = await tx.notification.groupBy({ by: ['isRead'], where: { tenantId, userId }, _count: { _all: true } });
  return { totalCount: groups.reduce((sum, row) => sum + row._count._all, 0), unreadCount: groups.find(row => !row.isRead)?._count._all ?? 0 };
}
export async function notificationCounts(tenantId: string, userId: string) {
  return prisma.$transaction(tx => counts(tx, tenantId, userId), { isolationLevel: 'RepeatableRead' });
}
export async function markNotificationRead(id: string, tenantId: string, userId: string) {
  return prisma.$transaction(async tx => {
    if (!await tx.notification.findFirst({ where: { id, tenantId, userId }, select: { id: true } })) throw new NotFoundError('Notification');
    await tx.notification.updateMany({ where: { id, tenantId, userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return counts(tx, tenantId, userId);
  });
}
export async function markAllNotificationsRead(tenantId: string, userId: string, before = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.notification.updateMany({ where: { tenantId, userId, isRead: false, createdAt: { lte: before } }, data: { isRead: true, readAt: new Date() } });
    return { ...await counts(tx, tenantId, userId), readBefore: before.toISOString() };
  });
}
export async function deleteNotifications(ids: string[], tenantId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const unique = [...new Set(ids)];
    const result = await tx.notification.deleteMany({ where: { id: { in: unique }, tenantId, userId } });
    if (result.count !== unique.length) throw new NotFoundError('Notification');
    return counts(tx, tenantId, userId);
  });
}

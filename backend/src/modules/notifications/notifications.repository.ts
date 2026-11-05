import prisma from '../../config/database.config';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { NotificationQuerySchema, SmsCampaignNotificationTypes, NotificationRecordTargetSchema, notificationSettingsTab, type NotificationSettingsTab, type NotificationRecordTarget, type UnreadNotificationRecord } from '@leadcrm/shared';
import { NotFoundError, ValidationError } from '../../shared/errors/http-error';
import { presentNotifications, notificationAccess } from './notification-access';
import { getNotificationPreferences } from './notification-preferences.service';

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
  const [rows, total, totals] = await prisma.$transaction(async tx => {
    const access = await notificationAccess(tenantId, userId, tx);
    const visibleWhere = { ...where, AND: [access.visibilityWhere] };
    return Promise.all([
      tx.notification.findMany({ where: { AND: [visibleWhere, after] }, take: query.limit + 1,
        ...(cursor ? {} : { skip: (query.page - 1) * query.limit }), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      tx.notification.count({ where: visibleWhere }), counts(tx, tenantId, userId, access),
    ]);
  }, { isolationLevel: 'RepeatableRead' });
  const hasMore = rows.length > query.limit;
  const records = rows.slice(0, query.limit), last = records[records.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id, snapshot })).toString('base64url') : null;
  return { data: await presentNotifications(tenantId, userId, records),
    meta: { total, page: query.page, limit: query.limit, hasMore, nextCursor, snapshot }, ...totals };
}

async function counts(tx: Prisma.TransactionClient, tenantId: string, userId: string,
  access?: Awaited<ReturnType<typeof notificationAccess>>) {
  access ??= await notificationAccess(tenantId, userId, tx);
  const where = { tenantId, userId, AND: [access.visibilityWhere] };
  // Both values come from one SQL snapshot, including inside mutation transactions.
  const groups = await tx.notification.groupBy({ by: ['isRead'], where, _count: { _all: true } });
  const unread = await tx.notification.groupBy({ by: ['type', 'entityType', 'entityId'], where: { ...where, isRead: false }, _count: { _all: true } });
  const unreadByModule: Record<string, number> = {};
  const unreadBySettingsTab: Partial<Record<NotificationSettingsTab, number>> = {};
  const records = new Map<string, UnreadNotificationRecord>();
  for (const group of unread) {
    const target = await access.resolve(group.entityType, group.entityId);
    if (!target) continue;
    const path = target.destination.split('?')[0];
    const module = path.startsWith('/crm/') ? path.split('/')[2]
      : path.startsWith('/marketing/') ? path.split('/')[2]
      : path.startsWith('/automation/') ? 'workflows'
      : path.startsWith('/operations/') ? 'tasks' : path.split('/')[1];
    if (module) unreadByModule[module] = (unreadByModule[module] ?? 0) + group._count._all;
    const tab = notificationSettingsTab(group.type, target.destination);
    if (tab) unreadBySettingsTab[tab] = (unreadBySettingsTab[tab] ?? 0) + group._count._all;
    const record = NotificationRecordTargetSchema.safeParse({ entityType: target.entityType, entityId: target.entityId });
    if (record.success) {
      const key = target.entityType + ':' + target.entityId;
      const previous = records.get(key);
      records.set(key, { ...record.data, count: (previous?.count ?? 0) + group._count._all });
    }
  }
  return { totalCount: groups.reduce((sum, row) => sum + row._count._all, 0), unreadCount: groups.find(row => !row.isRead)?._count._all ?? 0, unreadByModule, unreadBySettingsTab,
    unreadRecords: [...records.values()].sort((a, b) => (a.entityType + ':' + a.entityId).localeCompare(b.entityType + ':' + b.entityId)) };
}
export async function notificationCounts(tenantId: string, userId: string, input: Record<string, unknown> = {}) {
  const query = z.object({ after: z.string().max(2048).optional(), since: z.string().datetime().optional() }).strict().parse(input);
  const now = new Date();
  const shape = z.object({ tenantId: z.string(), userId: z.string(), since: z.string().datetime(), at: z.string().datetime(), id: z.string(), page: z.boolean() }).strict();
  let cursor: z.infer<typeof shape>;
  if (query.after) {
    try { cursor = shape.parse(JSON.parse(Buffer.from(query.after, 'base64url').toString())); }
    catch { throw new ValidationError('Invalid notification update cursor'); }
    if (cursor.tenantId !== tenantId || cursor.userId !== userId) throw new ValidationError('Invalid notification update cursor');
  } else {
    const since = new Date(Math.min(+now, Math.max(+now - 300000, query.since ? Date.parse(query.since) : +now))).toISOString();
    cursor = { tenantId, userId, since, at: since, id: '', page: false };
  }
  const since = new Date(cursor.since);
  const result = await prisma.$transaction(async tx => {
    const access = await notificationAccess(tenantId, userId, tx);
    const totals = await counts(tx, tenantId, userId, access);
    const preferences = await getNotificationPreferences(tenantId, userId, tx);
    const smsEnabled = !access.admin && preferences.data.inAppGeneral;
    const after: Prisma.NotificationWhereInput = cursor.page ? { OR: [
      { createdAt: { gt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), id: { gt: cursor.id } },
    ] } : { createdAt: { gte: new Date(Math.max(+since, Date.parse(cursor.at) - 30000)) } };
    // A small overlap catches transactions committed out of timestamp order.
    // The shared watcher deduplicates immutable notification IDs.
    const rows = smsEnabled ? await tx.notification.findMany({ where: {
      tenantId, userId, type: { in: [...SmsCampaignNotificationTypes] }, occurredAt: { gte: since }, AND: [after, access.visibilityWhere],
    }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101 }) : [];
    const active = smsEnabled ? await tx.campaign.findFirst({ where: {
      tenantId, type: 'SMS', isArchived: false, submissionStartedAt: { gt: new Date(+now - 300000) },
      status: { in: ['SENDING', 'SUBMITTED', 'SENT', 'INTERRUPTED'] }, OR: [{ createdById: userId }, { submittedById: userId }],
    }, orderBy: { submissionStartedAt: 'desc' }, select: { id: true, submissionStartedAt: true } }) : null;
    return { ...totals, rows, active };
  }, { isolationLevel: 'RepeatableRead' });
  const hasMore = result.rows.length > 100;
  const records = result.rows.slice(0, 100);
  const last = records[records.length - 1];
  const next = { ...cursor, at: hasMore && last ? last.createdAt.toISOString() : now.toISOString(), id: hasMore && last ? last.id : '', page: hasMore };
  const updates = (await presentNotifications(tenantId, userId, records)).filter(row => row.available);
  const access = result.active ? await notificationAccess(tenantId, userId) : null;
  return { totalCount: result.totalCount, unreadCount: result.unreadCount, unreadByModule: result.unreadByModule, unreadBySettingsTab: result.unreadBySettingsTab, unreadRecords: result.unreadRecords, updates, hasMore,
    cursor: Buffer.from(JSON.stringify(next)).toString('base64url'),
    activeSmsUntil: result.active?.submissionStartedAt && await access?.resolve('Campaign', result.active.id)
      ? new Date(+result.active.submissionStartedAt + 300000).toISOString() : null };
}
export async function markNotificationRead(id: string, tenantId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const access = await notificationAccess(tenantId, userId, tx);
    const where = { id, tenantId, userId, AND: [access.visibilityWhere] };
    if (!await tx.notification.findFirst({ where, select: { id: true } })) throw new NotFoundError('Notification');
    await tx.notification.updateMany({ where: { ...where, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return counts(tx, tenantId, userId, access);
  });
}
export async function markAllNotificationsRead(tenantId: string, userId: string, before = new Date(), record?: NotificationRecordTarget) {
  return prisma.$transaction(async tx => {
    const access = await notificationAccess(tenantId, userId, tx);
    const where: Prisma.NotificationWhereInput = { tenantId, userId, isRead: false, createdAt: { lte: before }, AND: [access.visibilityWhere] };
    let readRecord: NotificationRecordTarget | undefined;
    if (record) {
      const target = await access.resolve(record.entityType, record.entityId);
      if (!target) throw new NotFoundError('Record');
      readRecord = NotificationRecordTargetSchema.parse({ entityType: target.entityType, entityId: target.entityId });
      const groups = await tx.notification.groupBy({ by: ['entityType', 'entityId'], where });
      const matching: Prisma.NotificationWhereInput[] = [];
      // Resolve through the same associations as presentation (including converted Leads).
      for (const group of groups) {
        const destination = await access.resolve(group.entityType, group.entityId);
        if (destination?.entityType === target.entityType && destination.entityId === target.entityId) matching.push({ entityType: group.entityType, entityId: group.entityId });
      }
      if (matching.length) await tx.notification.updateMany({ where: { ...where, OR: matching }, data: { isRead: true, readAt: new Date() } });
    } else {
      await tx.notification.updateMany({ where, data: { isRead: true, readAt: new Date() } });
    }
    return { ...await counts(tx, tenantId, userId, access), readBefore: before.toISOString(), ...(readRecord ? { readRecord } : {}) };
  });
}
export async function deleteNotifications(ids: string[], tenantId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const access = await notificationAccess(tenantId, userId, tx);
    const unique = [...new Set(ids)];
    const result = await tx.notification.deleteMany({ where: { id: { in: unique }, tenantId, userId, AND: [access.visibilityWhere] } });
    if (result.count !== unique.length) throw new NotFoundError('Notification');
    return counts(tx, tenantId, userId, access);
  });
}

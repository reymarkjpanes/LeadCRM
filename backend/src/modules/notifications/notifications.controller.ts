import { Request, Response, NextFunction } from 'express';
import * as service from './notifications.service';
import { z } from 'zod';
import prisma from '../../config/database.config';
import { notificationCounts } from './notifications.repository';
import { notificationAccess } from './notification-access';
import { getNotificationPreferences, saveNotificationPreferences } from './notification-preferences.service';
import { NotFoundError, ForbiddenError } from '../../shared/errors/http-error';

export async function getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getNotifications(
      req.user!.tenantId,
      req.user!.userId,
      req.query as Record<string, unknown>,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const counts = await service.markRead(
      z.string().uuid().parse(req.params.id),
      req.user!.tenantId,
      req.user!.userId,
    );
    res.json({ success: true, ...counts });
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = z.object({ before: z.string().datetime().optional() }).strict().parse(req.body ?? {});
    const before = input.before ? new Date(Math.min(Date.parse(input.before), Date.now())) : new Date();
    const counts = await service.markAllRead(req.user!.tenantId, req.user!.userId, before);
    res.json({ success: true, ...counts });
  } catch (err) {
    next(err);
  }
}

export async function getCounts(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...await notificationCounts(req.user!.tenantId, req.user!.userId) }); } catch (err) { next(err); }
}
export async function getOperations(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.user!.tenantId;
    if (!(await notificationAccess(tenantId, req.user!.userId)).admin) throw new ForbiddenError();
    const pending = { tenantId, processedAt: null };
    const [total, retrying, leased, oldest, failed] = await prisma.$transaction([
      prisma.notificationEvent.count({ where: pending }),
      prisma.notificationEvent.count({ where: { ...pending, lastError: { not: null } } }),
      prisma.notificationEvent.count({ where: { ...pending, leaseUntil: { gt: new Date() } } }),
      prisma.notificationEvent.findFirst({ where: { ...pending, availableAt: { lte: new Date() } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }], select: { occurredAt: true } }),
      prisma.notificationEvent.findMany({ where: { ...pending, lastError: { not: null } }, take: 50, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, entityType: true, attempts: true, lastError: true, occurredAt: true, availableAt: true, leaseUntil: true } }),
    ]);
    res.json({ success: true, data: { pending: total, retrying, leased, oldestOccurredAt: oldest?.occurredAt ?? null, failed } });
  } catch (err) { next(err); }
}
export async function getPreferences(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...await getNotificationPreferences(req.user!.tenantId, req.user!.userId) }); } catch (err) { next(err); }
}
export async function savePreferences(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, ...await saveNotificationPreferences(req.user!.tenantId, req.user!.userId, req.body) }); } catch (err) { next(err); }
}
export async function getDestination(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const row = await prisma.notification.findFirst({ where: { id, tenantId: req.user!.tenantId, userId: req.user!.userId } });
    if (!row) throw new NotFoundError('Notification');
    const access = await notificationAccess(req.user!.tenantId, req.user!.userId);
    const target = await access.resolve(row.entityType, row.entityId);
    res.json({ success: true, destination: target?.destination ?? null });
  } catch (err) { next(err); }
}

export async function deleteNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const counts = await service.deleteNotifications(req.body.ids, req.user!.tenantId, req.user!.userId);
    res.json({ success: true, ...counts });
  } catch (err) { next(err); }
}

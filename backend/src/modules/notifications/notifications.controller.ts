import { Request, Response, NextFunction } from 'express';
import * as service from './notifications.service';

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
    await service.markRead(
      String(req.params.id),
      req.user!.tenantId,
      req.user!.userId,
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.markAllRead(req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

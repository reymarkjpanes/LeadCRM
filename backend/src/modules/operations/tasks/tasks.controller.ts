import { Request, Response, NextFunction } from 'express';
import * as service from './tasks.service';

export async function getTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getTasks(req.user!.tenantId, req.query as Record<string, unknown>);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getTaskById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getTaskById(String(req.params.id), req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function createTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const task = await service.createTask(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: task });
  } catch (err) { next(err); }
}

export async function updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.updateTask(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function completeTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.completeTask(String(req.params.id), req.user!.tenantId, req.user!.userId) });
  } catch (err) { next(err); }
}

export async function archiveTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archiveTask(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

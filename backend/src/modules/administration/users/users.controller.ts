import { Request, Response, NextFunction } from 'express';
import * as service from './users.service';

export async function getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, ...await service.getAll(req.user!.tenantId, req.query as Record<string, unknown>) });
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getById(String(req.params.id), req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await service.create(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.update(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function archive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archive(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function restore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.restore(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function deleteRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteRecord(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function bulkUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids, ...dto } = req.body;
    await service.bulkUpdate(ids, req.user!.tenantId, req.user!.userId, dto);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function bulkDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids } = req.body;
    await service.bulkDelete(ids, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

import { Request, Response, NextFunction } from 'express';
import * as service from './groups.service';

export async function getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const groups = await service.getAll(req.user!.tenantId);
    res.json({ success: true, data: groups });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const group = await service.create(req.user!.tenantId, req.user!.userId, req.body.name);
    res.status(201).json({ success: true, data: group });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const group = await service.update(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body.name);
    res.json({ success: true, data: group });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.remove(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function addMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.addMember(String(req.params.id), req.body.userId, req.user!.tenantId, req.user!.userId);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.removeMember(String(req.params.id), String(req.params.userId), req.user!.tenantId, req.user!.userId);
    res.status(204).send();
  } catch (err) { next(err); }
}

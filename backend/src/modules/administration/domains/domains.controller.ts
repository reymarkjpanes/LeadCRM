import { Request, Response, NextFunction } from 'express';
import * as service from './domains.service';

export async function getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const domains = await service.getAll(req.user!.tenantId);
    res.json({ success: true, data: domains });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const domain = await service.create(req.user!.tenantId, req.user!.userId, req.body.domain);
    res.status(201).json({ success: true, data: domain });
  } catch (err) { next(err); }
}

export async function verify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const domain = await service.verify(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true, data: domain });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.remove(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await service.getSettings(req.user!.tenantId);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await service.updateSettings(req.user!.tenantId, req.user!.userId, req.body);
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
}

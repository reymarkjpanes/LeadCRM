import { DeactivateUserSchema } from '@leadcrm/shared';
import * as deactivation from './user-deactivation.service';
import { Request, Response, NextFunction } from 'express';
import * as service from './users.service';
import { z } from 'zod';

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

export async function getAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bytes = await service.getAvatar(String(req.params.id), req.user!.tenantId, String(req.params.avatarId));
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
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
    await service.restore(z.string().uuid().parse(req.params.id), req.user!.tenantId, req.user!.userId);
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

export async function sendPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.sendPasswordReset(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.status(202).json({ success: true, message: 'Password reset email requested.' });
  } catch (err) { next(err); }
}

export async function deactivationImpact(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await deactivation.deactivationImpact(z.string().uuid().parse(req.params.id), req.user!.tenantId, req.user!.userId) }); }
  catch (error) { next(error); }
}
export async function deactivate(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const { replacementAgentId } = DeactivateUserSchema.parse(req.body);
    const impact = await deactivation.deactivateUser(id, req.user!.tenantId, req.user!.userId, replacementAgentId);
    res.json({ success: true, data: { user: await service.getById(id, req.user!.tenantId), impact } });
  } catch (error) { next(error); }
}

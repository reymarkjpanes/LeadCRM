import type { Request, Response, NextFunction } from 'express';
import * as service from './organization-settings.service';

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.set('Cache-Control', 'private, no-store').json({ success: true, data: await service.getOrganizationSettings(req.user!.tenantId) }); }
  catch (error) { next(error); }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.set('Cache-Control', 'private, no-store').json({ success: true, data: await service.updateOrganizationSettings(req.user!.tenantId, req.user!.userId, req.body) }); }
  catch (error) { next(error); }
}

import { Request, Response, NextFunction } from 'express';
import * as service from './audiences.service';
export async function getAudiences(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.getAudiences(req.user!.tenantId) }); } catch (e) { next(e); }
}
export async function createAudience(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: await service.createAudience(req.user!.tenantId, req.body) }); } catch (e) { next(e); }
}
export async function previewAudience(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.previewAudience(req.user!.tenantId, req.body) }); } catch (e) { next(e); }
}

export async function audienceCompanies(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.audienceCompanies(req.user!.tenantId, req.query.source ?? 'ALL') }); } catch (e) { next(e); }
}

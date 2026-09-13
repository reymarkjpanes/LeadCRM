import { Request, Response, NextFunction } from 'express';
import * as service from './templates.service';

export async function getTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, ...await service.getTemplates(req.user!.tenantId, req.query as Record<string, unknown>) }); } catch (e) { next(e); }
}
export async function getTemplateById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getTemplateById(String(req.params.id), req.user!.tenantId) }); } catch (e) { next(e); }
}
export async function createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.status(201).json({ success: true, data: await service.createTemplate(req.user!.tenantId, req.user!.userId, req.body) }); } catch (e) { next(e); }
}
export async function updateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.updateTemplate(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) }); } catch (e) { next(e); }
}
export async function archiveTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await service.archiveTemplate(String(req.params.id), req.user!.tenantId, req.user!.userId); res.json({ success: true }); } catch (e) { next(e); }
}

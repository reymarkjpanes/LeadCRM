import { Request, Response, NextFunction } from 'express';
import * as service from './campaigns.service';

export async function getCampaigns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, ...await service.getCampaigns(req.user!.tenantId, req.query as Record<string, unknown>) }); } catch (e) { next(e); }
}
export async function getCampaignById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getCampaignById(String(req.params.id), req.user!.tenantId) }); } catch (e) { next(e); }
}
export async function createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.status(201).json({ success: true, data: await service.createCampaign(req.user!.tenantId, req.user!.userId, req.body) }); } catch (e) { next(e); }
}
export async function updateCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.updateCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) }); } catch (e) { next(e); }
}
export async function sendCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.sendCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId) }); } catch (e) { next(e); }
}
export async function archiveCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await service.archiveCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId); res.json({ success: true }); } catch (e) { next(e); }
}

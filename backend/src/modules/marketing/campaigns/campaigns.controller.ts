import { assertPermissions } from '../../../core/permissions/permission.service';
import { AppError } from '../../../shared/errors/app-error';
﻿import { Request, Response, NextFunction } from 'express';
import * as service from './campaigns.service';

export async function getCampaigns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, ...await presentCampaigns(req, await service.getCampaigns(req.user!.tenantId, req.query as Record<string, unknown>)) }); } catch (e) { next(e); }
}
export async function getCampaignById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await presentCampaign(req, await service.getCampaignById(String(req.params.id), req.user!.tenantId)) }); } catch (e) { next(e); }
}
export async function createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.status(201).json({ success: true, data: await service.createCampaign(req.user!.tenantId, req.user!.userId, req.body) }); } catch (e) { next(e); }
}
export async function updateCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await presentCampaign(req, await service.updateCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body)) }); } catch (e) { next(e); }
}
export async function sendCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.status(202).json({ success: true, data: await service.queueCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId) }); } catch (e) { next(e); }
}
export async function archiveCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await service.archiveCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId); res.json({ success: true }); } catch (e) { next(e); }
}

export async function getCampaignMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getCampaignMetrics(req.user!.tenantId) }); } catch (e) { next(e); }
}

export async function duplicateCampaign(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: await service.duplicateCampaign(String(req.params.id), req.user!.tenantId, req.user!.userId) }); } catch (error) { next(error); }
}
export async function getCampaignReport(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.getCampaignById(String(req.params.id), req.user!.tenantId) }); } catch (error) { next(error); }
}

async function presentCampaign<T extends object>(req: Request, campaign: T): Promise<T> {
  try { await assertPermissions(req.user!, ['campaigns.view_reports']); return campaign; }
  catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
  const result = { ...campaign } as Record<string, unknown>;
  let canSend = false;
  try { await assertPermissions(req.user!, ['campaigns.send']); canSend = true; } catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
  if (!canSend) delete result.sendResult;
  for (const key of ['recipientCount','sentCount','failedCount','openedCount','clickedCount','deliveredCount','bouncedCount','engagement']) delete result[key];
  return result as T;
}
async function presentCampaigns<T extends { data: object[] }>(req: Request, page: T): Promise<T> {
  return { ...page, data: await Promise.all(page.data.map(row => presentCampaign(req, row))) };
}

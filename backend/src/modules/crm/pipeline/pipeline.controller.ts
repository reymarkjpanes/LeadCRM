import { Request, Response, NextFunction } from 'express';
import * as service from './pipeline.service';
import { PIPELINE_TEMPLATES } from './pipeline.templates';

export async function getPipelineTemplates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: PIPELINE_TEMPLATES });
  } catch (err) { next(err); }
}

export async function getPipelines(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getPipelines(req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function getPipelineById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getPipelineById(String(req.params.id), req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function createPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const p = await service.createPipeline(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: p });
  } catch (err) { next(err); }
}

export async function updatePipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.updatePipeline(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function deletePipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deletePipeline(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function archivePipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archivePipeline(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function createStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const s = await service.createStage(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function updateStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.updateStage(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function deleteStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteStage(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function reorderStages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.reorderStages(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function reorderDeals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.reorderDeals(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

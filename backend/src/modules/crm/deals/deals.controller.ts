import { Request, Response, NextFunction } from 'express';
import * as service from './deals.service';
import * as forecastService from './forecast.service';
import { DealsQuerySchema } from './deals.dto';

export async function getDeals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validation = DealsQuerySchema.safeParse(req.query);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: validation.error.errors[0]?.message ?? 'Invalid query parameters',
      });
      return;
    }

    const params = validation.data;

    // Branch for grouped-by-stage pipeline pagination
    if (params.groupByStage === 'true' && params.pipelineId) {
      const stagePageMap = req.query.stagePages
        ? JSON.parse(String(req.query.stagePages)) as Record<string, number>
        : undefined;
      const result = await service.getDealsGroupedByStage(req.user!.tenantId, params.pipelineId, stagePageMap);
      res.json({ success: true, data: { stages: result } });
      return;
    }

    const result = await service.getDeals(req.user!.tenantId, params);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getDealById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deal = await service.getDealById(String(req.params.id), req.user!.tenantId);
    res.json({ success: true, data: deal });
  } catch (err) { next(err); }
}

export async function createDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deal = await service.createDeal(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: deal });
  } catch (err) { next(err); }
}

export async function updateDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deal = await service.updateDeal(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body);
    res.json({ success: true, data: deal });
  } catch (err) { next(err); }
}

export async function moveDealStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.moveDealStage(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function archiveDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archiveDeal(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body?.archiveReason);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getForecast(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { pipelineId } = req.query;
    const result = await forecastService.computeForecast(
      req.user!.tenantId,
      pipelineId ? String(pipelineId) : undefined
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function restoreDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deal = await service.restoreDeal(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true, data: deal });
  } catch (err) { next(err); }
}

export async function duplicateDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deal = await service.duplicateDeal(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.status(201).json({ success: true, data: deal });
  } catch (err) { next(err); }
}

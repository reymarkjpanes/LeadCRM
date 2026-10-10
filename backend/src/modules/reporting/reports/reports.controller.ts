import { Request, Response, NextFunction } from 'express';
import * as service from './reports.service';
import { getDashboard } from './dashboard.service';

export async function getPipelineSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await getDashboard(req.user!, { range: 'thisMonth' });
    const pipeline = report.pipeline;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: pipeline && (!req.query.pipelineId || req.query.pipelineId === pipeline.id) ? [{
      pipelineId: pipeline.id, name: pipeline.name, stages: pipeline.stages.map(stage => ({ ...stage, stageId: stage.id,
        dealCount: report.distribution.find(row => row.id === stage.id)?.count ?? (stage.isWon ? report.metrics.won : report.metrics.lost) ?? 0,
      })),
    }] : [] });
  } catch (err) { next(err); }
}
export async function getDealVelocity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const report = await getDashboard(req.user!, { range: 'thisMonth' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: { totalClosed: (report.metrics.won ?? 0) + (report.metrics.lost ?? 0),
      totalWon: report.metrics.won, totalLost: report.metrics.lost, avgDaysToCloseWon: report.metrics.averageDealDays, avgDaysToCloseLost: null } });
  } catch (err) { next(err); }
}
export async function getContactStatusBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: await service.getContactStatusBreakdown(req.user!.tenantId) }); } catch (err) { next(err); }
}
export async function getTaskCompletion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, data: await service.getTaskCompletion(req.user!.tenantId) }); } catch (err) { next(err); }
}
export async function getCampaignSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ success: true, data: await service.getCampaignSummary(req.user!.tenantId) }); } catch (err) { next(err); }
}

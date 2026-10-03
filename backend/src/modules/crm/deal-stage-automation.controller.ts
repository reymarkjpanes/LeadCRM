import type { Request, Response, NextFunction } from 'express';
import { getDealStageAutomation, saveDealStageAutomation } from './deal-stage-automation.service';

export async function get(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await getDealStageAutomation(req.user!.tenantId) }); } catch (error) { next(error); }
}
export async function update(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await saveDealStageAutomation(req.user!.tenantId, req.user!.userId, req.body) }); } catch (error) { next(error); }
}

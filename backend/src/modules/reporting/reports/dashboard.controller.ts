import type { Request, Response, NextFunction } from 'express';
import { dashboardCsv } from '@leadcrm/shared';
import { getDashboard } from './dashboard.service';

export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await getDashboard(req.user!, req.query) });
  } catch (error) { next(error); }
}
export async function exportDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const report = await getDashboard(req.user!, req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="LeadCRM_Dashboard_${report.period.start}_${report.period.end}.csv"`);
    res.send(dashboardCsv(report));
  } catch (error) { next(error); }
}

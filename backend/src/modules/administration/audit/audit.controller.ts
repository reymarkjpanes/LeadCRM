import { Request, Response, NextFunction } from 'express';
import { getAuditLogs as fetchAuditLogs } from './audit.service';

export async function getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await fetchAuditLogs(req.user!.tenantId, { ...req.query, entityType: 'User' });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

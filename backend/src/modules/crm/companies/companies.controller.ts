import { Request, Response, NextFunction } from 'express';
import * as service from './companies.service';

export async function getCompanies(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getCompanies(req.user!.tenantId, req.query as Record<string, unknown>);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getCompanyById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getCompanyById(String(req.params.id), req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function createCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const company = await service.createCompany(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: company });
  } catch (err) { next(err); }
}

export async function updateCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.updateCompany(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function archiveCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archiveCompany(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

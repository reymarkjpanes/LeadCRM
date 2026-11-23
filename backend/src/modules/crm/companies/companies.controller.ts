import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './companies.service';

export async function getCompanies(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getCompanies(req.user!.tenantId, { ...req.query, currentUserId: req.user!.userId });
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
    const { company, replayed } = await service.createCompanyResult(req.user!.tenantId, req.user!.userId, req.body, true);
    res.status(replayed ? 200 : 201).json({ success: true, data: company });
  } catch (err) { next(err); }
}

export async function updateCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.updateCompany(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function archiveCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await service.archiveCompany(id, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function restoreCompany(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await service.restoreCompany(id, req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

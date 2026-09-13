import { Request, Response, NextFunction } from 'express';
import * as service from './invoices.service';

export async function getInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, ...await service.getInvoices(req.user!.tenantId, req.query as Record<string, unknown>) });
  } catch (err) { next(err); }
}

export async function getInvoiceById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.getInvoiceById(String(req.params.id), req.user!.tenantId) });
  } catch (err) { next(err); }
}

export async function createInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoice = await service.createInvoice(req.user!.tenantId, req.user!.userId, req.body);
    res.status(201).json({ success: true, data: invoice });
  } catch (err) { next(err); }
}

export async function updateInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.updateInvoice(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function markInvoicePaid(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await service.markInvoicePaid(String(req.params.id), req.user!.tenantId, req.user!.userId, req.body) });
  } catch (err) { next(err); }
}

export async function archiveInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.archiveInvoice(String(req.params.id), req.user!.tenantId, req.user!.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

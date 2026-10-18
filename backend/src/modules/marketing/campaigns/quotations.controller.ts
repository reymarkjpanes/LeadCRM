import type { Request, Response, NextFunction } from 'express';
import * as service from './quotations.service';

export async function preview(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.previewQuotation(req.user!, req.body) }); } catch (error) { next(error); }
}
export async function send(req: Request, res: Response, next: NextFunction) {
  try { res.json({ success: true, data: await service.sendQuotation(req.user!, req.body) }); } catch (error) { next(error); }
}
export async function templatePdf(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.quotationTemplatePdf(req.user!.tenantId, String(req.params.id));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Cache-Control': 'private, no-store' }).send(result.data);
  } catch (error) { next(error); }
}

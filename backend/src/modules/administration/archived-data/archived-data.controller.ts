import type { Request, Response, NextFunction } from 'express';
import { ArchiveQuerySchema, ArchiveRestoreParamsSchema } from '@leadcrm/shared';
import * as service from './archived-data.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, ...await service.list(req.user!, ArchiveQuerySchema.parse(req.query)) });
  } catch (error) { next(error); }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    await service.restore(req.user!, ArchiveRestoreParamsSchema.parse(req.params));
    res.json({ success: true });
  } catch (error) { next(error); }
}

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPublicForm, submitPublicForm, SubmissionValidationError } from './public-forms.service';
export async function get(req: Request, res: Response, next: NextFunction) {
  try { res.set('Cache-Control', 'no-store').json({ success: true, data: await getPublicForm(z.string().uuid().parse(req.params.publicId)) }); } catch (err) { next(err); }
}
export async function submit(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json({ success: true, data: await submitPublicForm(z.string().uuid().parse(req.params.publicId), req.body) }); }
  catch (err) { if (err instanceof SubmissionValidationError) { res.status(400).json({ success: false, error: err.message, fieldErrors: err.fieldErrors }); return; } next(err); }
}

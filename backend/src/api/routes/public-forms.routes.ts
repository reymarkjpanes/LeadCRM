import { Router, json } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../../modules/marketing/forms/public-forms.controller';
export const publicFormsRouter = Router();
export const formSubmissionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Too many submissions. Please try again later.' } });
publicFormsRouter.get('/:publicId', controller.get);
publicFormsRouter.post('/:publicId/submissions', formSubmissionLimiter, json({ limit: '64kb' }), controller.submit);

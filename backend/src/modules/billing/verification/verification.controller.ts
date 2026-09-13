/**
 * verification.controller.ts
 * HTTP handlers for the business verification API.
 * Thin layer — delegates all logic to the service.
 */

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { AppError } from '../../../shared/errors/app-error';
import { SubmitVerificationSchema, DocumentKeySchema } from './verification.dto';
import * as service from './verification.service';
import { getDocumentAbsolutePath } from '../../../api/middleware/upload.middleware';

// ─── GET /billing/verification ────────────────────────────────────────────────

/**
 * Returns the tenant's current verification status and uploaded documents.
 */
export async function getVerificationStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const state = await service.getStatus(tenantId);
    res.json({ success: true, data: state });
  } catch (err) {
    next(err);
  }
}

// ─── POST /billing/verification/documents ────────────────────────────────────

/**
 * Uploads a single verification document.
 * Expects multipart/form-data with field 'document' (the file) and
 * body field 'documentKey' identifying which document slot to fill.
 */
export async function uploadVerificationDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    if (!req.file) {
      throw new AppError('No file uploaded. Please attach a file to the "document" field.', 400);
    }

    const documentKeyResult = DocumentKeySchema.safeParse(req.body.documentKey);
    if (!documentKeyResult.success) {
      throw new AppError('Invalid or missing documentKey in request body.', 400);
    }

    const document = await service.uploadDocument(tenantId, documentKeyResult.data, req.file);

    res.status(201).json({ success: true, data: { document } });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /billing/verification/documents/:documentKey ──────────────────────

/**
 * Removes a verification document from this tenant's submission.
 */
export async function removeVerificationDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const documentKeyResult = DocumentKeySchema.safeParse(req.params.documentKey);

    if (!documentKeyResult.success) {
      throw new AppError('Invalid document key.', 400);
    }

    await service.removeDocument(tenantId, documentKeyResult.data);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /billing/verification/submit ───────────────────────────────────────

/**
 * Submits all uploaded documents for admin review.
 * Sets verification status to PENDING.
 */
export async function submitVerification(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    const parsed = SubmitVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      const field = parsed.error.errors[0];
      throw new AppError(field?.message ?? 'Invalid request body.', 400);
    }

    const result = await service.submit(tenantId, parsed.data.businessType);

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ─── GET /billing/verification/documents/:documentKey/file ───────────────────

/**
 * Streams a verification document file to the authenticated tenant.
 * Only the owning tenant (or System Admin) can download.
 * tenantId comes from JWT — never from URL params.
 */
export async function downloadVerificationDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const documentKeyResult = DocumentKeySchema.safeParse(req.params.documentKey);

    if (!documentKeyResult.success) {
      throw new AppError('Invalid document key.', 400);
    }

    const docInfo = await service.getDocumentFilePath(tenantId, documentKeyResult.data);

    if (!docInfo) {
      throw new AppError('Document not found.', 404);
    }

    const absolutePath = getDocumentAbsolutePath(docInfo.filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new AppError('Document file not found on server.', 404);
    }

    const contentType = docInfo.mimeType ?? 'application/octet-stream';
    const filename = encodeURIComponent(docInfo.fileName);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Stream the file — never serve with public URL, always through this authenticated endpoint
    const fileStream = fs.createReadStream(absolutePath);
    fileStream.on('error', () => {
      next(new AppError('Failed to read document file.', 500));
    });
    fileStream.pipe(res);
  } catch (err) {
    next(err);
  }
}

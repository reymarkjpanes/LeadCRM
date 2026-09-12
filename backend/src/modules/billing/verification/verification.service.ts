/**
 * verification.service.ts
 * Business logic for the verification flow.
 * No req/res objects — pure business rules only.
 */

import { AppError } from '../../../shared/errors/app-error';
import { deleteDocumentFile } from '../../../api/middleware/upload.middleware';
import * as repo from './verification.repository';
import { DOCUMENT_KEYS } from './verification.dto';
import type { DocumentKey, TenantVerificationState, VerificationDocument } from './verification.types';

// ─── Required document keys (always required, regardless of business type) ───
// The 4 base required documents. Conditional docs (articlesOf*, industryPermit)
// are validated on the frontend based on businessType; backend only requires these 4.

const BASE_REQUIRED_KEYS: DocumentKey[] = [
  'businessRegistration',
  'birCertificate',
  'businessPermit',
  'proofOfAddress',
];

// ─── Get Status ──────────────────────────────────────────────────────────────

export async function getStatus(tenantId: string): Promise<TenantVerificationState> {
  return repo.getVerificationStatus(tenantId);
}

// ─── Upload Document ─────────────────────────────────────────────────────────

/**
 * Validates and stores a verification document.
 * The file is already on disk (written by multer before this is called).
 * If a previous version of the same document key exists, its file is removed.
 */
export async function uploadDocument(
  tenantId: string,
  documentKey: string,
  file: Express.Multer.File,
): Promise<VerificationDocument> {
  // Validate document key is a known slot
  if (!(DOCUMENT_KEYS as readonly string[]).includes(documentKey)) {
    throw new AppError(`Invalid document key: ${documentKey}`, 400);
  }

  // Relative path stored in DB — makes the path portable across deploys
  const relativeFilePath = `uploads/documents/${file.filename}`;

  const { document, oldFilePath } = await repo.upsertDocument(
    tenantId,
    documentKey,
    file.originalname,
    relativeFilePath,
    file.size,
    file.mimetype,
  );

  // Clean up the previous file version after DB upsert succeeds
  if (oldFilePath) {
    await deleteDocumentFile(oldFilePath);
  }

  return document;
}

// ─── Remove Document ─────────────────────────────────────────────────────────

/**
 * Deletes a document record and removes the physical file from disk.
 */
export async function removeDocument(
  tenantId: string,
  documentKey: string,
): Promise<void> {
  if (!(DOCUMENT_KEYS as readonly string[]).includes(documentKey)) {
    throw new AppError(`Invalid document key: ${documentKey}`, 400);
  }

  const filePath = await repo.deleteDocumentRecord(tenantId, documentKey);

  if (filePath) {
    await deleteDocumentFile(filePath);
  }
}

// ─── Submit Verification ─────────────────────────────────────────────────────

/**
 * Validates that all 4 base required documents are uploaded, then
 * sets verification status to PENDING.
 */
export async function submit(
  tenantId: string,
  businessType: string,
): Promise<{ verificationStatus: string }> {
  const state = await repo.getVerificationStatus(tenantId);

  // Prevent duplicate submission when already pending or approved
  if (state.verificationStatus === 'APPROVED') {
    throw new AppError('Your business is already verified.', 400);
  }

  // Check base required documents
  const uploadedKeys = new Set(state.documents.map((d) => d.documentKey));
  const missingKeys = BASE_REQUIRED_KEYS.filter((key) => !uploadedKeys.has(key));

  if (missingKeys.length > 0) {
    throw new AppError(
      `Missing required documents: ${missingKeys.join(', ')}. Please upload all required documents before submitting.`,
      400,
    );
  }

  await repo.submitVerificationRecord(tenantId, businessType);

  return { verificationStatus: 'PENDING' };
}

// ─── Get Document File Path ───────────────────────────────────────────────────

export async function getDocumentFilePath(
  tenantId: string,
  documentKey: string,
): Promise<{ filePath: string; fileName: string; mimeType: string | null } | null> {
  return repo.getDocumentFilePath(tenantId, documentKey);
}

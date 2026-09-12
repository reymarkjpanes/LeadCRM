/**
 * verification.repository.ts
 * Prisma data-access layer for business verification.
 * All queries are tenant-scoped — tenantId always comes from JWT, never from request body.
 */

import prisma from '../../../config/database.config';
import type { TenantVerificationState, VerificationDocument, DocumentKey, BusinessType } from './verification.types';

// ─── Get Verification Status ──────────────────────────────────────────────────

/**
 * Returns the full verification state for a tenant: status, businessType,
 * rejectionReason, and all uploaded documents.
 */
export async function getVerificationStatus(tenantId: string): Promise<TenantVerificationState> {
  const [tenant, rawDocuments] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        verificationStatus: true,
        businessType: true,
        verificationRejectionReason: true,
      },
    }),
    prisma.tenantDocument.findMany({
      where: { tenantId },
      orderBy: { uploadedAt: 'asc' },
    }),
  ]);

  const documents: VerificationDocument[] = rawDocuments.map((doc) => ({
    id: doc.id,
    tenantId: doc.tenantId,
    documentKey: doc.documentKey as DocumentKey,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: (doc as unknown as Record<string, unknown>).mimeType as string | null ?? null,
    status: doc.status,
    rejectionReason: (doc as unknown as Record<string, unknown>).rejectionReason as string | null ?? null,
    uploadedAt: doc.uploadedAt,
  }));

  return {
    verificationStatus: (tenant?.verificationStatus ?? 'NOT_SUBMITTED') as TenantVerificationState['verificationStatus'],
    businessType: (tenant?.businessType ?? null) as BusinessType | null,
    verificationRejectionReason: (tenant?.verificationRejectionReason ?? null) as string | null,
    documents,
  };
}

// ─── Upsert Document ─────────────────────────────────────────────────────────

/**
 * Creates or replaces a document for a given document key.
 * Upsert is keyed on [tenantId, documentKey] — one slot per document type per tenant.
 * Returns the old filePath (if a previous version existed) for disk cleanup.
 */
export async function upsertDocument(
  tenantId: string,
  documentKey: string,
  fileName: string,
  filePath: string,
  fileSize: number | null,
  mimeType: string | null,
): Promise<{ document: VerificationDocument; oldFilePath: string | null }> {
  // Find existing document to get old file path for cleanup
  const existing = await prisma.tenantDocument.findFirst({
    where: { tenantId, documentKey },
    select: { filePath: true },
  });

  const doc = await prisma.tenantDocument.upsert({
    where: { tenantId_documentKey: { tenantId, documentKey } },
    update: {
      fileName,
      filePath,
      fileSize,
      mimeType,
      status: 'pending',
      rejectionReason: null,
      uploadedAt: new Date(),
      verifiedById: null,
      verifiedAt: null,
    },
    create: {
      tenantId,
      documentKey,
      fileName,
      filePath,
      fileSize,
      mimeType,
      documentType: 'business_doc',
      status: 'pending',
    },
  });

  const result: VerificationDocument = {
    id: doc.id,
    tenantId: doc.tenantId,
    documentKey: doc.documentKey as DocumentKey,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: (doc as unknown as Record<string, unknown>).mimeType as string | null ?? null,
    status: doc.status,
    rejectionReason: (doc as unknown as Record<string, unknown>).rejectionReason as string | null ?? null,
    uploadedAt: doc.uploadedAt,
  };

  return {
    document: result,
    oldFilePath: existing?.filePath ?? null,
  };
}

// ─── Delete Document ─────────────────────────────────────────────────────────

/**
 * Deletes a document record from the database.
 * Returns the filePath so the caller can clean up the file from disk.
 * Returns null if no record exists (idempotent).
 */
export async function deleteDocumentRecord(
  tenantId: string,
  documentKey: string,
): Promise<string | null> {
  const doc = await prisma.tenantDocument.findFirst({
    where: { tenantId, documentKey },
    select: { id: true, filePath: true },
  });

  if (!doc) return null;

  await prisma.tenantDocument.delete({ where: { id: doc.id } });
  return doc.filePath;
}

// ─── Submit Verification ─────────────────────────────────────────────────────

/**
 * Sets the tenant's verificationStatus to PENDING and records businessType.
 * Called after all required documents are uploaded.
 */
export async function submitVerificationRecord(
  tenantId: string,
  businessType: string,
): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      verificationStatus: 'PENDING',
      businessType,
    },
  });
}

// ─── Get Document File Path ───────────────────────────────────────────────────

/**
 * Returns the filePath for a document, verifying tenant ownership.
 * Returns null if not found or belongs to a different tenant.
 */
export async function getDocumentFilePath(
  tenantId: string,
  documentKey: string,
): Promise<{ filePath: string; fileName: string; mimeType: string | null } | null> {
  const doc = await prisma.tenantDocument.findFirst({
    where: { tenantId, documentKey },
    select: { filePath: true, fileName: true, mimeType: true },
  });

  if (!doc) return null;

  return {
    filePath: doc.filePath,
    fileName: doc.fileName,
    mimeType: (doc as unknown as Record<string, unknown>).mimeType as string | null ?? null,
  };
}

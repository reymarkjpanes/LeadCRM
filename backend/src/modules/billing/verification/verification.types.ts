/**
 * verification.types.ts
 * TypeScript interfaces for the business verification module.
 */

// ─── Status Values ────────────────────────────────────────────────────────────

export type VerificationStatus =
  | 'NOT_SUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REQUIRES_RESUBMISSION';

// ─── Document Keys ────────────────────────────────────────────────────────────

export type DocumentKey =
  | 'businessRegistration'
  | 'birCertificate'
  | 'businessPermit'
  | 'proofOfAddress'
  | 'articlesOfIncorporation'
  | 'articlesOfPartnership'
  | 'industryPermit';

// ─── Business Types ───────────────────────────────────────────────────────────

export type BusinessType =
  | 'Sole Proprietorship'
  | 'Corporation'
  | 'Partnership'
  | 'Cooperative'
  | 'Other';

// ─── Document Record ─────────────────────────────────────────────────────────

export interface VerificationDocument {
  id: string;
  tenantId: string;
  documentKey: DocumentKey;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  status: string;
  rejectionReason: string | null;
  uploadedAt: Date;
}

// ─── Tenant Verification State ───────────────────────────────────────────────

export interface TenantVerificationState {
  verificationStatus: VerificationStatus;
  businessType: BusinessType | null;
  verificationRejectionReason: string | null;
  documents: VerificationDocument[];
}

// ─── Upload Result ────────────────────────────────────────────────────────────

export interface UploadDocumentResult {
  document: VerificationDocument;
}

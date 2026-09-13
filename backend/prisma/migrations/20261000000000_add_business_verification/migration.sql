-- Migration: add_business_verification
-- Adds business verification fields to Tenant and extends TenantDocument
-- for structured document upload during the subscription verification flow.
-- Date: 2026-10-01

-- Tenant: Add verification fields

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "verificationStatus"          TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS "businessType"                TEXT,
  ADD COLUMN IF NOT EXISTS "verificationRejectionReason" TEXT;

-- TenantDocument: Add document key, mime type, rejection reason

ALTER TABLE "TenantDocument"
  ADD COLUMN IF NOT EXISTS "documentKey"     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "mimeType"        TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

-- Back-fill existing rows so the unique constraint can be applied
UPDATE "TenantDocument" SET "documentKey" = CONCAT('legacy_', id) WHERE "documentKey" = '';

-- Add unique constraint: one document per key per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'TenantDocument_tenantId_documentKey_key'
  ) THEN
    ALTER TABLE "TenantDocument" ADD CONSTRAINT "TenantDocument_tenantId_documentKey_key"
      UNIQUE ("tenantId", "documentKey");
  END IF;
END $$;
-- ============================================================
-- Migration: remove_organization_model
-- Completes ADR-001 contract phase (Phase 5 / expand→contract).
--
-- WHAT THIS DOES
-- ──────────────
-- 1. Drops Contact.organizationId FK and its index.
-- 2. Drops the Organization table (and its indexes / FK constraints).
-- 3. Removes the back-relation columns from Tenant and User that Prisma
--    synthesises for the Organization relations. These are virtual in
--    Prisma (no physical column) — only the Organization table rows
--    need dropping.
--
-- SAFETY
-- ──────
-- • All Contact rows already have Contact.accountId populated by the
--   prior expand phase (migration 20260902000000_add_contact_account_id).
--   contacts-v2.repository.ts has been deleting organizationId on every
--   write since ADR-001 was implemented, so the column is effectively
--   empty in production.
-- • No application code reads Contact.organizationId any longer;
--   relationships.service.ts was patched alongside this migration.
-- • The Organization TABLE itself has never been written to by production
--   code paths post-ADR-001. It is safe to drop.
--
-- IDEMPOTENT GUARDS (IF EXISTS) prevent failure on repeated runs.
-- ============================================================

-- 1. Drop the FK constraint on Contact → Organization
DO $$ BEGIN
  ALTER TABLE "Contact"
    DROP CONSTRAINT IF EXISTS "Contact_organizationId_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- 2. Drop the index on Contact(tenantId, organizationId)
DROP INDEX IF EXISTS "Contact_tenantId_organizationId_idx";

-- 3. Drop the organizationId column from Contact
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "organizationId";

-- 4. Drop the FK constraints on Organization table (outgoing)
DO $$ BEGIN
  ALTER TABLE "Organization"
    DROP CONSTRAINT IF EXISTS "Organization_tenantId_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Organization"
    DROP CONSTRAINT IF EXISTS "Organization_assignedUserId_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- 5. Drop indexes on Organization
DROP INDEX IF EXISTS "Organization_tenantId_name_idx";
DROP INDEX IF EXISTS "Organization_tenantId_isArchived_idx";

-- 6. Drop the Organization table
DROP TABLE IF EXISTS "Organization";

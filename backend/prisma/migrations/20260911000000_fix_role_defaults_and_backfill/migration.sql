-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: fix_role_defaults_and_backfill
-- Date:      2026-09-11
--
-- Purpose:
--   1. Change User.role column default from 'Sales Rep' → 'Guest'
--      (new registrations that omit the role field get 'Guest', not 'Sales Rep')
--
--   2. Change TenantInvitation.defaultRole column default from 'Sales Rep' → 'User'
--      (new invitations that omit a role default to the standard 'User' role)
--
--   3. Backfill existing User rows:
--      - 'Restricted User'  → 'Guest'   (sandbox/pre-subscription users)
--      - 'Sales Rep'        → 'User'    (old legacy role string, maps to standard User)
--      - 'Admin'            → 'Client Admin' (old tenant admin role, now Client Admin)
--      - 'Super User'       → 'Client Admin' (old super role, now Client Admin)
--
--   4. Backfill TenantInvitation.defaultRole:
--      - 'Sales Rep' → 'User'
--
-- These changes align the database with the 4-role model:
--   User | Guest | Client Admin | System Admin
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Alter User.role column default ─────────────────────────────────────────
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'Guest';

-- ── 2. Alter TenantInvitation.defaultRole column default ──────────────────────
ALTER TABLE "TenantInvitation" ALTER COLUMN "defaultRole" SET DEFAULT 'User';

-- ── 3. Backfill User.role stale values ────────────────────────────────────────
-- 'Restricted User' → 'Guest'  (renamed sandbox role)
UPDATE "User" SET "role" = 'Guest' WHERE "role" = 'Restricted User';

-- 'Sales Rep' → 'User'  (old legacy role; maps to the standard User role)
UPDATE "User" SET "role" = 'User' WHERE "role" = 'Sales Rep';

-- 'Admin' → 'Client Admin'  (old tenant admin; now consolidated into Client Admin)
UPDATE "User" SET "role" = 'Client Admin' WHERE "role" = 'Admin';

-- 'Super User' → 'Client Admin'  (old super role; now consolidated into Client Admin)
UPDATE "User" SET "role" = 'Client Admin' WHERE "role" = 'Super User';

-- ── 4. Backfill TenantInvitation.defaultRole ──────────────────────────────────
UPDATE "TenantInvitation" SET "defaultRole" = 'User' WHERE "defaultRole" = 'Sales Rep';

-- ── 5. Backfill RoleDefinition stale names ────────────────────────────────────
-- Rename 'Restricted User' RoleDefinition rows to 'Guest'.
-- Guard: only rename if no 'Guest' RoleDefinition already exists for that tenant
-- (avoids unique constraint violation on tenantId + name).
UPDATE "RoleDefinition"
SET    "name" = 'Guest'
WHERE  "name" = 'Restricted User'
  AND  NOT EXISTS (
    SELECT 1 FROM "RoleDefinition" g
    WHERE g."tenantId" = "RoleDefinition"."tenantId"
      AND g."name"     = 'Guest'
  );

-- Delete orphaned 'Restricted User' rows where 'Guest' already existed
-- (re-pointing UserRole FKs is handled by the application-level migrate-roles.ts script)
DELETE FROM "RoleDefinition"
WHERE "name" = 'Restricted User';

-- Delete 'Admin' RoleDefinition rows (role no longer exists; users promoted to Client Admin)
DELETE FROM "RoleDefinition"
WHERE "name" = 'Admin';

-- Delete 'Super User' RoleDefinition rows (role no longer exists)
DELETE FROM "RoleDefinition"
WHERE "name" = 'Super User';

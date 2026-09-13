-- ──────────────────────────────────────────────────────────────────────────────
-- Migration: guest_free_plan_crud
-- Date:      2026-09-11
--
-- Purpose: Convert the Guest role from view-only sandbox into a Free plan with
--          full basic CRM CRUD, capped by record limits (100 contacts, 3 users).
--          Premium features (campaigns, workflows) stay view-only.
--
--   1. Grant CRUD on basic CRM modules for all existing 'Guest' RoleDefinition rows:
--        contacts, accounts, deals, tasks  → canCreate/canEdit/canDelete = true
--        settings                          → canCreate/canEdit = true, canDelete = false
--        users                             → canView/canCreate/canEdit = true (capped by recordLimitGate)
--        campaigns, workflows              → view only (premium — planGate blocks mutations)
--
--   2. Set Free-plan limits (maxContacts = 100, maxUsers = 3) on existing SANDBOX
--      tenants that have no subscription and no limits configured yet.
--
-- Idempotent — safe to re-run. Only touches Guest roles and unconfigured SANDBOX tenants.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1a. Basic CRM modules — full CRUD ─────────────────────────────────────────
UPDATE "RolePermission" rp
SET    "canView"   = true,
       "canCreate" = true,
       "canEdit"   = true,
       "canDelete" = true
FROM   "RoleDefinition" rd
WHERE  rp."roleId" = rd."id"
  AND  rd."name"   = 'Guest'
  AND  rp."module" IN ('contacts', 'accounts', 'deals', 'tasks', 'dashboard');

-- ── 1b. Settings — create/edit but not delete ─────────────────────────────────
UPDATE "RolePermission" rp
SET    "canView"   = true,
       "canCreate" = true,
       "canEdit"   = true,
       "canDelete" = false
FROM   "RoleDefinition" rd
WHERE  rp."roleId" = rd."id"
  AND  rd."name"   = 'Guest'
  AND  rp."module" = 'settings';

-- ── 1c. Users — view/create/edit (capped at 3 by recordLimitGate), no delete ──
UPDATE "RolePermission" rp
SET    "canView"   = true,
       "canCreate" = true,
       "canEdit"   = true,
       "canDelete" = false
FROM   "RoleDefinition" rd
WHERE  rp."roleId" = rd."id"
  AND  rd."name"   = 'Guest'
  AND  rp."module" = 'users';

-- ── 1d. Premium features — remain view-only (mutations blocked by planGate) ───
UPDATE "RolePermission" rp
SET    "canView"   = true,
       "canCreate" = false,
       "canEdit"   = false,
       "canDelete" = false
FROM   "RoleDefinition" rd
WHERE  rp."roleId" = rd."id"
  AND  rd."name"   = 'Guest'
  AND  rp."module" IN ('campaigns', 'workflows');

-- ── 2. Set Free-plan limits on existing SANDBOX tenants ───────────────────────
-- Only touch tenants still in the sandbox/pre-subscription state with no limits set.
UPDATE "Tenant"
SET    "maxContacts" = 100
WHERE  "status" = 'SANDBOX'
  AND  "subscriptionStatus" = 'NONE'
  AND  "maxContacts" IS NULL;

UPDATE "Tenant"
SET    "maxUsers" = 3
WHERE  "status" = 'SANDBOX'
  AND  "subscriptionStatus" = 'NONE'
  AND  "maxUsers" IS NULL;

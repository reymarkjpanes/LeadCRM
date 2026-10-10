BEGIN;

-- The inspected deployment has no standalone operator identities. Fail closed
-- on other installations until those identities have an explicit User mapping.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "SystemAdmin") THEN
    RAISE EXCEPTION 'Map standalone operator identities to tenant users before applying this migration';
  END IF;
END $$;

-- Preserve every User, tenant, CRM assignment and historical event. Only the
-- primary legacy operator identity becomes a tenant-local Client Admin.
CREATE TEMP TABLE retired_operator_users ON COMMIT DROP AS
SELECT id, "tenantId" FROM "User"
WHERE regexp_replace(lower(role), '[ _-]', '', 'g') = 'systemadmin';

-- Invalidate sessions carrying old platform authority, including secondary roles.
UPDATE "Session" SET "revokedAt" = NOW()
WHERE "revokedAt" IS NULL AND "userId" IN (
  SELECT id FROM retired_operator_users
  UNION
  SELECT ur."userId" FROM "UserRole" ur
  JOIN "RoleDefinition" r ON r.id = ur."roleId"
  WHERE regexp_replace(lower(r.name), '[ _-]', '', 'g') = 'systemadmin'
);

INSERT INTO "RoleDefinition" (id, "tenantId", name, description, "isSystemRole", "isArchived", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "tenantId", 'Client Admin', 'Workspace administrator', true, false, NOW(), NOW()
FROM retired_operator_users GROUP BY "tenantId"
ON CONFLICT ("tenantId", name) DO NOTHING;

UPDATE "User" SET role = 'Client Admin', "mustChangePassword" = true, "updatedAt" = NOW()
WHERE id IN (SELECT id FROM retired_operator_users);

INSERT INTO "UserRole" (id, "userId", "roleId", "tenantId")
SELECT gen_random_uuid()::text, u.id, r.id, u."tenantId"
FROM retired_operator_users u JOIN "RoleDefinition" r ON r."tenantId" = u."tenantId" AND r.name = 'Client Admin'
ON CONFLICT ("userId", "roleId", "tenantId") DO NOTHING;

-- Explicitly remove obsolete junctions before definitions; no users are deleted.
DELETE FROM "UserRole" WHERE "roleId" IN (
  SELECT id FROM "RoleDefinition" WHERE regexp_replace(lower(name), '[ _-]', '', 'g') = 'systemadmin'
);
DELETE FROM "RolePermission" WHERE "roleId" IN (
  SELECT id FROM "RoleDefinition" WHERE regexp_replace(lower(name), '[ _-]', '', 'g') = 'systemadmin'
);
DELETE FROM "RoleDefinition" WHERE regexp_replace(lower(name), '[ _-]', '', 'g') = 'systemadmin';
DELETE FROM "RolePermission" WHERE module = 'admin';

-- These tables have no inbound foreign keys. Dropping them also removes their
-- local indexes and the outbound TenantDocument -> Tenant / OAuthAccount -> User
-- constraints. RESTRICT (the default) protects unexpected external dependencies.
DROP TABLE "TenantDocument";
DROP TABLE "RegistrationOtpToken";
DROP TABLE "OAuthAccount";
DROP TABLE "VerificationToken";
DROP TABLE "SystemAdmin";

-- Ignored metadata belongs exclusively to retired operator/business verification.
ALTER TABLE "Tenant"
  DROP COLUMN "approvedById",
  DROP COLUMN "approvedAt",
  DROP COLUMN "verificationStatus",
  DROP COLUMN "businessType",
  DROP COLUMN "verificationRejectionReason";

-- Activity, AuditLog, EmailAccount, MailboxOAuthState, MailboxMessage, RecordFile,
-- PasswordResetToken and EmailVerificationToken remain unchanged.
COMMIT;

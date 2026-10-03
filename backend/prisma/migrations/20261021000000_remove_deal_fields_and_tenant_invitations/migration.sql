-- Forward-only cleanup. No CRM rows or Tenant/User/Role records are deleted.
BEGIN;

-- confidence is absent from the checked-in history; allow environments which
-- added it independently without requiring the column to exist everywhere.
ALTER TABLE "Deal" DROP COLUMN IF EXISTS "confidence";
ALTER TABLE "Deal" DROP COLUMN "description";

-- These are outbound foreign keys only. DROP TABLE removes the table's own
-- primary key and indexes. RESTRICT (the default) refuses unexpected dependents.
ALTER TABLE "TenantInvitation" DROP CONSTRAINT "TenantInvitation_tenantId_fkey";
ALTER TABLE "TenantInvitation" DROP CONSTRAINT "TenantInvitation_invitedById_fkey";
ALTER TABLE "TenantInvitation" DROP CONSTRAINT "TenantInvitation_roleId_fkey";
DROP TABLE "TenantInvitation";

COMMIT;

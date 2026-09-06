-- Migration: rename_plantype_free_to_starter
-- Renames PlanType enum value FREE -> STARTER.
-- FREE was the entry-level paid plan (₱1,350/mo Starter). The name was semantically wrong.
-- This is a raw SQL rename — safe, preserves all existing data, no DROP/CREATE.
-- All existing rows with planType = 'FREE' become planType = 'STARTER' automatically.

ALTER TYPE "PlanType" RENAME VALUE 'FREE' TO 'STARTER';

-- Update the Tenant.plan column to be nullable (for unsubscribed tenants, plan = null)
ALTER TABLE "Tenant" ALTER COLUMN "plan" DROP NOT NULL;

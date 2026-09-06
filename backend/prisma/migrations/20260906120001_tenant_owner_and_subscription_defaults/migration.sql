-- Migration: tenant_owner_and_subscription_defaults
-- Step 2: Add ownerUserId to Tenant and update column defaults
-- Runs after NONE enum value is committed (separate migration).

-- Add ownerUserId — write-once at registration, identifies the founding user
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

-- Update default for subscriptionStatus: new tenants start as NONE (no subscription)
ALTER TABLE "Tenant" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'NONE';

-- Remove default from plan column: null = unsubscribed, plan only set after payment
ALTER TABLE "Tenant" ALTER COLUMN "plan" DROP DEFAULT;

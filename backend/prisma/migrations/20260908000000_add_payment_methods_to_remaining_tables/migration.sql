-- ============================================================
-- Migration: add_payment_methods_to_remaining_tables
--
-- WHAT THIS DOES
-- ──────────────
-- Adds the `paymentMethods` JSONB column (default '[]') to the 5 models
-- that have it in schema.prisma but were never covered by a migration:
--   SystemAdmin, PaymentMethod, TargetAudience, EmailAccount, AutomationRule
--
-- PricingPlan already has the column from migration
-- 20260823100000_add_payment_methods_to_pricing_plan.
--
-- SAFETY
-- ──────
-- All statements use ADD COLUMN IF NOT EXISTS so this migration is
-- safe to re-run and will not fail on databases that already have
-- the column (e.g. Supabase where it was added manually).
-- ============================================================

ALTER TABLE "SystemAdmin"    ADD COLUMN IF NOT EXISTS "paymentMethods" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PaymentMethod"  ADD COLUMN IF NOT EXISTS "paymentMethods" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "TargetAudience" ADD COLUMN IF NOT EXISTS "paymentMethods" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "EmailAccount"   ADD COLUMN IF NOT EXISTS "paymentMethods" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AutomationRule" ADD COLUMN IF NOT EXISTS "paymentMethods" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
-- Add optional currency column to Tenant.
-- Defaults to 'PHP' to preserve existing behaviour for all current tenants.
-- Nullable so existing rows that haven't set a preference remain NULL and the
-- application falls back to the PHP default via getTenantCurrency().
ALTER TABLE "Tenant" ADD COLUMN "currency" TEXT DEFAULT 'PHP';

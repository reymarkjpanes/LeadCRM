-- Migration: add NONE to SubscriptionStatus enum
-- Uses disable-transaction pragma because PostgreSQL's ADD VALUE cannot be used
-- in the same transaction as other DDL that references the new value.
-- Prisma wraps migrations in transactions by default; this pragma bypasses that.

-- Prisma disable-transaction
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'NONE';

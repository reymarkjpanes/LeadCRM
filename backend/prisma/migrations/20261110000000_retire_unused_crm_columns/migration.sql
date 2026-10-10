-- Reviewed in docs/database/crm-workflow-audit/README.md.
-- Deploy with the matching application release: older Prisma clients select
-- these columns implicitly. This migration never discards populated history.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "Contact", "Deal", "Workflow" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  -- Include every tenant and archived record. Even empty strings are data.
  IF EXISTS (
    SELECT 1 FROM "Contact"
    WHERE "lastContactedAt" IS NOT NULL
       OR "qualifiedAt" IS NOT NULL
       OR "disqualifiedReason" IS NOT NULL
  ) OR EXISTS (SELECT 1 FROM "Deal" WHERE "billingFrequency" IS NOT NULL) THEN
    RAISE EXCEPTION 'CRM retirement blocked: retired columns contain data. Preserve and reconcile all values, including archived records, before retrying.';
  END IF;

  -- Either active marker blocks retirement, including inconsistent legacy state.
  -- Draft/paused JSON is retained unchanged so the builder can offer repair.
  -- jsonpath inspects field selectors at any depth, not customer message text.
  IF EXISTS (
    SELECT 1 FROM "Workflow"
    WHERE NOT "isArchived" AND ("isActive" OR "status" = 'ACTIVE')
      AND (
        jsonb_path_exists(COALESCE("conditions", '{}'::jsonb),
          '$.**.field ? (@ == "lastContactedAt" || @ == "qualifiedAt" || @ == "disqualifiedReason" || @ == "billingFrequency" || @ == "contact.lastContactedAt" || @ == "contact.qualifiedAt" || @ == "contact.disqualifiedReason" || @ == "deal.billingFrequency")')
        OR jsonb_path_exists("actions",
          '$.**.field ? (@ == "lastContactedAt" || @ == "qualifiedAt" || @ == "disqualifiedReason" || @ == "billingFrequency" || @ == "contact.lastContactedAt" || @ == "contact.qualifiedAt" || @ == "contact.disqualifiedReason" || @ == "deal.billingFrequency")')
      )
  ) THEN
    RAISE EXCEPTION 'CRM retirement blocked: an active Workflow references a retired column. Pause and repair that Workflow before retrying.';
  END IF;
END $$;

-- No CASCADE: an unexpected dependent view must stop the migration.
ALTER TABLE "Contact"
  DROP COLUMN "lastContactedAt",
  DROP COLUMN "qualifiedAt",
  DROP COLUMN "disqualifiedReason";
ALTER TABLE "Deal" DROP COLUMN "billingFrequency";
COMMIT;

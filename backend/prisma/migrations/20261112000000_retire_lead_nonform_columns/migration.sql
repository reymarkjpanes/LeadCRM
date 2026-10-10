BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "Lead", "CustomFieldValue" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User") AND obj_description('"Lead"'::regclass,'pg_class') IS DISTINCT FROM 'lead-form-contract-api-verified-v1' THEN
    RAISE EXCEPTION 'Retirement blocked: verify the serving Lead form contract release first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Lead" l CROSS JOIN LATERAL (VALUES ('description',l.description),('website',l.website),('productInterestOther',l."productInterestOther")) f(name,value)
    WHERE f.value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CustomFieldValue" v
      WHERE v."tenantId"=l."tenantId" AND v."leadId"=l.id AND v.module='leads'
        AND v."fieldId"='retired-lead-'||f.name AND v.value=to_jsonb(f.value))
  ) THEN RAISE EXCEPTION 'Retirement blocked: historical Lead field preservation differs'; END IF;
END $$;
DROP TRIGGER crm_preserve_retired_lead_fields ON "Lead";
DROP FUNCTION crm_preserve_retired_lead_fields();
ALTER TABLE "Lead" DROP COLUMN description, DROP COLUMN website, DROP COLUMN "productInterestOther";
COMMENT ON TABLE "Lead" IS NULL;
COMMIT;

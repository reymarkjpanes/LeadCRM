-- Phase 2: run only after shared-service rollout verification. Fresh databases
-- with no old history need no rollout gate. Existing history requires the verifier.
BEGIN;
LOCK TABLE "LeadImport", "ContactImport", "AccountImport", "DealImport", "LeadImportResult", "ContactImportResult", "AccountImportResult", "DealImportResult" IN ACCESS EXCLUSIVE MODE;
SELECT * FROM crm_verify_import_normalization();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _crm_legacy_import_jobs) AND
    obj_description('"CrmImportJob"'::regclass, 'pg_class') IS DISTINCT FROM 'crm-import-normalization-api-verified-v1' THEN
    RAISE EXCEPTION 'Verify normalized imports and History before retiring legacy tables; use scripts/deploy-crm-imports.cjs --expand then --retire';
  END IF;
END $$;
DROP FUNCTION crm_verify_import_normalization();
DROP VIEW _crm_legacy_import_results;
DROP VIEW _crm_legacy_import_jobs;
DROP TABLE "LeadImportResult", "ContactImportResult", "AccountImportResult", "DealImportResult";
DROP TABLE "LeadImport", "ContactImport", "AccountImport", "DealImport";
DROP FUNCTION crm_legacy_import_readonly();
COMMENT ON TABLE "CrmImportJob" IS NULL;
COMMIT;

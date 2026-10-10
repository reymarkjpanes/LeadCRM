-- Pending migration reworked after read-only production migration-state inspection.
-- Phase 1: copy/verify history and freeze legacy writes; do NOT retire tables yet.
-- Deploy with scripts/deploy-crm-imports.cjs --expand during an import maintenance window.
BEGIN;
CREATE TYPE "CrmImportModule" AS ENUM ('LEAD', 'CONTACT', 'ACCOUNT', 'DEAL');
CREATE TABLE "CrmImportUpload" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "module" "CrmImportModule" NOT NULL, "totalChunks" INTEGER NOT NULL, "sourceHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmImportUpload_totalChunks_check" CHECK ("totalChunks" BETWEEN 1 AND 160),
  CONSTRAINT "CrmImportUpload_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmImportUpload_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CrmImportUpload_expiresAt_idx" ON "CrmImportUpload" ("expiresAt");
CREATE TABLE "CrmImportJob" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "module" "CrmImportModule" NOT NULL,
  "fileName" TEXT NOT NULL, "totalRecords" INTEGER NOT NULL DEFAULT 0,
  "successfulRecords" INTEGER NOT NULL DEFAULT 0, "failedRecords" INTEGER NOT NULL DEFAULT 0,
  "duplicateRecords" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'pending',
  "createdById" TEXT NOT NULL, "idempotencyKey" TEXT, "requestHash" TEXT, "uploadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "CrmImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrmImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrmImportJob_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "CrmImportUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmImportJob_uploadId_key" ON "CrmImportJob" ("uploadId");
CREATE UNIQUE INDEX "CrmImportJob_tenantId_module_idempotencyKey_key" ON "CrmImportJob" ("tenantId", "module", "idempotencyKey");
CREATE INDEX "CrmImportJob_tenantId_module_createdAt_id_idx" ON "CrmImportJob" ("tenantId", "module", "createdAt", "id");
CREATE INDEX "CrmImportJob_tenantId_module_status_createdAt_id_idx" ON "CrmImportJob" ("tenantId", "module", "status", "createdAt", "id");
CREATE TABLE "CrmImportRowResult" (
  "id" TEXT PRIMARY KEY, "importJobId" TEXT NOT NULL, "rowNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL, "recordId" TEXT, "remarks" TEXT, "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmImportRowResult_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "CrmImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmImportRowResult_importJobId_rowNumber_key" ON "CrmImportRowResult" ("importJobId", "rowNumber");
CREATE INDEX "CrmImportRowResult_importJobId_status_rowNumber_idx" ON "CrmImportRowResult" ("importJobId", "status", "rowNumber");
CREATE TABLE "CrmImportChunk" (
  "id" TEXT PRIMARY KEY, "uploadId" TEXT NOT NULL, "chunkIndex" INTEGER NOT NULL, "content" TEXT NOT NULL,
  CONSTRAINT "CrmImportChunk_chunkIndex_check" CHECK ("chunkIndex" BETWEEN 0 AND 159),
  CONSTRAINT "CrmImportChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "CrmImportUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmImportChunk_uploadId_chunkIndex_key" ON "CrmImportChunk" ("uploadId", "chunkIndex");

LOCK TABLE "LeadImport", "ContactImport", "AccountImport", "DealImport", "LeadImportResult", "ContactImportResult", "AccountImportResult", "DealImportResult" IN ACCESS EXCLUSIVE MODE;
-- Stop rather than silently remap IDs, renumber duplicate rows or discard data.
-- Primary/row uniqueness constraints enforce this on the copies below.
CREATE VIEW _crm_legacy_import_jobs AS
SELECT 'LEAD'::"CrmImportModule" AS module, jsonb_build_object(
  'id', j.id, 'tenantId', j."tenantId", 'module', 'LEAD', 'fileName', j."fileName",
  'totalRecords', j."totalRecords", 'successfulRecords', j."successfulRecords", 'failedRecords', j."failedRecords",
  'duplicateRecords', 0, 'status', j.status, 'createdById', j."createdById",
  'idempotencyKey', NULL, 'requestHash', NULL, 'uploadId', NULL, 'createdAt', j."createdAt", 'completedAt', j."completedAt"
) AS payload FROM "LeadImport" j
UNION ALL
SELECT 'CONTACT'::"CrmImportModule" AS module, jsonb_build_object(
  'id', j.id, 'tenantId', j."tenantId", 'module', 'CONTACT', 'fileName', j."fileName",
  'totalRecords', j."totalRecords", 'successfulRecords', j."successfulRecords", 'failedRecords', j."failedRecords",
  'duplicateRecords', 0, 'status', j.status, 'createdById', j."createdById",
  'idempotencyKey', NULL, 'requestHash', NULL, 'uploadId', NULL, 'createdAt', j."createdAt", 'completedAt', j."completedAt"
) AS payload FROM "ContactImport" j
UNION ALL
SELECT 'ACCOUNT'::"CrmImportModule" AS module, jsonb_build_object(
  'id', j.id, 'tenantId', j."tenantId", 'module', 'ACCOUNT', 'fileName', j."fileName",
  'totalRecords', j."totalRecords", 'successfulRecords', j."successfulRecords", 'failedRecords', j."failedRecords",
  'duplicateRecords', 0, 'status', j.status, 'createdById', j."createdById",
  'idempotencyKey', NULL, 'requestHash', NULL, 'uploadId', NULL, 'createdAt', j."createdAt", 'completedAt', j."completedAt"
) AS payload FROM "AccountImport" j
UNION ALL
SELECT 'DEAL'::"CrmImportModule" AS module, jsonb_build_object(
  'id', j.id, 'tenantId', j."tenantId", 'module', 'DEAL', 'fileName', j."fileName",
  'totalRecords', j."totalRecords", 'successfulRecords', j."successfulRecords", 'failedRecords', j."failedRecords",
  'duplicateRecords', 0, 'status', j.status, 'createdById', j."createdById",
  'idempotencyKey', NULL, 'requestHash', NULL, 'uploadId', NULL, 'createdAt', j."createdAt", 'completedAt', j."completedAt"
) AS payload FROM "DealImport" j;
CREATE VIEW _crm_legacy_import_results AS
SELECT 'LEAD'::"CrmImportModule" AS module, jsonb_build_object(
  'id', r.id, 'importJobId', r."importId", 'rowNumber', r."rowNumber", 'status', r.status,
  'recordId', r."leadId", 'remarks', r.remarks, 'data', to_jsonb(r) - ARRAY['id','importId','rowNumber','status','leadId','remarks','createdAt']::text[], 'createdAt', r."createdAt"
) AS payload FROM "LeadImportResult" r
UNION ALL
SELECT 'CONTACT'::"CrmImportModule" AS module, jsonb_build_object(
  'id', r.id, 'importJobId', r."importId", 'rowNumber', r."rowNumber", 'status', r.status,
  'recordId', r."contactId", 'remarks', r.remarks, 'data', to_jsonb(r) - ARRAY['id','importId','rowNumber','status','contactId','remarks','createdAt']::text[], 'createdAt', r."createdAt"
) AS payload FROM "ContactImportResult" r
UNION ALL
SELECT 'ACCOUNT'::"CrmImportModule" AS module, jsonb_build_object(
  'id', r.id, 'importJobId', r."importId", 'rowNumber', r."rowNumber", 'status', r.status,
  'recordId', r."accountId", 'remarks', r.remarks, 'data', to_jsonb(r) - ARRAY['id','importId','rowNumber','status','accountId','remarks','createdAt']::text[], 'createdAt', r."createdAt"
) AS payload FROM "AccountImportResult" r
UNION ALL
SELECT 'DEAL'::"CrmImportModule" AS module, jsonb_build_object(
  'id', r.id, 'importJobId', r."importId", 'rowNumber', r."rowNumber", 'status', r.status,
  'recordId', r."dealId", 'remarks', r.remarks, 'data', r.data, 'createdAt', r."createdAt"
) AS payload FROM "DealImportResult" r;
INSERT INTO "CrmImportJob" SELECT (jsonb_populate_record(NULL::"CrmImportJob", payload)).* FROM _crm_legacy_import_jobs;
INSERT INTO "CrmImportRowResult" SELECT (jsonb_populate_record(NULL::"CrmImportRowResult", payload)).* FROM _crm_legacy_import_results;

-- Reused by the rollout verifier and the retirement migration. Compare complete
-- payloads as well as per-module counts, not just aggregate totals.
CREATE FUNCTION crm_verify_import_normalization() RETURNS TABLE(module "CrmImportModule", jobs bigint, results bigint) LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM _crm_legacy_import_jobs old LEFT JOIN "CrmImportJob" n ON n.id = old.payload->>'id'
    WHERE n.id IS NULL OR to_jsonb(n) IS DISTINCT FROM old.payload) THEN
    RAISE EXCEPTION 'Import job migration mismatch; legacy tables retained';
  END IF;
  IF EXISTS (SELECT 1 FROM _crm_legacy_import_results old LEFT JOIN "CrmImportRowResult" n ON n.id = old.payload->>'id'
    WHERE n.id IS NULL OR to_jsonb(n) IS DISTINCT FROM old.payload) THEN
    RAISE EXCEPTION 'Import result migration mismatch; legacy tables retained';
  END IF;
  IF (SELECT count(*) FROM "CrmImportRowResult" r JOIN _crm_legacy_import_jobs j ON r."importJobId"=j.payload->>'id')
    <> (SELECT count(*) FROM _crm_legacy_import_results) THEN
    RAISE EXCEPTION 'Import result count mismatch; legacy tables retained';
  END IF;
  RETURN QUERY SELECT m, (SELECT count(*) FROM _crm_legacy_import_jobs j WHERE j.module=m),
    (SELECT count(*) FROM _crm_legacy_import_results r WHERE r.module=m)
    FROM unnest(enum_range(NULL::"CrmImportModule")) m;
END $$;
SELECT * FROM crm_verify_import_normalization();

-- Freeze the source snapshot so an old server cannot keep writing divergent history.
-- Reads remain available until the shared service is deployed and verified.
CREATE FUNCTION crm_legacy_import_readonly() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Import infrastructure upgraded; deploy the normalized import service' USING ERRCODE='55000';
END $$;
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "LeadImport" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "LeadImportResult" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "ContactImport" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "ContactImportResult" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "AccountImport" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "AccountImportResult" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "DealImport" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();
CREATE TRIGGER crm_legacy_import_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON "DealImportResult" FOR EACH STATEMENT EXECUTE FUNCTION crm_legacy_import_readonly();

CREATE TRIGGER crm_scope_immutable BEFORE UPDATE ON "CrmImportJob" FOR EACH ROW EXECUTE FUNCTION crm_scope_immutable();
CREATE TRIGGER crm_scope_immutable BEFORE UPDATE ON "CrmImportUpload" FOR EACH ROW EXECUTE FUNCTION crm_scope_immutable();
CREATE TRIGGER crm_child_parent_immutable BEFORE UPDATE ON "CrmImportRowResult" FOR EACH ROW EXECUTE FUNCTION crm_child_parent_immutable('importJobId');
CREATE TRIGGER crm_child_parent_immutable BEFORE UPDATE ON "CrmImportChunk" FOR EACH ROW EXECUTE FUNCTION crm_child_parent_immutable('uploadId');
CREATE TRIGGER scope_createdById BEFORE INSERT OR UPDATE ON "CrmImportJob" FOR EACH ROW EXECUTE FUNCTION crm_check_relation_scope('createdById','User');
CREATE TRIGGER scope_actorId BEFORE INSERT OR UPDATE ON "CrmImportUpload" FOR EACH ROW EXECUTE FUNCTION crm_check_relation_scope('actorId','User');
CREATE FUNCTION crm_import_source_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "CrmImportUpload";
BEGIN
  IF TG_OP='UPDATE' AND (NEW.module IS DISTINCT FROM OLD.module OR NEW."createdById" IS DISTINCT FROM OLD."createdById") THEN
    RAISE EXCEPTION 'Import identity cannot change' USING ERRCODE='23514';
  END IF;
  IF NEW."uploadId" IS NOT NULL THEN
    SELECT * INTO source FROM "CrmImportUpload" WHERE id=NEW."uploadId";
    IF source.id IS NULL OR (source."tenantId",source."actorId",source.module) IS DISTINCT FROM (NEW."tenantId",NEW."createdById",NEW.module) THEN
      RAISE EXCEPTION 'Import upload crosses scope' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_import_source_scope BEFORE INSERT OR UPDATE ON "CrmImportJob" FOR EACH ROW EXECUTE FUNCTION crm_import_source_scope();
CREATE FUNCTION crm_import_upload_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (NEW."actorId",NEW.module,NEW."totalChunks",NEW."expiresAt") IS DISTINCT FROM (OLD."actorId",OLD.module,OLD."totalChunks",OLD."expiresAt") THEN
    RAISE EXCEPTION 'Import upload identity cannot change' USING ERRCODE='23514';
  END IF;
  IF OLD."sourceHash" IS NOT NULL AND NEW."sourceHash" IS DISTINCT FROM OLD."sourceHash" THEN
    RAISE EXCEPTION 'Import upload digest cannot change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_import_upload_immutable BEFORE UPDATE ON "CrmImportUpload" FOR EACH ROW EXECUTE FUNCTION crm_import_upload_immutable();
-- recordId is a historical reference, not a cascading polymorphic FK. New links
-- must still satisfy the same tenant checks as the former per-module results.
CREATE FUNCTION crm_import_record_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "CrmImportJob"; record_tenant text; record_table text;
BEGIN
  IF NEW."recordId" IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW."recordId" IS NOT DISTINCT FROM OLD."recordId" THEN RETURN NEW; END IF;
  SELECT * INTO parent FROM "CrmImportJob" WHERE id=NEW."importJobId";
  record_table := CASE parent.module WHEN 'LEAD' THEN 'Lead' WHEN 'CONTACT' THEN 'Contact' WHEN 'ACCOUNT' THEN 'Account' WHEN 'DEAL' THEN 'Deal' END;
  IF record_table IS NULL THEN RAISE EXCEPTION 'Import job is unavailable' USING ERRCODE='23503'; END IF;
  EXECUTE format('SELECT "tenantId" FROM %I WHERE id=$1', record_table) INTO record_tenant USING NEW."recordId";
  IF record_tenant IS DISTINCT FROM parent."tenantId" THEN
    RAISE EXCEPTION 'Import result record crosses tenant or is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_import_record_scope BEFORE INSERT OR UPDATE ON "CrmImportRowResult" FOR EACH ROW EXECUTE FUNCTION crm_import_record_scope();
COMMIT;

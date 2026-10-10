-- EXPAND: keep the existing definition IDs, JSON configuration and Deal evidence.
BEGIN;
CREATE TABLE "CustomFieldValue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "leadId" TEXT,
  "contactId" TEXT,
  "accountId" TEXT,
  "dealId" TEXT,
  "value" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomFieldValue_field_fkey" FOREIGN KEY ("tenantId", "fieldId") REFERENCES "ClosingFieldDefinition"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomFieldValue_lead_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomFieldValue_contact_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomFieldValue_account_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomFieldValue_deal_fkey" FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomFieldValue_one_record" CHECK (
    num_nonnulls("leadId", "contactId", "accountId", "dealId") = 1 AND
    (("module" = 'leads' AND "leadId" IS NOT NULL) OR ("module" = 'contacts' AND "contactId" IS NOT NULL) OR
     ("module" = 'accounts' AND "accountId" IS NOT NULL) OR ("module" = 'deals' AND "dealId" IS NOT NULL))),
  CONSTRAINT "CustomFieldValue_scalar" CHECK (jsonb_typeof("value") IN ('string', 'number', 'null'))
);
CREATE UNIQUE INDEX "CustomFieldValue_tenantId_fieldId_leadId_key" ON "CustomFieldValue"("tenantId", "fieldId", "leadId");
CREATE UNIQUE INDEX "CustomFieldValue_tenantId_fieldId_contactId_key" ON "CustomFieldValue"("tenantId", "fieldId", "contactId");
CREATE UNIQUE INDEX "CustomFieldValue_tenantId_fieldId_accountId_key" ON "CustomFieldValue"("tenantId", "fieldId", "accountId");
CREATE UNIQUE INDEX "CustomFieldValue_tenantId_fieldId_dealId_key" ON "CustomFieldValue"("tenantId", "fieldId", "dealId");
CREATE INDEX "CustomFieldValue_tenantId_module_leadId_contactId_accountId_de_idx" ON "CustomFieldValue"("tenantId", "module", "leadId", "contactId", "accountId", "dealId");

-- BACKFILL: metadata is added to the current definition, without replacing its ID,
-- version, type, options or required setting. Snapshot definitions remain frozen.
WITH positions AS (
  SELECT "tenantId", "id", row_number() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") - 1 AS position
  FROM "ClosingFieldDefinition"
)
UPDATE "ClosingFieldDefinition" f SET "definition" =
  jsonb_build_object('module', 'deals', 'group', 'Closed Won Requirements', 'visibleInForm', true, 'order', p.position) || f."definition"
FROM positions p WHERE f."tenantId" = p."tenantId" AND f."id" = p."id";

INSERT INTO "CustomFieldValue" ("id", "tenantId", "fieldId", "module", "dealId", "value")
SELECT gen_random_uuid()::text, d."tenantId", v.key, 'deals', d."id", v.value
FROM "Deal" d CROSS JOIN LATERAL jsonb_each(d."closingValues") v
JOIN "ClosingFieldDefinition" f ON f."tenantId" = d."tenantId" AND f."id" = v.key;

-- VERIFY every value with a retained definition. Unknown legacy keys are deliberately
-- retained in closingValues/snapshots; nothing is deleted or silently coerced.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "Deal" d CROSS JOIN LATERAL jsonb_each(d."closingValues") v
    JOIN "ClosingFieldDefinition" f ON f."tenantId" = d."tenantId" AND f."id" = v.key
    LEFT JOIN "CustomFieldValue" c ON c."tenantId" = d."tenantId" AND c."dealId" = d."id" AND c."fieldId" = v.key
    WHERE c."id" IS NULL OR c."value" IS DISTINCT FROM v.value
  ) THEN RAISE EXCEPTION 'Custom-field value backfill verification failed'; END IF;
END $$;

-- Reuse secure record-file storage for uploads before the new record exists.
-- Pending files are owned by their uploader, module and tenant, expire after 24h,
-- and are claimed inside the record transaction. Batch Deals share uploaded bytes
-- through separate record-owned metadata/IDs; downloads still check each record.
ALTER TABLE "RecordFile" ADD COLUMN "pendingModule" TEXT;
ALTER TABLE "RecordFile" DROP CONSTRAINT "RecordFile_one_record";
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_one_record" CHECK (
  (num_nonnulls("leadId", "contactId", "accountId", "dealId") = 1 AND "pendingModule" IS NULL) OR
  (num_nonnulls("leadId", "contactId", "accountId", "dealId") = 0 AND "pendingModule" IS NOT NULL AND "pendingModule" IN ('leads', 'contacts', 'accounts', 'deals'))
);
DROP INDEX "RecordFile_objectKey_key";
CREATE INDEX "RecordFile_objectKey_idx" ON "RecordFile"("objectKey");
CREATE INDEX "RecordFile_tenantId_pendingModule_uploadedAt_idx" ON "RecordFile"("tenantId", "pendingModule", "uploadedAt");
-- SWITCH happens in application code. RETIRE is intentionally deferred: legacy
-- Deal closingValues are dual-written and closingSnapshot is never rewritten.
COMMIT;

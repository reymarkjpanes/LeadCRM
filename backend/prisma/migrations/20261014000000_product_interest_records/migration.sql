CREATE TABLE "ProductInterest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" VARCHAR(200) NOT NULL,
  "dealValue" DECIMAL(14,2) NOT NULL CHECK ("dealValue" >= 0),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ProductInterest_tenantId_active_idx" ON "ProductInterest"("tenantId", "active");
CREATE UNIQUE INDEX "ProductInterest_active_name_key" ON "ProductInterest"("tenantId", lower("name")) WHERE "active";
ALTER TABLE "Lead" ADD COLUMN "productInterestIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Deal" ADD COLUMN "productInterestId" TEXT REFERENCES "ProductInterest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Import existing configured values; defaults are seeded only during this migration.
INSERT INTO "ProductInterest" ("id", "tenantId", "name", "dealValue", "createdAt", "updatedAt")
SELECT md5(t."id" || ':product:' || (p->>'name'))::uuid::text, t."id", p->>'name',
       (p->>'value')::numeric, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
LEFT JOIN "TenantPreference" pref ON pref."tenantId" = t."id" AND pref."module" = 'product-interests' AND pref."key" = 'values'
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pref."value",
  '[{"name":"CCTV Surveillance System","value":0},{"name":"Biometrics","value":0},{"name":"Door Access Control","value":0},{"name":"Smart Lock","value":0},{"name":"Network Infrastructure","value":0},{"name":"Structured Cabling","value":0},{"name":"Internet and Voice Postpaid plans","value":0},{"name":"IPBX/IP PHONES/PABGM","value":0},{"name":"Electric Fence","value":0},{"name":"Fire Detection and Alarm System","value":0},{"name":"Laptop/Server/Data Cabinets","value":0},{"name":"Others","value":0}]'::jsonb)) p;

UPDATE "Lead" l SET "productInterestIds" = ARRAY(
  SELECT p."id" FROM "ProductInterest" p WHERE p."tenantId" = l."tenantId" AND p."name" = ANY(l."productInterest")
);
UPDATE "Deal" d SET "productInterestId" = p."id"
FROM "ProductInterest" p WHERE d."tenantId" = p."tenantId"
  AND d."automationKey" IS NOT NULL AND d."productInterests" = ARRAY[p."name"::text];
DELETE FROM "TenantPreference" WHERE "module" = 'product-interests' AND "key" = 'values';

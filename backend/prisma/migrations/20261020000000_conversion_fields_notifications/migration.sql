ALTER TABLE "Notification" ADD COLUMN "eventKey" TEXT;
CREATE UNIQUE INDEX "Notification_tenantId_userId_eventKey_key" ON "Notification"("tenantId", "userId", "eventKey");

CREATE TABLE "ClosingFieldDefinition" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "id" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "id")
);
INSERT INTO "ClosingFieldDefinition" ("tenantId", "id", "definition", "createdAt")
SELECT p."tenantId", field->>'id', field, CURRENT_TIMESTAMP - ((100 - position) * interval '1 millisecond')
FROM "TenantPreference" p, jsonb_array_elements(CASE WHEN jsonb_typeof(p."value") = 'array' THEN p."value" ELSE '[]'::jsonb END) WITH ORDINALITY AS fields(field, position)
WHERE p."module" = 'closing-requirements' AND p."key" = 'fields'
ON CONFLICT DO NOTHING;

-- Existing workspaces already automate stages. Preserve their effective behavior.
-- Missing configuration in newly created workspaces is interpreted as disabled.
INSERT INTO "TenantPreference" ("id", "tenantId", "module", "key", "value", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'deal-stage-automation', 'default', '{"enabled":true}'::jsonb, CURRENT_TIMESTAMP FROM "Tenant"
ON CONFLICT ("tenantId", "module", "key") DO NOTHING;

-- Start existing tenants at deployment time instead of flooding users with old events.
INSERT INTO "TenantPreference" ("id", "tenantId", "module", "key", "value", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'notifications', 'delivery-cursor', to_jsonb(CURRENT_TIMESTAMP::text), CURRENT_TIMESTAMP FROM "Tenant"
ON CONFLICT ("tenantId", "module", "key") DO NOTHING;

CREATE INDEX "Lead_tenantId_convertedAt_isArchived_idx" ON "Lead"("tenantId", "convertedAt", "isArchived");

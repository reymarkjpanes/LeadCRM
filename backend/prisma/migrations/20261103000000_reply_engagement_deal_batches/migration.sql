-- Keep the existing reply timestamp columns: Prisma maps their clarified name.
-- Retire only the old engagement-to-Deal preference, preserving other settings.
DELETE FROM "TenantPreference" WHERE "module" = 'deal-stage-automation' AND "key" = 'default';
CREATE TABLE "DealCreationReceipt" (
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "dealIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealCreationReceipt_pkey" PRIMARY KEY ("tenantId", "idempotencyKey"),
  CONSTRAINT "DealCreationReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

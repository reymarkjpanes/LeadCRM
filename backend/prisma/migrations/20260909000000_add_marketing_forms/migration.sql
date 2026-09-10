-- CreateTable
CREATE TABLE "MarketingForm" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'draft',
    "fields"      JSONB NOT NULL DEFAULT '[]',
    "design"      JSONB NOT NULL DEFAULT '{}',
    "settings"    JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMP(3),
    "isArchived"  BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingForm_tenantId_isArchived_createdAt_idx" ON "MarketingForm"("tenantId", "isArchived", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingForm_tenantId_status_idx" ON "MarketingForm"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "MarketingForm" ADD CONSTRAINT "MarketingForm_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingForm" ADD CONSTRAINT "MarketingForm_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

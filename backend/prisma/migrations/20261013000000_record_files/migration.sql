-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'Warm';

-- CreateTable
CREATE TABLE "RecordFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "CrmEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "leadId" TEXT,
    "contactId" TEXT,
    "accountId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecordFile_objectKey_key" ON "RecordFile"("objectKey");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_environment_leadId_idx" ON "RecordFile"("tenantId", "environment", "leadId");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_environment_contactId_idx" ON "RecordFile"("tenantId", "environment", "contactId");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_environment_accountId_idx" ON "RecordFile"("tenantId", "environment", "accountId");

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_leadId_tenantId_environment_fkey" FOREIGN KEY ("leadId", "tenantId", "environment") REFERENCES "Lead"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_contactId_tenantId_environment_fkey" FOREIGN KEY ("contactId", "tenantId", "environment") REFERENCES "Contact"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_accountId_tenantId_environment_fkey" FOREIGN KEY ("accountId", "tenantId", "environment") REFERENCES "Account"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_one_record" CHECK (num_nonnulls("leadId", "contactId", "accountId") = 1);
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_size" CHECK ("size" > 0 AND "size" <= 10485760);

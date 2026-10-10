ALTER TABLE "Deal" ADD COLUMN "productInterestIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Deal" SET "productInterestIds" = ARRAY["productInterestId"] WHERE "productInterestId" IS NOT NULL;
ALTER TABLE "RecordFile" ADD COLUMN "dealId" TEXT;
CREATE INDEX "RecordFile_tenantId_environment_dealId_idx" ON "RecordFile"("tenantId", "environment", "dealId");
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_dealId_tenantId_environment_fkey" FOREIGN KEY ("dealId", "tenantId", "environment") REFERENCES "Deal"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecordFile" DROP CONSTRAINT "RecordFile_one_record";
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_one_record" CHECK (num_nonnulls("leadId", "contactId", "accountId", "dealId") = 1);

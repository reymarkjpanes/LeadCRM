ALTER TABLE "Lead" ADD COLUMN "creationKey" TEXT;
CREATE UNIQUE INDEX "Lead_tenantId_environment_creationKey_key" ON "Lead"("tenantId", "environment", "creationKey");
ALTER TABLE "Deal" ADD COLUMN "automationKey" TEXT;
CREATE UNIQUE INDEX "Deal_tenantId_environment_automationKey_key" ON "Deal"("tenantId", "environment", "automationKey");
ALTER TABLE "FormSubmission" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "FormSubmission_formId_requestKey_key" ON "FormSubmission"("formId", "requestKey");

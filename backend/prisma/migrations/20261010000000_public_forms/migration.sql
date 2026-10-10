-- AlterTable
ALTER TABLE "MarketingForm" ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "publishedConfig" JSONB,
ADD COLUMN     "publishedRevision" INTEGER,
ADD COLUMN     "publishedVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- Each existing draft gets a new anonymous identifier. Existing data is retained;
-- admins explicitly publish a validated snapshot before it becomes public.
UPDATE "MarketingForm" SET "publicId" = gen_random_uuid()::text;
ALTER TABLE "MarketingForm" ALTER COLUMN "publicId" SET NOT NULL;

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "CrmEnvironment" NOT NULL,
    "formId" TEXT NOT NULL,
    "publishedVersion" INTEGER NOT NULL,
    "publishedConfig" JSONB NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "phone" TEXT,
    "values" JSONB NOT NULL,
    "tracking" JSONB NOT NULL DEFAULT '{}',
    "notificationStatus" TEXT NOT NULL DEFAULT 'not_requested',

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_one_person_check"
CHECK (("leadId" IS NOT NULL)::integer + ("contactId" IS NOT NULL)::integer = 1);

-- CreateIndex
CREATE INDEX "FormSubmission_tenantId_environment_formId_submittedAt_idx" ON "FormSubmission"("tenantId", "environment", "formId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormSubmission_leadId_idx" ON "FormSubmission"("leadId");

-- CreateIndex
CREATE INDEX "FormSubmission_contactId_idx" ON "FormSubmission"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingForm_publicId_key" ON "MarketingForm"("publicId");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MarketingForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

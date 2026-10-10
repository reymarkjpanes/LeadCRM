-- Preserve rows and API fields while enforcing existing tenant ownership.
-- Any inconsistent row aborts the entire migration.
BEGIN;
SET LOCAL lock_timeout = 10000;
-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- DropForeignKey
ALTER TABLE "UserRole" DROP CONSTRAINT "UserRole_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserRole" DROP CONSTRAINT "UserRole_roleId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropForeignKey
ALTER TABLE "TenantGroupMember" DROP CONSTRAINT "TenantGroupMember_groupId_fkey";

-- DropForeignKey
ALTER TABLE "TenantGroupMember" DROP CONSTRAINT "TenantGroupMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "Stage" DROP CONSTRAINT "Stage_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_stageId_fkey";

-- DropForeignKey
ALTER TABLE "LeadDeal" DROP CONSTRAINT "LeadDeal_leadId_fkey";

-- DropForeignKey
ALTER TABLE "LeadDeal" DROP CONSTRAINT "LeadDeal_dealId_fkey";

-- DropForeignKey
ALTER TABLE "ContactDeal" DROP CONSTRAINT "ContactDeal_contactId_fkey";

-- DropForeignKey
ALTER TABLE "ContactDeal" DROP CONSTRAINT "ContactDeal_dealId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "FormSubmission" DROP CONSTRAINT "FormSubmission_formId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowTriggerRecord" DROP CONSTRAINT "WorkflowTriggerRecord_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowExecutionRun" DROP CONSTRAINT "WorkflowExecutionRun_triggerId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowExecutionStep" DROP CONSTRAINT "WorkflowExecutionStep_executionId_fkey";

-- DropForeignKey
ALTER TABLE "MailboxMessage" DROP CONSTRAINT "MailboxMessage_accountId_fkey";

-- DropIndex
DROP INDEX "Session_tokenHash_idx";

-- DropIndex
DROP INDEX "EmailDeliveryLog_gmailMessageId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_id_tenantId_key" ON "RoleDefinition"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantGroup_id_tenantId_key" ON "TenantGroup"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_id_tenantId_key" ON "Pipeline"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_id_pipelineId_tenantId_key" ON "Stage"("id", "pipelineId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingForm_id_tenantId_key" ON "MarketingForm"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_id_tenantId_key" ON "Workflow"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTriggerRecord_id_workflowId_tenantId_key" ON "WorkflowTriggerRecord"("id", "workflowId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowExecutionRun_id_tenantId_key" ON "WorkflowExecutionRun"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_id_tenantId_key" ON "EmailAccount"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_tenantId_fkey" FOREIGN KEY ("roleId", "tenantId") REFERENCES "RoleDefinition"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_tenantId_fkey" FOREIGN KEY ("roleId", "tenantId") REFERENCES "RoleDefinition"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantGroupMember" ADD CONSTRAINT "TenantGroupMember_groupId_tenantId_fkey" FOREIGN KEY ("groupId", "tenantId") REFERENCES "TenantGroup"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantGroupMember" ADD CONSTRAINT "TenantGroupMember_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_pipelineId_tenantId_fkey" FOREIGN KEY ("pipelineId", "tenantId") REFERENCES "Pipeline"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_tenantId_fkey" FOREIGN KEY ("pipelineId", "tenantId") REFERENCES "Pipeline"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_pipelineId_tenantId_fkey" FOREIGN KEY ("stageId", "pipelineId", "tenantId") REFERENCES "Stage"("id", "pipelineId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDeal" ADD CONSTRAINT "LeadDeal_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDeal" ADD CONSTRAINT "LeadDeal_dealId_tenantId_fkey" FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactDeal" ADD CONSTRAINT "ContactDeal_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactDeal" ADD CONSTRAINT "ContactDeal_dealId_tenantId_fkey" FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_tenantId_fkey" FOREIGN KEY ("formId", "tenantId") REFERENCES "MarketingForm"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTriggerRecord" ADD CONSTRAINT "WorkflowTriggerRecord_workflowId_tenantId_fkey" FOREIGN KEY ("workflowId", "tenantId") REFERENCES "Workflow"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecutionRun" ADD CONSTRAINT "WorkflowExecutionRun_triggerId_workflowId_tenantId_fkey" FOREIGN KEY ("triggerId", "workflowId", "tenantId") REFERENCES "WorkflowTriggerRecord"("id", "workflowId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecutionStep" ADD CONSTRAINT "WorkflowExecutionStep_executionId_tenantId_fkey" FOREIGN KEY ("executionId", "tenantId") REFERENCES "WorkflowExecutionRun"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxMessage" ADD CONSTRAINT "MailboxMessage_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reconcile drift observed in the configured live database. Fresh replay already
-- has the first three indexes and SMS FK; never modify their historical files.
CREATE INDEX IF NOT EXISTS "Activity_tenantId_leadId_createdAt_idx" ON "Activity"("tenantId", "leadId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignContact_campaignId_leadId_key" ON "CampaignContact"("campaignId", "leadId");
CREATE INDEX IF NOT EXISTS "EmailDeliveryLog_tenantId_leadId_idx" ON "EmailDeliveryLog"("tenantId", "leadId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"SMSQueue"'::regclass AND conname='SMSQueue_leadId_fkey') THEN
    ALTER TABLE "SMSQueue" ADD CONSTRAINT "SMSQueue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Preserve existing live defaults and useful archive/lifecycle query indexes;
-- express them in Prisma and make fresh installations behave the same way.
CREATE INDEX IF NOT EXISTS "Contact_tenantId_isArchived_idx" ON "Contact"("tenantId", "isArchived");
CREATE INDEX IF NOT EXISTS "Contact_tenantId_lifecycleStage_idx" ON "Contact"("tenantId", "lifecycleStage");
ALTER TABLE "Account" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "productInterests" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "activeProducts" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Lead" ALTER COLUMN "productInterest" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TenantGroup" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;

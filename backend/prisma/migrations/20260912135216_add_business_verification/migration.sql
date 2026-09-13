/*
  Warnings:

  - You are about to drop the column `contactId` on the `CampaignContact` table. All the data in the column will be lost.
  - You are about to drop the column `contactId` on the `Deal` table. All the data in the column will be lost.
  - You are about to drop the column `contactId` on the `EmailDeliveryLog` table. All the data in the column will be lost.
  - You are about to drop the column `contactId` on the `SMSQueue` table. All the data in the column will be lost.
  - You are about to drop the column `organizationId` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CustomerDeal` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[campaignId,leadId]` on the table `CampaignContact` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[campaignId,customerId]` on the table `CampaignContact` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_customerId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignContact" DROP CONSTRAINT "CampaignContact_contactId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignContact" DROP CONSTRAINT "CampaignContact_customerId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignContact" DROP CONSTRAINT "CampaignContact_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_assignedUserId_fkey";

-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerDeal" DROP CONSTRAINT "CustomerDeal_addedById_fkey";

-- DropForeignKey
ALTER TABLE "CustomerDeal" DROP CONSTRAINT "CustomerDeal_customerId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerDeal" DROP CONSTRAINT "CustomerDeal_dealId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerDeal" DROP CONSTRAINT "CustomerDeal_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_contactId_fkey";

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_customerId_fkey";

-- DropForeignKey
ALTER TABLE "EmailDeliveryLog" DROP CONSTRAINT "EmailDeliveryLog_contactId_fkey";

-- DropForeignKey
ALTER TABLE "EmailDeliveryLog" DROP CONSTRAINT "EmailDeliveryLog_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_customerId_fkey";

-- DropForeignKey
ALTER TABLE "SMSQueue" DROP CONSTRAINT "SMSQueue_contactId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_customerId_fkey";

-- DropIndex
DROP INDEX "CampaignContact_campaignId_contactId_key";

-- DropIndex
DROP INDEX "Contact_tenantId_isArchived_idx";

-- DropIndex
DROP INDEX "Contact_tenantId_lifecycleStage_idx";

-- DropIndex
DROP INDEX "EmailDeliveryLog_tenantId_contactId_idx";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "tags" DROP DEFAULT,
ALTER COLUMN "productInterests" DROP DEFAULT,
ALTER COLUMN "activeProducts" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CampaignContact" DROP COLUMN "contactId";

-- AlterTable
ALTER TABLE "Deal" DROP COLUMN "contactId";

-- AlterTable
ALTER TABLE "EmailDeliveryLog" DROP COLUMN "contactId";

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "productInterest" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OAuthAccount" ALTER COLUMN "tenantId" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SMSQueue" DROP COLUMN "contactId";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "TenantDocument" ALTER COLUMN "documentType" SET DEFAULT 'business_doc',
ALTER COLUMN "documentKey" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TenantDomain" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TenantDomainSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TenantGroup" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "Customer";

-- DropTable
DROP TABLE "CustomerDeal";

-- CreateTable
CREATE TABLE "AccountImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "successfulRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AccountImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountImportResult" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "accountId" TEXT,
    "remarks" TEXT,
    "name" TEXT,
    "industry" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountImportResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "successfulRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ContactImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactImportResult" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "contactId" TEXT,
    "remarks" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "companyName" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactImportResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountImport_tenantId_status_idx" ON "AccountImport"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AccountImport_tenantId_createdAt_idx" ON "AccountImport"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountImportResult_importId_status_idx" ON "AccountImportResult"("importId", "status");

-- CreateIndex
CREATE INDEX "AccountImportResult_importId_rowNumber_idx" ON "AccountImportResult"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "ContactImport_tenantId_status_idx" ON "ContactImport"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ContactImport_tenantId_createdAt_idx" ON "ContactImport"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactImportResult_importId_status_idx" ON "ContactImportResult"("importId", "status");

-- CreateIndex
CREATE INDEX "ContactImportResult_importId_rowNumber_idx" ON "ContactImportResult"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "Activity_tenantId_leadId_createdAt_idx" ON "Activity"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_tenantId_customerId_createdAt_idx" ON "Activity"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContact_campaignId_leadId_key" ON "CampaignContact"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContact_campaignId_customerId_key" ON "CampaignContact"("campaignId", "customerId");

-- CreateIndex
CREATE INDEX "EmailDeliveryLog_tenantId_leadId_idx" ON "EmailDeliveryLog"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "EmailDeliveryLog_tenantId_customerId_idx" ON "EmailDeliveryLog"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryLog" ADD CONSTRAINT "EmailDeliveryLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SMSQueue" ADD CONSTRAINT "SMSQueue_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SMSQueue" ADD CONSTRAINT "SMSQueue_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountImport" ADD CONSTRAINT "AccountImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountImport" ADD CONSTRAINT "AccountImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountImportResult" ADD CONSTRAINT "AccountImportResult_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AccountImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImport" ADD CONSTRAINT "ContactImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImport" ADD CONSTRAINT "ContactImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImportResult" ADD CONSTRAINT "ContactImportResult_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ContactImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

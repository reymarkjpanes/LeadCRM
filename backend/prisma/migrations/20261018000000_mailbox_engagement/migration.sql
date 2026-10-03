-- Additive migration. Historical records, status values and stage IDs remain intact.
ALTER TABLE "Lead" ADD COLUMN "lastMeaningfulInboundAt" TIMESTAMP(3), ADD COLUMN "firstUnansweredOutboundAt" TIMESTAMP(3), ADD COLUMN "engagementEvaluatedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "lastStatusChangedAt" TIMESTAMP(3), ADD COLUMN "lastMeaningfulInboundAt" TIMESTAMP(3), ADD COLUMN "firstUnansweredOutboundAt" TIMESTAMP(3), ADD COLUMN "engagementEvaluatedAt" TIMESTAMP(3);
-- Existing records start behind a manual-change barrier; old mail cannot rewrite them.
UPDATE "Lead" SET "lastStatusChangedAt" = CURRENT_TIMESTAMP WHERE "lastStatusChangedAt" IS NULL;
UPDATE "Contact" SET "lastStatusChangedAt" = CURRENT_TIMESTAMP;
ALTER TABLE "Deal" ADD COLUMN "wonConfirmationType" TEXT, ADD COLUMN "wonConfirmationNote" TEXT, ADD COLUMN "wonConfirmedById" TEXT, ADD COLUMN "wonConfirmedAt" TIMESTAMP(3), ADD COLUMN "stageChangedAt" TIMESTAMP(3);
UPDATE "Deal" SET "stageChangedAt" = CURRENT_TIMESTAMP;
ALTER TABLE "EmailAccount" ADD COLUMN "syncLeaseUntil" TIMESTAMP(3), ADD COLUMN "syncLeaseId" TEXT, ADD COLUMN "syncPageToken" TEXT, ADD COLUMN "syncBaselineHistoryId" TEXT, ADD COLUMN "syncError" TEXT;
CREATE TABLE "MailboxOAuthState" ("stateHash" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL, "sessionHash" TEXT NOT NULL, "verifier" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "MailboxOAuthState_expiresAt_idx" ON "MailboxOAuthState"("expiresAt");
CREATE TABLE "MailboxMessage" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "direction" TEXT NOT NULL,
  "from" TEXT NOT NULL, "recipients" TEXT[] NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "snippet" TEXT NOT NULL, "labels" TEXT[] NOT NULL, "sentAt" TIMESTAMP(3) NOT NULL, "rfcMessageId" TEXT,
  "leadId" TEXT, "contactId" TEXT, "dealId" TEXT, "meaningful" BOOLEAN NOT NULL DEFAULT false,
  "readyToClose" BOOLEAN NOT NULL DEFAULT false, "needsDealAssociation" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailboxMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MailboxMessage_direction_check" CHECK ("direction" IN ('inbound', 'outbound', 'unknown'))
);
CREATE UNIQUE INDEX "MailboxMessage_accountId_providerMessageId_key" ON "MailboxMessage"("accountId", "providerMessageId");
CREATE INDEX "MailboxMessage_tenantId_accountId_threadId_sentAt_idx" ON "MailboxMessage"("tenantId", "accountId", "threadId", "sentAt");
CREATE INDEX "MailboxMessage_tenantId_leadId_sentAt_idx" ON "MailboxMessage"("tenantId", "leadId", "sentAt");
CREATE INDEX "MailboxMessage_tenantId_contactId_sentAt_idx" ON "MailboxMessage"("tenantId", "contactId", "sentAt");

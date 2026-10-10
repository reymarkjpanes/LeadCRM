ALTER TABLE "EmailAccount"
  ADD COLUMN "syncScopeHash" TEXT,
  ADD COLUMN "syncBatch" JSONB,
  ADD COLUMN "syncQueryIndex" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "syncRequestedAt" TIMESTAMP(3),
  ADD COLUMN "syncRetryAt" TIMESTAMP(3),
  ADD COLUMN "syncCheckedAt" TIMESTAMP(3),
  ADD COLUMN "mailboxVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MailboxMessage"
  ADD COLUMN "fromAddress" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "recipientAddresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "draftId" TEXT,
  ADD COLUMN "crmDraft" BOOLEAN NOT NULL DEFAULT false;
-- Preserve all historical rows. These projections enable exact scoped reads.
UPDATE "MailboxMessage" SET
  "fromAddress" = lower(trim(coalesce(substring("from" from '<([^<>]+)>'), "from"))),
  "recipientAddresses" = ARRAY(SELECT DISTINCT lower(trim(coalesce(substring(value from '<([^<>]+)>'), value))) FROM unnest("recipients") AS value);
CREATE INDEX "MailboxMessage_tenantId_accountId_fromAddress_sentAt_idx" ON "MailboxMessage"("tenantId", "accountId", "fromAddress", "sentAt");
CREATE INDEX "MailboxMessage_recipientAddresses_idx" ON "MailboxMessage" USING GIN("recipientAddresses");
CREATE TABLE "ScheduledMailboxEmail" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL, "requestId" TEXT NOT NULL, "draftId" TEXT NOT NULL,
  "recipients" TEXT[] NOT NULL, "subject" TEXT NOT NULL, "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "leaseId" TEXT, "leaseUntil" TIMESTAMP(3), "retryAt" TIMESTAMP(3),
  "providerMessageId" TEXT, "providerThreadId" TEXT, "lastError" TEXT, "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledMailboxEmail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledMailboxEmail_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduledMailboxEmail_accountId_requestId_key" ON "ScheduledMailboxEmail"("accountId", "requestId");
CREATE UNIQUE INDEX "ScheduledMailboxEmail_accountId_draftId_key" ON "ScheduledMailboxEmail"("accountId", "draftId");
CREATE INDEX "ScheduledMailboxEmail_status_scheduledAt_retryAt_idx" ON "ScheduledMailboxEmail"("status", "scheduledAt", "retryAt");
CREATE INDEX "ScheduledMailboxEmail_tenantId_accountId_scheduledAt_idx" ON "ScheduledMailboxEmail"("tenantId", "accountId", "scheduledAt");

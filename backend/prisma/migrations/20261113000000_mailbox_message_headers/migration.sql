-- Additive header fidelity only. Existing bodies, identifiers and CRM history stay intact.
ALTER TABLE "MailboxMessage"
  ADD COLUMN "ccRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "replyToAddress" TEXT,
  ADD COLUMN "sourceMessageId" TEXT;

-- Reserve interactive sends before Gmail accepts them; a lost response cannot replay delivery.
CREATE TABLE "MailboxSendReceipt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sending',
  "providerMessageId" TEXT,
  "providerThreadId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailboxSendReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MailboxSendReceipt_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MailboxSendReceipt_accountId_requestId_key" ON "MailboxSendReceipt"("accountId", "requestId");

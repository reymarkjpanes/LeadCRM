-- Retain the provider's original reply header. No inferred historical backfill.
ALTER TABLE "MailboxMessage" ADD COLUMN "rfcInReplyTo" TEXT;

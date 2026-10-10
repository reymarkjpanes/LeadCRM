-- Add provider metadata without rewriting messages, thread IDs or history.
-- Historical metadata is populated only by subsequent authorized Gmail ingestion.
ALTER TABLE "MailboxMessage"
  ADD COLUMN "rfcReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]'::JSONB;

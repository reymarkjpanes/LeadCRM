ALTER TABLE "Deal" ADD COLUMN "closingValues" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Deal" ADD COLUMN "closingSnapshot" JSONB;
ALTER TABLE "MailboxMessage" ADD COLUMN "engagementRuleVersion" INTEGER NOT NULL DEFAULT 0;
-- Existing confirmed sales retain their submitted evidence and remain immutable.
UPDATE "Deal" SET "closingSnapshot" = jsonb_build_object(
  'fields', '[]'::jsonb,
  'values', jsonb_build_object('confirmation-type', "wonConfirmationType", 'closing-notes', "wonConfirmationNote", 'confirmation-date', to_char("closedAt", 'YYYY-MM-DD')),
  'legacy', true, 'closedAt', "wonConfirmedAt", 'closedById', "wonConfirmedById"
) WHERE "wonConfirmedAt" IS NOT NULL;

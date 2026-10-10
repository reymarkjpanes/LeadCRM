-- Additive: preserve all existing Email history and provider identifiers.
ALTER TABLE "CampaignContact"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "providerUpdatedAt" TIMESTAMP(3);

ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';

ALTER TABLE "Campaign"
  ADD COLUMN "submissionLeaseId" TEXT,
  ADD COLUMN "submissionLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "submissionInterruptedAt" TIMESTAMP(3);
ALTER TABLE "CampaignContact" ADD COLUMN "submissionAttemptedAt" TIMESTAMP(3);
CREATE INDEX "Campaign_submissionFinishedAt_submissionLeaseUntil_idx"
  ON "Campaign"("submissionFinishedAt", "submissionLeaseUntil");

-- Older unfinished pending rows have no attempt marker. Treat their outcomes
-- as uncertain rather than falsely claiming they were never sent.
UPDATE "CampaignContact" AS recipient
SET "submissionAttemptedAt" = campaign."submissionStartedAt"
FROM "Campaign" AS campaign
WHERE recipient."campaignId" = campaign.id AND recipient."tenantId" = campaign."tenantId"
  AND campaign."submissionStartedAt" IS NOT NULL AND campaign."submissionFinishedAt" IS NULL
  AND recipient.status IN ('pending', 'submitting');

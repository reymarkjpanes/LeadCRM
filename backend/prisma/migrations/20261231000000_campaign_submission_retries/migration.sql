-- Accepted and uncertain historical messages are never enrolled in retries.
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TABLE "CampaignContact"
  ADD COLUMN "submissionAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextSubmissionAttemptAt" TIMESTAMP(3);
UPDATE "CampaignContact" SET "submissionAttemptCount" = 1 WHERE "submissionAttemptedAt" IS NOT NULL;
CREATE INDEX "CampaignContact_status_nextSubmissionAttemptAt_idx" ON "CampaignContact"("status", "nextSubmissionAttemptAt");

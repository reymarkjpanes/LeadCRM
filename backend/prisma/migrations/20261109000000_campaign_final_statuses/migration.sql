-- Deploy with the matching backend while campaign submissions are stopped.
-- Retain every campaign/recipient/event; remove only obsolete enum members.
BEGIN;
LOCK TABLE "Campaign", "CampaignContact", "EmailDeliveryLog", "EmailEvent" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Campaign"
  ADD COLUMN "submissionStartedAt" TIMESTAMP(3),
  ADD COLUMN "submissionFinishedAt" TIMESTAMP(3),
  ALTER COLUMN "status" DROP DEFAULT;

-- Historical non-drafts stay non-editable, including inconclusive history.
-- A past submission is no longer running in the new deployment process.
UPDATE "Campaign" SET
  "submissionStartedAt" = COALESCE("sentAt", "createdAt"),
  "submissionFinishedAt" = COALESCE("sentAt", "updatedAt")
WHERE "status"::text <> 'DRAFT';

CREATE TYPE "CampaignStatus_final" AS ENUM ('SENDING', 'SENT', 'PARTIALLY_SENT', 'DELIVERED', 'FAILED', 'DRAFT');

-- Old email sentAt could mean HTTP acceptance. Require a Brevo request receipt
-- for such rows; opens/clicks never prove successful sending or delivery.
WITH evidence AS (
  SELECT c."id", c."status"::text AS old_status, c."recipientCount", r."id" AS recipient_id,
    r."status" = 'excluded' AS excluded,
    (r."status" IN ('failed','error','hard_bounce','blocked','invalid_email') OR
      COALESCE(lower(r."failureReason"), '') IN ('failed','error','hard_bounce','blocked','invalid_email')) AS failed,
    r."deliveredAt" IS NOT NULL AS delivered,
    (r."deliveredAt" IS NOT NULL OR (r."sentAt" IS NOT NULL AND
      (c."type" <> 'EMAIL' OR r."submittedAt" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "EmailDeliveryLog" l JOIN "EmailEvent" e ON e."deliveryLogId" = l."id"
        WHERE l."tenantId" = c."tenantId" AND e."tenantId" = c."tenantId"
          AND l."campaignId" = c."id" AND l."brevoMessageId" = r."messageId" AND e."eventType" = 'request'
      )))) AS successful
  FROM "Campaign" c LEFT JOIN "CampaignContact" r
    ON r."campaignId" = c."id" AND r."tenantId" = c."tenantId"
), totals AS (
  SELECT "id", old_status, "recipientCount",
    count(*) FILTER (WHERE recipient_id IS NOT NULL AND NOT excluded) AS eligible,
    count(*) FILTER (WHERE NOT excluded AND failed) AS failed,
    count(*) FILTER (WHERE NOT excluded AND NOT failed AND successful) AS successful,
    count(*) FILTER (WHERE NOT excluded AND NOT failed AND delivered) AS delivered
  FROM evidence GROUP BY "id", old_status, "recipientCount"
)
UPDATE "Campaign" c SET "status" = (CASE
  WHEN t.old_status = 'DRAFT' THEN 'DRAFT'
  WHEN t.eligible = t."recipientCount" AND t.eligible > 0 THEN CASE
    WHEN t.delivered = t.eligible AND t.failed = 0 THEN 'DELIVERED'
    WHEN t.successful > 0 AND t.failed > 0 THEN 'PARTIALLY_SENT'
    WHEN t.failed = t.eligible THEN 'FAILED'
    WHEN t.successful = t.eligible AND t.failed = 0 THEN 'SENT'
    WHEN t.old_status IN ('SENT','PARTIALLY_SENT','DELIVERED','FAILED') THEN t.old_status
    ELSE 'SENDING' END
  WHEN t.old_status IN ('SENT','PARTIALLY_SENT','DELIVERED','FAILED') THEN t.old_status
  ELSE 'SENDING' END)::"CampaignStatus"
FROM totals t WHERE c."id" = t."id";

ALTER TABLE "Campaign" ALTER COLUMN "status" TYPE "CampaignStatus_final"
  USING ("status"::text::"CampaignStatus_final");
DROP TYPE "CampaignStatus";
ALTER TYPE "CampaignStatus_final" RENAME TO "CampaignStatus";
ALTER TABLE "Campaign" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"CampaignStatus";
COMMIT;

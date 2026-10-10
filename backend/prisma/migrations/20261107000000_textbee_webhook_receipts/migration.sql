CREATE TABLE "SmsWebhookReceipt" (
    "idempotencyKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignContactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmsWebhookReceipt_pkey" PRIMARY KEY ("idempotencyKey")
);
CREATE INDEX "SmsWebhookReceipt_campaignContactId_idx" ON "SmsWebhookReceipt"("campaignContactId");
CREATE INDEX "SmsWebhookReceipt_tenantId_idx" ON "SmsWebhookReceipt"("tenantId");
CREATE UNIQUE INDEX "CampaignContact_id_tenantId_key" ON "CampaignContact"("id", "tenantId");
ALTER TABLE "SmsWebhookReceipt" ADD CONSTRAINT "SmsWebhookReceipt_campaignContactId_tenantId_fkey"
  FOREIGN KEY ("campaignContactId", "tenantId") REFERENCES "CampaignContact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

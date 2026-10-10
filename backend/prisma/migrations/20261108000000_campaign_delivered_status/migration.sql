-- Additive only. Historical statuses and recipient evidence remain untouched.
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

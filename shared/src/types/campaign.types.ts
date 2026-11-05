export type CampaignType = 'EMAIL' | 'SMS' | 'MULTI_CHANNEL';
export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'SUBMITTED', 'INTERRUPTED', 'SENT', 'PARTIALLY_SENT', 'DELIVERED', 'FAILED'] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  /** Unconfirmed SMS evidence requires review, without inventing a delivery state. */
  reviewRequired?: boolean;
  /** Present only on SMS prepared with recipient link tracking. Older SMS remain untracked. */
  smsTrackingVersion?: number | null;
  submissionStartedAt?: string | null;
  submissionFinishedAt?: string | null;
  submissionInterruptedAt?: string | null;
  subject?: string;
  body?: string;
  audienceSource?: "LEADS" | "CONTACTS" | "ALL" | null;
  targetAudienceId?: string | null;
  emailTemplateId?: string | null;
  smsTemplateId?: string | null;
  recipientCount: number;
  failedCount: number;
  sentCount: number;
  /** Distinct recipients with persisted provider open evidence. */
  openedCount: number;
  /** Distinct recipients with persisted email-provider or SMS redirect click evidence. */
  clickedCount: number;
  engagement: number;
  scheduledFor?: string | null;
  scheduledById?: string | null;
  scheduleConfig?: import('../contracts/campaign-email').CampaignScheduleConfig | null;
  sentAt?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  type: CampaignType;
  subject?: string;
  body?: string;
  audienceSource?: "LEADS" | "CONTACTS" | null;
  targetAudienceId?: string | null;
  emailTemplateId?: string | null;
  smsTemplateId?: string | null;
}

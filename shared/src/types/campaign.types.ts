export type CampaignType = 'EMAIL' | 'SMS' | 'MULTI_CHANNEL';
export type CampaignStatus = 'DRAFT' | 'SENDING' | 'INTERRUPTED' | 'SENT' | 'PARTIALLY_SENT' | 'DELIVERED' | 'FAILED';

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
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
  /** Distinct recipients with persisted provider click evidence. */
  clickedCount: number;
  engagement: number;
  scheduledFor?: string;
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
  audienceSource?: "LEADS" | "CONTACTS" | "ALL" | null;
  targetAudienceId?: string | null;
  emailTemplateId?: string | null;
  smsTemplateId?: string | null;
  scheduledFor?: string;
}

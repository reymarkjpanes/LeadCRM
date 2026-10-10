import { Campaign, CampaignType, CampaignStatus, CreateCampaignInput } from '../types/campaign.types';
import type { CampaignSendResult } from './campaign-email';
export type { Campaign, CampaignType, CampaignStatus, CreateCampaignInput };

export interface UpdateCampaignInput extends Partial<CreateCampaignInput> {
  status?: CampaignStatus;
}

export interface CampaignListResponse {
  data: Campaign[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

export interface CampaignResponse {
  success: boolean;
  data: Campaign;
}

export interface CampaignMetricsSummary {
  activeCampaigns: number;
  sent: number;
  opened: number;
  clicked: number;
  /** Email-only denominator; optional during a coordinated API rollout. */
  emailSent?: number;
}

export interface CampaignDetailResponse extends CampaignResponse {
  data: Campaign & { sendResult: CampaignSendResult };
}

/** Public sender identity only; provider credentials are never returned. */
export interface CampaignEmailSettings {
  senderName: string;
  senderEmail: string | null;
}

export interface CampaignRecipient {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  deliveryStatus: 'Delivered' | 'Bounced' | 'Submitted' | 'Failed' | 'Pending' | 'Sent' | 'Retrying' | 'Excluded' | 'Unknown';
  opened: boolean;
  clicked: boolean;
  lastActivity: string | null;
  failureReason: string | null;
}

export interface CampaignClickedLink {
  url: string;
  /** Recipient count shown as Total Clicks in the report. */
  uniqueClicks: number;
  /** Retained provider event count for API compatibility. */
  totalClicks: number;
  clickRate: number;
  clickShare: number;
  lastClicked: string;
}

export interface CampaignReportResponse extends CampaignDetailResponse {
  data: CampaignDetailResponse['data'] & {
    deliveredCount: number;
    bouncedCount: number;
    recipients: CampaignRecipient[];
    topLinks: CampaignClickedLink[];
    /** Provider event totals; the report uses Campaign.clickedCount for recipients. */
    totalClicks: number | null;
    uniqueClicks: number | null;
    totalOpens: number | null;
    uniqueOpens: number | null;
    ctr: number | null;
    ctor: number | null;
    trackingStatus: 'draft' | 'not_sent' | 'no_links' | 'pending' | 'recorded' | 'historical_unavailable';
    trackingUpdatedAt: string | null;
  };
}

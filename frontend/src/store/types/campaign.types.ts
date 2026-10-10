// ─── Campaign & Template ───────────────────────────────────────────────────

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: 'Email' | 'Sms' | 'Multi-Channel';
  status: 'Draft' | 'sending' | 'interrupted' | 'sent' | 'partially_sent' | 'delivered' | 'failed';
  submissionStartedAt?: string | null;
  submissionFinishedAt?: string | null;
  submissionInterruptedAt?: string | null;
  targetAudience: string;
  targetAudienceId?: string | null;
  audienceSource?: 'LEADS' | 'CONTACTS' | 'ALL' | null;
  subject?: string;
  body?: string;
  emailTemplateId?: string | null;
  recipientCount?: number;
  failedCount?: number;
  deliveredCount?: number;
  bouncedCount?: number;
  sentCount: number;
  openedCount?: number;
  clickedCount?: number;
  engagement: number;
  createdAt: string;
  sentAt?: string | null;
  isArchived?: boolean;
}

export interface Template {
  id: string;
  tenantId: string;
  name: string;
  type: 'Email' | 'SMS';
  category: string;
  subject?: string;
  content: string;
  isArchived?: boolean;
}

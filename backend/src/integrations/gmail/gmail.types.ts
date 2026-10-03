import type { MailboxEmail } from '@leadcrm/shared';
export interface GmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

export interface GmailEmail extends MailboxEmail {
  cc?: string[];
  plainText?: string;
  rfcMessageId?: string;
  automated?: boolean;
}

export interface GmailThread {
  id: string;
  subject: string;
  snippet: string;
  lastMessageDate: string;
  messageCount: number;
  participants: string[];
  isRead: boolean;
}

export interface EmailAccountStatus {
  isConnected: boolean;
  email: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
}

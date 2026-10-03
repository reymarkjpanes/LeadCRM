import { apiClient } from '@/lib/api/client';
export type { MailboxEmail as GmailEmail } from '@leadcrm/shared';
import type { MailboxEmail as GmailEmail, MailboxUnreadCount } from '@leadcrm/shared';

export const fetchGmailUnreadCount = () => apiClient.get<MailboxUnreadCount>('/integrations/gmail/unread-count');

export interface GmailConnectionStatus {
  isConnected: boolean;
  email: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
}

export const syncGmail = () => apiClient.post<{ hasMore: boolean; processed?: number }>('/integrations/gmail/sync', {});
export const fetchGmailThread = (threadId: string) => apiClient.get<EmailListResponse & { dealOptions: { id: string; title: string; stage: string }[]; canAssociateDeal: boolean }>(`/integrations/gmail/threads/${encodeURIComponent(threadId)}`);
export const associateThreadDeal = (threadId: string, dealId: string) => apiClient.patch(`/integrations/gmail/threads/${encodeURIComponent(threadId)}/deal`, { dealId });

interface EmailListResponse {
  emails: GmailEmail[];
  nextPageToken?: string;
}

interface AuthorizeResponse {
  url: string;
}

interface SendEmailResponse {
  success: boolean;
  messageId: string;
  threadId: string;
}

/**
 * Gets the Gmail OAuth authorization URL and redirects the user.
 */
export async function initiateGmailConnect(): Promise<void> {
  const { url } = await apiClient.get<AuthorizeResponse>('/integrations/gmail/authorize');
  window.location.href = url;
}

/**
 * Checks whether the current user has a connected Gmail account.
 */
export async function getGmailStatus(): Promise<GmailConnectionStatus> {
  return apiClient.get<GmailConnectionStatus>('/integrations/gmail/status');
}

/**
 * Fetches emails from the connected Gmail inbox.
 */
export async function fetchGmailEmails(options?: {
  maxResults?: number;
  query?: string;
  pageToken?: string;
}): Promise<EmailListResponse> {
  return apiClient.get<EmailListResponse>('/integrations/gmail/emails', {
    params: options as Record<string, unknown>,
  });
}

/**
 * Sends an email through the connected Gmail account.
 */
export async function sendGmailEmail(
  to: string | string[],
  subject: string,
  body: string,
  replyToMessageId?: string,
): Promise<SendEmailResponse> {
  return apiClient.post<SendEmailResponse>('/integrations/gmail/send', { to, subject, body, replyToMessageId });
}

/**
 * Disconnects the user's Gmail account.
 */
export async function disconnectGmail(): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/integrations/gmail/disconnect', {});
}

/**
 * Moves selected emails to trash.
 */
export async function trashGmailEmails(messageIds: string[]): Promise<{ success: boolean; count: number }> {
  return apiClient.post<{ success: boolean; count: number }>('/integrations/gmail/trash', { messageIds });
}

/**
 * Archives selected emails (removes from inbox).
 */
export async function archiveGmailEmails(messageIds: string[]): Promise<{ success: boolean; count: number }> {
  return apiClient.post<{ success: boolean; count: number }>('/integrations/gmail/archive', { messageIds });
}

/**
 * Saves a draft to Gmail.
 */
export async function saveGmailDraft(
  to: string,
  subject: string,
  body: string,
  draftId?: string,
): Promise<{ success: boolean; draftId: string; messageId: string }> {
  return apiClient.post<{ success: boolean; draftId: string; messageId: string }>('/integrations/gmail/drafts', { to, subject, body, draftId });
}

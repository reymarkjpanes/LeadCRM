import { apiClient } from '@/lib/api/client';
export type { MailboxEmail as GmailEmail } from '@leadcrm/shared';
import type { MailboxEmail as GmailEmail, MailboxUnreadCount, MailboxListOptions, ScheduledMailboxEmailDetail, MailboxConversationDetail } from '@leadcrm/shared';

export const fetchGmailUnreadCount = () => apiClient.get<MailboxUnreadCount>('/integrations/gmail/unread-count');

export interface GmailConnectionStatus {
  isConnected: boolean;
  email: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  syncError?: string | null;
  retryAt?: string | null;
}

export const syncGmail = () => apiClient.post<{ hasMore: boolean; processed?: number; retryAt?: string }>('/integrations/gmail/sync', {});
export const fetchGmailThread = (threadId: string) => apiClient.get<EmailListResponse & { dealOptions: { id: string; title: string; stage: string }[]; canAssociateDeal: boolean }>(`/integrations/gmail/threads/${encodeURIComponent(threadId)}`);
export const fetchGmailCorrespondent = (conversationId: string, pageToken?: string) => apiClient.get<MailboxConversationDetail>(`/integrations/gmail/conversations/${encodeURIComponent(conversationId)}`, { params: { pageToken } });
export const setGmailMessageReadState = (messageId: string, isRead: boolean) => apiClient.patch(`/integrations/gmail/messages/${encodeURIComponent(messageId)}/read-state`, { isRead });
export const associateThreadDeal = (threadId: string, dealId: string) => apiClient.patch(`/integrations/gmail/threads/${encodeURIComponent(threadId)}/deal`, { dealId });
export const setGmailThreadReadState = (threadId: string, isRead: boolean) => apiClient.patch(`/integrations/gmail/threads/${encodeURIComponent(threadId)}/read-state`, { isRead });
export const archiveGmailThread = (threadId: string) => apiClient.post(`/integrations/gmail/threads/${encodeURIComponent(threadId)}/archive`, {});
export const trashGmailThread = (threadId: string) => apiClient.post(`/integrations/gmail/threads/${encodeURIComponent(threadId)}/trash`, {});
export const archiveGmailConversations = (ids: string[]) => apiClient.post('/integrations/gmail/archive', ids.every(id => /^c_[a-f0-9]{32}$/.test(id)) ? { conversationIds: ids } : { threadIds: ids });
export const trashGmailConversations = (ids: string[]) => apiClient.post('/integrations/gmail/trash', ids.every(id => /^c_[a-f0-9]{32}$/.test(id)) ? { conversationIds: ids } : { threadIds: ids });

interface EmailListResponse {
  emails: GmailEmail[];
  nextPageToken?: string;
  unreadCount?: number;
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
export async function fetchGmailEmails(options?: MailboxListOptions, signal?: AbortSignal): Promise<EmailListResponse> {
  return apiClient.get<EmailListResponse>('/integrations/gmail/emails', {
    params: options as Record<string, unknown>,
    signal,
  });
}

export const scheduleGmailEmail = (data: { to: string[]; subject: string; body: string; scheduledAt: string; requestId: string; draftId?: string; replyToMessageId?: string; forwardSourceMessageId?: string }) =>
  apiClient.post<{ id: string; status: string }>('/integrations/gmail/scheduled', data);
export const deleteGmailDraft = (draftId: string) => apiClient.delete(`/integrations/gmail/drafts/${encodeURIComponent(draftId)}`);
export const getScheduledGmailEmail = (id: string) => apiClient.get<ScheduledMailboxEmailDetail>(`/integrations/gmail/scheduled/${encodeURIComponent(id)}`);
export const cancelScheduledGmailEmail = (id: string) => apiClient.post<{ id: string; status: string }>(`/integrations/gmail/scheduled/${encodeURIComponent(id)}/cancel`, {});

/**
 * Sends an email through the connected Gmail account.
 */
export async function sendGmailEmail(
  to: string | string[],
  subject: string,
  body: string,
  replyToMessageId?: string,
  draftId?: string,
  forwardSourceMessageId?: string,
  requestId?: string,
): Promise<SendEmailResponse> {
  return apiClient.post<SendEmailResponse>('/integrations/gmail/send', { to, subject, body, replyToMessageId, draftId, forwardSourceMessageId, requestId });
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
  replyToMessageId?: string,
  forwardSourceMessageId?: string,
): Promise<{ success: boolean; draftId: string; messageId: string }> {
  return apiClient.post<{ success: boolean; draftId: string; messageId: string }>('/integrations/gmail/drafts', { to, subject, body, draftId, replyToMessageId, forwardSourceMessageId });
}

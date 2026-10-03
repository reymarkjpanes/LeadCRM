import prisma from '../../config/database.config';
import { refreshAccessToken, getUserInfo } from './gmail.oauth';
import { GmailEmail, GmailThread } from './gmail.types';
import { encryptToken, decryptToken } from '../../core/encryption/crypto.service';
import { AppError } from '../../shared/errors/app-error';
import { normalizeEmail } from './engagement-rules';
import { readAuthUser } from '../../core/auth/auth-user';
import { isMailboxOwner } from './mailbox-ownership';
import { readGmailJson } from './gmail-read';
import type { MailboxUnreadCount } from '@leadcrm/shared';



/**
 * Ensures the access token is still valid; refreshes if expired.
 * Decrypts stored tokens before use and re-encrypts after refresh.
 * Returns a valid plaintext access token or throws if refresh fails.
 */
export async function getValidAccessToken(tenantId: string, userId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({
    where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } },
  });

  if (!account || !account.isActive) {
    throw new Error('Gmail account not connected');
  }

  const user = await readAuthUser(userId, tenantId);
  if (!isMailboxOwner({ userId, tenantId, email: user.email }, account.email)) {
    throw new AppError('Mailbox ownership does not match, or temporary test access expired.', 403);
  }

  // Decrypt access token from DB (stored encrypted)
  const decryptedAccessToken = decryptToken(account.accessToken);

  // Check if token is still valid (with 5-minute buffer)
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;
  const isExpired = account.tokenExpiresAt
    ? account.tokenExpiresAt.getTime() - bufferMs < now.getTime()
    : true;

  if (!isExpired) {
    return decryptedAccessToken;
  }

  // Token expired — refresh it
  if (!account.refreshToken) {
    throw new Error('No refresh token available. Please reconnect your Gmail account.');
  }

  // Decrypt refresh token before passing to OAuth client
  const decryptedRefreshToken = decryptToken(account.refreshToken);
  const tokens = await refreshAccessToken(decryptedRefreshToken);

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Re-encrypt new tokens before persisting
  const newEncryptedAccessToken = encryptToken(tokens.access_token);
  const newEncryptedRefreshToken = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : undefined;

  const refreshed = await prisma.emailAccount.updateMany({
    where: { id: account.id, tenantId, userId, isActive: true, refreshToken: account.refreshToken },
    data: {
      accessToken: newEncryptedAccessToken,
      tokenExpiresAt: expiresAt,
      ...(newEncryptedRefreshToken ? { refreshToken: newEncryptedRefreshToken } : {}),
    },
  });

  if (!refreshed.count) throw new AppError('Mailbox connection changed. Retry after reconnecting.', 409);

  return tokens.access_token;
}

/**
 * Retrieves a valid access token for the system Gmail sender account.
 * Looks up EmailAccount where tenantId='system' and userId=GMAIL_SYSTEM_SENDER_USER_ID.
 * Returns null if no system sender is configured or if the account is inactive.
 */
export async function getSystemAccessToken(): Promise<string | null> {
  const systemUserId = process.env.GMAIL_SYSTEM_SENDER_USER_ID;
  if (!systemUserId) {
    // eslint-disable-next-line no-console
    console.warn('[GmailSystem] GMAIL_SYSTEM_SENDER_USER_ID is not set — Gmail transport disabled');
    return null;
  }

  const account = await prisma.emailAccount.findUnique({
    where: { tenantId_userId_provider: { tenantId: 'system', userId: systemUserId, provider: 'gmail' } },
  });

  if (!account) {
    // eslint-disable-next-line no-console
    console.warn(`[GmailSystem] No EmailAccount row found for tenantId='system' userId='${systemUserId}'. Run: npm run gmail:setup-system-sender`);
    return null;
  }

  if (!account.isActive) {
    // eslint-disable-next-line no-console
    console.warn(`[GmailSystem] EmailAccount for tenantId='system' is inactive — re-run gmail:setup-system-sender`);
    return null;
  }

  const decryptedAccessToken = decryptToken(account.accessToken);

  const now = new Date();
  const bufferMs = 5 * 60 * 1000;
  const isExpired = account.tokenExpiresAt
    ? account.tokenExpiresAt.getTime() - bufferMs < now.getTime()
    : true;

  if (!isExpired) {
    return decryptedAccessToken;
  }

  if (!account.refreshToken) {
    // eslint-disable-next-line no-console
    console.warn('[GmailSystem] Access token expired and no refresh token stored — re-run gmail:setup-system-sender');
    return null;
  }

  try {
    const decryptedRefreshToken = decryptToken(account.refreshToken);
    const tokens = await refreshAccessToken(decryptedRefreshToken);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const newEncryptedAccessToken = encryptToken(tokens.access_token);
    const newEncryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : undefined;

    await prisma.emailAccount.update({
      where: { tenantId_userId_provider: { tenantId: 'system', userId: systemUserId, provider: 'gmail' } },
      data: {
        accessToken: newEncryptedAccessToken,
        tokenExpiresAt: expiresAt,
        ...(newEncryptedRefreshToken ? { refreshToken: newEncryptedRefreshToken } : {}),
      },
    });

    // eslint-disable-next-line no-console
    console.info('[GmailSystem] Access token refreshed successfully');
    return tokens.access_token;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // eslint-disable-next-line no-console
    console.error('[GmailSystem] Token refresh failed — falling back to next transport:', message);
    return null;
  }
}

/**
 * Sends an email via Gmail API using a pre-provided plaintext access token.
 * Used for system-level sending (e.g., auth OTPs) where no userId context exists.
 */
export async function sendEmailWithToken(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ messageId: string; threadId: string }> {
  const rawMessage = createRawMessage(to, subject, body);

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to send email via Gmail: ${response.status} — ${errorBody}`);
  }

  const result = await response.json() as { id: string; threadId: string };
  return { messageId: result.id, threadId: result.threadId };
}

/**
 * Fetches emails from the user's Gmail inbox.
 */
export async function fetchUnreadCount(tenantId: string, userId: string): Promise<MailboxUnreadCount> {
  const accessToken = await getValidAccessToken(tenantId, userId);
  const inbox = await readGmailJson<{ messagesUnread?: number }>(accessToken, 'labels/INBOX?fields=messagesUnread');
  return { unreadCount: inbox.messagesUnread ?? 0 };
}

export async function fetchEmails(
  tenantId: string,
  userId: string,
  options: { maxResults?: number; query?: string; pageToken?: string } = {},
): Promise<{ emails: GmailEmail[]; nextPageToken?: string }> {
  const accessToken = await getValidAccessToken(tenantId, userId);
  const { maxResults = 20, query = '-in:spam -in:trash -in:drafts', pageToken } = options;

  const params = new URLSearchParams({
    maxResults: maxResults.toString(),
    q: query,
  });
  if (pageToken) params.set('pageToken', pageToken);

  const isDraftList = /(?:^|\s)in:drafts(?:\s|$)/i.test(query);
  const listData = await readGmailJson<{
    messages?: { id: string; threadId: string }[];
    drafts?: { id: string; message: { id: string; threadId: string } }[];
    nextPageToken?: string;
  }>(accessToken, `${isDraftList ? 'drafts' : 'messages'}?${params.toString()}`);

  const items = isDraftList
    ? (listData.drafts ?? []).map(draft => ({ id: draft.message.id, draftId: draft.id }))
    : (listData.messages ?? []).map(message => ({ id: message.id, draftId: undefined }));
  const emails: GmailEmail[] = [];
  // Keep list loading bounded while the existing sync worker is reading the same mailbox.
  for (let offset = 0; offset < items.length; offset += 5) {
    const batch = await Promise.all(items.slice(offset, offset + 5).map(async item => {
      try { return { ...await fetchMessageDetail(accessToken, item.id), ...(item.draftId ? { draftId: item.draftId } : {}) }; }
      catch (error) { if (error instanceof AppError && error.statusCode === 404) return null; throw error; }
    }));
    for (const email of batch) if (email) emails.push(email);
  }

  return { emails, nextPageToken: listData.nextPageToken };
}

/**
 * Fetches a single message's full detail.
 */
export async function fetchMessageDetail(accessToken: string, messageId: string): Promise<GmailEmail> {
  const data = await readGmailJson<GmailApiMessage>(accessToken, `messages/${encodeURIComponent(messageId)}?format=full`);

  return parseGmailMessage(data);
}

/**
 * Sends an email via Gmail API.
 */
export async function sendEmail(
  tenantId: string,
  userId: string,
  to: string | string[],
  subject: string,
  body: string,
  replyToMessageId?: string,
): Promise<{ messageId: string; threadId: string }> {
  const accessToken = await getValidAccessToken(tenantId, userId);
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  const reply = replyToMessageId ? await fetchMessageDetail(accessToken, replyToMessageId) : undefined;
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  const rawMessage = createRawMessage(recipients, subject, body, account.email, reply?.rfcMessageId);

  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage, ...(reply ? { threadId: reply.threadId } : {}) }),
    },
  );

  if (!response.ok) {
    throw new AppError(`Gmail could not send this message (${response.status}).`, 502);
  }

  const result = await response.json() as { id: string; threadId: string };
  return { messageId: result.id, threadId: result.threadId };
}

/**
 * Gets the connection status for a user's Gmail account.
 */
export async function getConnectionStatus(
  tenantId: string,
  userId: string,
): Promise<{ isConnected: boolean; email: string | null; connectedAt: string | null; lastSyncAt: string | null }> {
  const account = await prisma.emailAccount.findUnique({
    where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } },
  });

  if (!account || !account.isActive) {
    return { isConnected: false, email: null, connectedAt: null, lastSyncAt: null };
  }

  const user = await readAuthUser(userId, tenantId);
  if (!isMailboxOwner({ userId, tenantId, email: user.email }, account.email)) {
    return { isConnected: false, email: null, connectedAt: null, lastSyncAt: null };
  }

  return {
    isConnected: true,
    email: account.email,
    connectedAt: account.connectedAt.toISOString(),
    lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
  };
}

/**
 * Disconnects a Gmail account (soft-delete — sets isActive to false).
 */
export async function disconnectAccount(tenantId: string, userId: string): Promise<void> {
  await prisma.emailAccount.update({
    where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } },
    data: { isActive: false, accessToken: '', refreshToken: null, syncLeaseId: null, syncLeaseUntil: null },
  });
}

/**
 * Creates or updates a draft in Gmail.
 */
export async function saveDraft(
  tenantId: string,
  userId: string,
  to: string,
  subject: string,
  body: string,
  draftId?: string,
): Promise<{ draftId: string; messageId: string }> {
  const accessToken = await getValidAccessToken(tenantId, userId);
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  const rawMessage = createRawMessage(to, subject, body, account.email);

  const requestBody = { message: { raw: rawMessage } };

  let response: Response;

  if (draftId) {
    // Update existing draft
    response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );
  } else {
    // Create new draft
    response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );
  }

  if (!response.ok) {
    throw new AppError(`Gmail could not save the draft (${response.status}).`, 502);
  }

  const result = await response.json() as { id: string; message: { id: string } };
  return { draftId: result.id, messageId: result.message.id };
}

/**
 * Deletes a draft from Gmail.
 */
export async function deleteDraft(
  tenantId: string,
  userId: string,
  draftId: string,
): Promise<void> {
  const accessToken = await getValidAccessToken(tenantId, userId);

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new AppError(`Gmail could not delete the draft (${response.status}).`, 502);
}

/**
 * Moves messages to trash (batch delete).
 */
export async function trashEmails(
  tenantId: string,
  userId: string,
  messageIds: string[],
): Promise<{ success: boolean; count: number }> {
  const accessToken = await getValidAccessToken(tenantId, userId);

  const responses = await Promise.all(
    messageIds.map((id) =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ),
  );
  if (responses.some(response => !response.ok)) throw new AppError('Some messages could not be moved to trash. Refresh before retrying.', 502);
  return { success: true, count: messageIds.length };
}

/**
 * Archives messages (removes INBOX label).
 */
export async function archiveEmails(
  tenantId: string,
  userId: string,
  messageIds: string[],
): Promise<{ success: boolean; count: number }> {
  const accessToken = await getValidAccessToken(tenantId, userId);

  const responses = await Promise.all(
    messageIds.map((id) =>
      fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }),
    ),
  );
  if (responses.some(response => !response.ok)) throw new AppError('Some messages could not be archived. Refresh before retrying.', 502);
  return { success: true, count: messageIds.length };
}

// ─── Internal Helpers ───────────────────────────────────

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] }
export interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    mimeType?: string;
    parts?: GmailPart[];
  };
  internalDate: string;
}

function parseAddressList(value: string): string[] {
  const addresses: string[] = [];
  let current = '', quoted = false, escaped = false, angle = false;
  for (const character of value) {
    if (character === ',' && !quoted && !angle) { if (current.trim()) addresses.push(current.trim()); current = ''; continue; }
    current += character;
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && quoted) escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === '<') angle = true;
    else if (!quoted && character === '>') angle = false;
  }
  if (current.trim()) addresses.push(current.trim());
  return addresses;
}

export function parseGmailMessage(data: GmailApiMessage): GmailEmail {
  const headers = data.payload.headers;
  const getHeader = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const from = getHeader('From');
  const to = parseAddressList(getHeader('To'));
  const subject = getHeader('Subject');
  const isRead = !(data.labelIds ?? []).includes('UNREAD');

  // Extract body from parts or direct body
  const parts: GmailPart[] = [];
  const visit = (part: GmailPart) => { if (part.body?.data) parts.push(part); part.parts?.forEach(visit); };
  visit(data.payload);
  const decode = (part?: GmailPart) => part?.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf-8') : '';
  const plainText = decode(parts.find(part => part.mimeType === 'text/plain'));
  const html = decode(parts.find(part => part.mimeType === 'text/html'));
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = html || `<pre>${escape(plainText || decode(parts[0]))}</pre>`;

  return {
    id: data.id,
    threadId: data.threadId,
    from,
    to,
    subject,
    snippet: data.snippet,
    body,
    date: new Date(Number(data.internalDate)).toISOString(),
    isRead,
    labels: data.labelIds ?? [],
    cc: parseAddressList(getHeader('Cc')),
    plainText: plainText || undefined,
    rfcMessageId: getHeader('Message-ID'),
    automated: (!!getHeader('Auto-Submitted') && getHeader('Auto-Submitted').toLowerCase() !== 'no') || !!getHeader('List-Id') || /bulk|list|junk/i.test(getHeader('Precedence')),
  };
}

function createRawMessage(to: string, subject: string, body: string, from?: string, inReplyTo?: string): string {
  // Gmail API requires a valid RFC 2822 From header — without it the API
  // returns 400 and the message is never delivered.
  // Fall back to the system sender Gmail address if no explicit from is provided.
  const fromAddress = from
    ?? process.env.SMTP_FROM
    ?? (process.env.GMAIL_SYSTEM_SENDER_GMAIL_EMAIL
        ? `LeadCRM <${process.env.GMAIL_SYSTEM_SENDER_GMAIL_EMAIL}>`
        : 'LeadCRM <noreply@leadcrm.io>');
  if ([to, subject, fromAddress, inReplyTo ?? ''].some(value => /[\r\n]/.test(value))) throw new AppError('Invalid email header.', 400);

  const message = [
    `From: ${fromAddress}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(message).toString('base64url');
}

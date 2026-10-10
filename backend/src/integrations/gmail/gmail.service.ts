import prisma from '../../config/database.config';
import { refreshAccessToken, getUserInfo } from './gmail.oauth';
import { GmailEmail, GmailThread } from './gmail.types';
import { encryptToken, decryptToken } from '../../core/encryption/crypto.service';
import { AppError } from '../../shared/errors/app-error';
import { normalizeEmail } from './engagement-rules';
import { readAuthUser } from '../../core/auth/auth-user';
import { isMailboxOwner } from './mailbox-ownership';
import { authorizedMailbox, listStoredMailbox, mailboxChanged } from './mailbox-store';
import { assertStoredMessages, mailboxAddress } from './mailbox-scope';
import { assertMailboxRecipients } from './mailbox-recipient-access';
import { ingestMailboxMessages } from './mailbox-ingestion.service';
import { MailboxListOptions } from '@leadcrm/shared';
import { readGmailJson, writeGmailJson } from './gmail-read';
import type { MailboxUnreadCount } from '@leadcrm/shared';
import { countUnreadConversations } from './mailbox-conversations';



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
 * Legacy system-sender helper; the configured From must belong to that mailbox.
 * Transactional messages use the separate Brevo email service.
 */
export async function sendEmailWithToken(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ messageId: string; threadId: string }> {
  const systemSender = process.env.GMAIL_SYSTEM_SENDER_GMAIL_EMAIL?.trim();
  const from = process.env.SMTP_FROM?.trim()
    || (systemSender ? `Camxian Technologies <${systemSender}>` : '');
  const rawMessage = createRawMessage(to, subject, body, from);

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
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  return { unreadCount: await countUnreadConversations(account, scope), unreadCountUnit: 'conversations' };
}
export const fetchEmails = (tenantId: string, userId: string, options: MailboxListOptions = {}) => listStoredMailbox(tenantId, userId, options);
export async function fetchMessageDetail(accessToken: string, messageId: string): Promise<GmailEmail> {
  return parseGmailMessage(await readGmailJson<GmailApiMessage>(accessToken, 'messages/' + encodeURIComponent(messageId) + '?format=full'));
}
export async function sendEmail(tenantId: string, userId: string, to: string | string[], subject: string, body: string, replyToMessageId?: string, draftId?: string, forwardSourceMessageId?: string): Promise<{ messageId: string; threadId: string }> {
  const { account, scope, permissions } = await authorizedMailbox(tenantId, userId);
  if (replyToMessageId) await assertStoredMessages(account, scope, [replyToMessageId], true);
  if (forwardSourceMessageId) await assertStoredMessages(account, scope, [forwardSourceMessageId], true);
  const reply = replyToMessageId ? await prisma.mailboxMessage.findUnique({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: replyToMessageId } } }) : null;
  const recipients = Array.isArray(to) ? to : [to];
  if (!draftId) await assertMailboxRecipients(account, scope, permissions, recipients, reply?.threadId);
  if (!draftId && reply) assertReplySubject(subject, reply.subject);
  const savedDraft = draftId ? await saveDraft(tenantId, userId, recipients.join(', '), subject, body, draftId, { replyToMessageId, forwardSourceMessageId }) : null;
  const accessToken = await getValidAccessToken(tenantId, userId);
  const headers = reply && !savedDraft ? await verifiedReplyHeaders(accessToken, reply) : undefined;
  const raw = createRawMessage(recipients.join(', '), subject, body, account.email, headers?.rfcMessageId, undefined, headers?.rfcReferences);
  const result = await writeGmailJson<{ id: string; threadId: string }>(accessToken, savedDraft ? 'drafts/send' : 'messages/send', 'POST', savedDraft ? { id: savedDraft.draftId } : { raw, ...(reply ? { threadId: reply.threadId } : {}) });
  try {
    if (savedDraft) await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, draftId: savedDraft.draftId }, data: { labels: ['DELETED'] } });
    await ingestMailboxMessages(account, [await fetchMessageDetail(accessToken, result.id)], permissions);
    await mailboxChanged(account.id);
  } catch {
    await prisma.emailAccount.updateMany({ where: { id: account.id }, data: { syncRequestedAt: new Date() } }).catch(() => undefined);
  }
  return { messageId: result.id, threadId: result.threadId };
}
export async function getConnectionStatus(
  tenantId: string,
  userId: string,
): Promise<{ isConnected: boolean; email: string | null; connectedAt: string | null; lastSyncAt: string | null; syncError?: string | null; retryAt?: string | null }> {
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
    syncError: account.syncError ?? null, retryAt: account.syncRetryAt?.toISOString() ?? null,
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

export async function saveDraft(tenantId: string, userId: string, to: string, subject: string, body: string, draftId?: string, options: { replyToMessageId?: string; forwardSourceMessageId?: string; messageId?: string } = {}): Promise<{ draftId: string; messageId: string }> {
  const { account, scope, permissions } = await authorizedMailbox(tenantId, userId);
  const recipients = to.split(',').map(value => mailboxAddress(value)).filter((value): value is string => !!value);
  if (to.trim() && recipients.length !== to.split(',').length) throw new AppError('Enter valid recipient addresses.', 400);
  if (options.replyToMessageId) await assertStoredMessages(account, scope, [options.replyToMessageId], true);
  if (options.forwardSourceMessageId) await assertStoredMessages(account, scope, [options.forwardSourceMessageId], true);
  let sourceMessageId = options.replyToMessageId ?? options.forwardSourceMessageId;
  let reply = options.replyToMessageId ? await prisma.mailboxMessage.findUnique({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: options.replyToMessageId } } }) : null;
  if (draftId) {
    await assertDraftAccess(tenantId, userId, draftId);
    const storedDraft = await prisma.mailboxMessage.findFirst({ where: { tenantId, accountId: account.id, draftId, labels: { has: 'DRAFT' } } });
    if (storedDraft?.sourceMessageId) {
      await assertStoredMessages(account, scope, [storedDraft.sourceMessageId], true);
      sourceMessageId = storedDraft.sourceMessageId;
    }
    if (!reply) {
      const draft = await prisma.mailboxMessage.findFirst({ where: { tenantId, accountId: account.id, draftId, labels: { has: 'DRAFT' } } });
      if (draft) {
        const previous = await prisma.mailboxMessage.findFirst({ where: { tenantId, accountId: account.id, threadId: draft.threadId, NOT: { labels: { hasSome: ['DRAFT', 'SPAM', 'TRASH', 'DELETED'] } } }, orderBy: { sentAt: 'desc' } });
        if (previous) { await assertStoredMessages(account, scope, [previous.providerMessageId]); reply = previous; }
      }
    }
  }
  await assertMailboxRecipients(account, scope, permissions, recipients, reply?.threadId);
  if (reply) assertReplySubject(subject, reply.subject);
  const accessToken = await getValidAccessToken(tenantId, userId);
  const headers = reply ? await verifiedReplyHeaders(accessToken, reply) : undefined;
  const raw = createRawMessage(recipients.join(', '), subject, body, account.email, headers?.rfcMessageId, options.messageId, headers?.rfcReferences);
  const result = await writeGmailJson<{ id: string; message: { id: string; threadId: string } }>(accessToken, draftId ? 'drafts/' + encodeURIComponent(draftId) : 'drafts', draftId ? 'PUT' : 'POST', { message: { raw, ...(reply ? { threadId: reply.threadId } : {}) } });
  if (draftId) await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, draftId, providerMessageId: { not: result.message.id } }, data: { labels: ['DELETED'] } });
  const data = { threadId: result.message.threadId, from: account.email, fromAddress: mailboxAddress(account.email)!, recipients,
    recipientAddresses: recipients, subject, body, snippet: body.replace(/<[^>]*>/g, '').slice(0, 200), labels: ['DRAFT'], direction: 'outbound',
    sentAt: new Date(), draftId: result.id, crmDraft: true, rfcMessageId: options.messageId, sourceMessageId };
  await prisma.mailboxMessage.upsert({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: result.message.id } },
    create: { ...data, tenantId, accountId: account.id, providerMessageId: result.message.id }, update: data });
  await mailboxChanged(account.id);
  return { draftId: result.id, messageId: result.message.id };
}
async function assertDraftAccess(tenantId: string, userId: string, draftId: string) {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const row = await prisma.mailboxMessage.findFirst({ where: { accountId: account.id, tenantId, draftId, labels: { has: 'DRAFT' } } });
  if (!row) throw new AppError('Draft is outside your assigned CRM mailbox scope.', 404);
  await assertStoredMessages(account, scope, [row.providerMessageId]);
  if (row.sourceMessageId) await assertStoredMessages(account, scope, [row.sourceMessageId], true);
  if (await prisma.scheduledMailboxEmail.findFirst({ where: { accountId: account.id, draftId, status: { in: ['pending', 'claimed', 'sending', 'uncertain', 'sent'] } } })) throw new AppError('This draft belongs to a scheduled email.', 409);
  return account;
}
export async function deleteDraft(tenantId: string, userId: string, draftId: string): Promise<void> {
  const account = await assertDraftAccess(tenantId, userId, draftId);
  await writeGmailJson(await getValidAccessToken(tenantId, userId), 'drafts/' + encodeURIComponent(draftId), 'DELETE');
  await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, draftId }, data: { labels: ['DELETED'] } });
  await mailboxChanged(account.id);
}
async function modifyEmails(tenantId: string, userId: string, messageIds: string[], trash: boolean) {
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  await assertStoredMessages(account, scope, messageIds, true);
  const token = await getValidAccessToken(tenantId, userId);
  for (const id of messageIds) {
    await writeGmailJson(token, 'messages/' + encodeURIComponent(id) + (trash ? '/trash' : '/modify'), 'POST', trash ? undefined : { removeLabelIds: ['INBOX'] });
    const row = await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: id } } });
    await prisma.mailboxMessage.update({ where: { id: row.id }, data: { labels: trash ? [...new Set([...row.labels, 'TRASH'])] : row.labels.filter(label => label !== 'INBOX') } });
  }
  await mailboxChanged(account.id);
  return { success: true, count: messageIds.length };
}
export const trashEmails = (tenantId: string, userId: string, ids: string[]) => modifyEmails(tenantId, userId, ids, true);
export const archiveEmails = (tenantId: string, userId: string, ids: string[]) => modifyEmails(tenantId, userId, ids, false);


interface GmailPart { filename?: string; mimeType?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] }
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
  const headers = data.payload?.headers ?? [];
  const getHeader = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const from = getHeader('From');
  const to = parseAddressList(getHeader('To'));
  const subject = getHeader('Subject');
  const isRead = !(data.labelIds ?? []).includes('UNREAD');

  // Extract body from parts or direct body
  const parts: GmailPart[] = [];
  const visit = (part: GmailPart) => { parts.push(part); part.parts?.forEach(visit); };
  visit(data.payload);
  const decode = (part?: GmailPart) => part?.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf-8') : '';
  const plainText = decode(parts.find(part => part.mimeType === 'text/plain'));
  const html = decode(parts.find(part => part.mimeType === 'text/html'));
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = html || `<pre>${escape(plainText || decode(parts.find(part => part.body?.data)))}</pre>`;

  return {
    id: data.id,
    threadId: data.threadId,
    from,
    to,
    subject,
    snippet: data.snippet,
    body,
    date: new Date(Number(data.internalDate) || 0).toISOString(),
    isRead,
    labels: data.labelIds ?? [],
    cc: parseAddressList(getHeader('Cc')),
    // Invalid or multi-address Reply-To headers are not used as delivery targets.
    replyToAddress: parseAddressList(getHeader('Reply-To')).length === 1 ? mailboxAddress(getHeader('Reply-To')) ?? null : null,
    plainText: plainText || undefined,
    rfcMessageId: getHeader('Message-ID'),
    rfcInReplyTo: /^<[^\s<>]+>$/.test(getHeader('In-Reply-To')) && getHeader('In-Reply-To').length <= 500 ? getHeader('In-Reply-To') : null,
    rfcReferences: /[\r\n]/.test(getHeader('References')) ? [] : [...new Set((getHeader('References').match(/<[^\s<>]+>/g) ?? []).filter(id => id.length <= 500))],
    attachments: parts.filter(part => part.filename && part.body?.attachmentId).map(part => ({ id: part.body!.attachmentId!, filename: part.filename!, mimeType: part.mimeType ?? 'application/octet-stream', size: part.body?.size ?? 0 })),
    automated: /^(?:mailer-daemon|postmaster)@/i.test(normalizeEmail(from)) || getHeader('Return-Path').trim() === '<>' || parts.some(part => /message\/(?:delivery-status|disposition-notification)/i.test(part.mimeType ?? '')) || /multipart\/report/i.test(data.payload.mimeType ?? '') || (!!getHeader('Auto-Submitted') && getHeader('Auto-Submitted').toLowerCase() !== 'no') || !!getHeader('List-Id') || /bulk|list|junk/i.test(getHeader('Precedence')),
  };
}

async function verifiedReplyHeaders(accessToken: string, source: { providerMessageId: string; threadId: string; rfcMessageId: string | null; rfcReferences: string[] }) {
  let rfcMessageId = source.rfcMessageId, rfcReferences = source.rfcReferences;
  if (!rfcMessageId) {
    // Legacy rows may lack RFC headers. Recover only this already-authorized
    // source's metadata, never infer relationships from its subject/participants.
    const message = await readGmailJson<GmailApiMessage>(accessToken, `messages/${encodeURIComponent(source.providerMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
    if (message.threadId !== source.threadId) throw new AppError('Conversation changed. Refresh before replying.', 409);
    const parsed = parseGmailMessage(message);
    rfcMessageId = parsed.rfcMessageId ?? null; rfcReferences = parsed.rfcReferences ?? [];
  }
  if (!rfcMessageId || !/^<[^\s<>]+>$/.test(rfcMessageId)) throw new AppError('The original email reply headers are unavailable. Sync your mailbox before replying.', 409);
  return { rfcMessageId, rfcReferences };
}

function assertReplySubject(subject: string, original: string) {
  const base = (value: string) => value.trim().replace(/^(?:re:\s*)+/i, '');
  if (base(subject) !== base(original)) throw new AppError('Keep the conversation subject when replying. Use Compose for a new subject.', 400, 'MAILBOX_REPLY_SUBJECT_CHANGED');
}

function createRawMessage(to: string, subject: string, body: string, from: string, inReplyTo?: string, messageId?: string, references: string[] = []): string {
  // Inbox sends and drafts pass their connected mailbox explicitly.
  const fromAddress = from.trim();
  if (!fromAddress) throw new AppError('Gmail sender is not configured.', 503);
  if ([to, subject, fromAddress, inReplyTo ?? '', messageId ?? ''].some(value => /[\r\n]/.test(value))) throw new AppError('Invalid email header.', 400);
  if (!mailboxAddress(fromAddress)) throw new AppError('Invalid Gmail sender address.', 400);

  const message = [
    `From: ${fromAddress}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${[...new Set([...references.filter(id => /^<[^\s<>]{1,498}>$/.test(id)), inReplyTo])].join('\r\n ')}`] : []),
    ...(messageId ? ['Message-ID: ' + messageId] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(message).toString('base64url');
}

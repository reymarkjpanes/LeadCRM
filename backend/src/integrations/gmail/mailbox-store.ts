import { MailboxListSchema, MailboxListOptions } from '@leadcrm/shared';
import { MailboxMessage, Prisma } from '@prisma/client';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { mailboxPermissions } from './mailbox-sync.service';
import { resolveMailboxScope, scopedMessagesWhere } from './mailbox-scope';
import type { GmailEmail } from './gmail.types';
import type { MailboxAttachment } from '@leadcrm/shared';
import { countUnreadConversations, listMailboxConversations } from './mailbox-conversations';

export async function authorizedMailbox(tenantId: string, userId: string) {
  const permissions = await mailboxPermissions(tenantId, userId);
  const account = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account?.isActive) throw new AppError('Connect your work Gmail account first.', 409);
  const scope = await resolveMailboxScope(account, permissions);
  return { account, permissions, scope };
}

export function storedEmail(row: MailboxMessage): GmailEmail {
  return { id: row.providerMessageId, threadId: row.threadId, from: row.from, to: row.recipients,
    cc: row.ccRecipients, replyToAddress: row.replyToAddress,
    subject: row.subject, body: row.body, snippet: row.snippet, date: row.sentAt.toISOString(),
    labels: row.labels, isRead: !row.labels.includes('UNREAD'), draftId: row.draftId ?? undefined,
    direction: row.direction as GmailEmail['direction'], leadId: row.leadId, contactId: row.contactId,
    dealId: row.dealId, needsDealAssociation: row.needsDealAssociation, rfcMessageId: row.rfcMessageId ?? undefined,
    rfcInReplyTo: row.rfcInReplyTo, rfcReferences: row.rfcReferences, attachments: Array.isArray(row.attachments) ? row.attachments as unknown as MailboxAttachment[] : [] };
}

export async function listStoredMailbox(tenantId: string, userId: string, input: MailboxListOptions = {}) {
  const options = MailboxListSchema.parse(input);
  const { account, scope } = await authorizedMailbox(tenantId, userId);
  const base = scopedMessagesWhere(account, scope);
  const unreadCount = await countUnreadConversations(account, scope);
  if (!['drafts', 'scheduled'].includes(options.filter)) return { ...await listMailboxConversations(account, scope, options), unreadCount, unreadCountUnit: 'conversations' as const, scopeHash: scope.hash };
  const offset = options.pageToken ? Number(options.pageToken) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new AppError('Invalid mailbox page.', 400);
  if (options.filter === 'scheduled') {
    const visibleDrafts = await prisma.mailboxMessage.findMany({ where: base, select: { draftId: true } });
    const where: Prisma.ScheduledMailboxEmailWhereInput = { tenantId, accountId: account.id, createdById: userId, status: { notIn: ['sent', 'cancelled'] },
      draftId: { in: visibleDrafts.flatMap(row => row.draftId ?? []) },
      ...(options.query ? { OR: [{ subject: { contains: options.query, mode: 'insensitive' } }, { recipients: { has: options.query.toLowerCase() } }] } : {}) };
    const rows = await prisma.scheduledMailboxEmail.findMany({ where, orderBy: [{ scheduledAt: options.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }], skip: offset, take: options.maxResults + 1 });
    return { emails: rows.slice(0, options.maxResults).map(row => ({ id: row.id, threadId: '', from: row.recipients.join(', '), to: row.recipients,
      subject: row.subject, body: '', snippet: row.lastError ?? 'Scheduled email', date: row.scheduledAt.toISOString(),
      isRead: true, labels: [], scheduledStatus: row.status, scheduleError: row.lastError })),
      nextPageToken: rows.length > options.maxResults ? String(offset + options.maxResults) : undefined, unreadCount, unreadCountUnit: 'conversations' as const, scopeHash: scope.hash };
  }
  const filters: Prisma.MailboxMessageWhereInput[] = [base,
    options.filter === 'drafts' ? { labels: { has: 'DRAFT' } } : { NOT: { labels: { has: 'DRAFT' } } }];
  if (options.filter === 'drafts') {
    const queued = await prisma.scheduledMailboxEmail.findMany({ where: { tenantId, accountId: account.id, status: { in: ['pending', 'claimed', 'sending', 'uncertain', 'sent'] } }, select: { draftId: true } });
    filters.push({ OR: [{ draftId: null }, { draftId: { notIn: queued.map(row => row.draftId) } }] });
  }
  if (options.filter === 'unread') filters.push({ labels: { has: 'UNREAD' } });
  if (options.filter === 'sent') filters.push({ direction: 'outbound', labels: { has: 'SENT' } });
  if (options.query) filters.push({ OR: ['subject', 'snippet', 'from', 'body'].map(field => ({ [field]: { contains: options.query, mode: 'insensitive' } })) });
  const where = { AND: filters };
  const orderBy: Prisma.MailboxMessageOrderByWithRelationInput[] = [{ sentAt: options.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }];
  let rows: MailboxMessage[];
  if (options.sort === 'unread') {
    const unreadWhere = { AND: [where, { labels: { has: 'UNREAD' } }] };
    const unread = await prisma.mailboxMessage.count({ where: unreadWhere });
    rows = offset < unread ? await prisma.mailboxMessage.findMany({ where: unreadWhere, orderBy, skip: offset, take: options.maxResults + 1 }) : [];
    if (rows.length < options.maxResults + 1) rows.push(...await prisma.mailboxMessage.findMany({ where: { AND: [where, { NOT: { labels: { has: 'UNREAD' } } }] }, orderBy, skip: Math.max(0, offset - unread), take: options.maxResults + 1 - rows.length }));
  } else rows = await prisma.mailboxMessage.findMany({ where, orderBy, skip: offset, take: options.maxResults + 1 });
  return { emails: rows.slice(0, options.maxResults).map(storedEmail), nextPageToken: rows.length > options.maxResults ? String(offset + options.maxResults) : undefined, unreadCount, unreadCountUnit: 'conversations' as const, scopeHash: scope.hash };
}

export async function mailboxChanged(accountId: string) {
  await prisma.emailAccount.updateMany({ where: { id: accountId }, data: { mailboxVersion: { increment: 1 } } });
}

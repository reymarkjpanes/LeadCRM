import { createHash } from 'node:crypto';
import { EmailAccount, Prisma } from '@prisma/client';
import { MailboxListSchema } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { mailboxAddress, MailboxScope, scopedMessagesSql } from './mailbox-scope';
import type { GmailEmail } from './gmail.types';
import { tenantContext } from '../../core/tenant/tenant-context';

type Options = ReturnType<typeof MailboxListSchema.parse>;
type Summary = {
  conversationId: string; conversationKind: 'person' | 'group'; externalAddresses: string[];
  threadId: string; date: Date; unread: boolean; messageCount: number; authors: string[]; presentations: string[];
  id: string; from: string; to: string[]; cc: string[]; subject: string; snippet: string;
  labels: string[]; direction: GmailEmail['direction']; replyToAddress: string | null;
};

function incomingUnread(account: EmailAccount) {
  const mailbox = mailboxAddress(account.email) ?? '';
  return Prisma.sql`'UNREAD' = ANY(m.labels) AND m."fromAddress" <> ${mailbox} AND ${mailbox} = ANY(m."recipientAddresses")`;
}

// Explicit tenant/account predicates stay inside every raw query.
export function mailboxReadQuery<T>(account: EmailAccount, sql: Prisma.Sql): Promise<T> {
  const tenant = tenantContext.getStore()?.tenantId;
  if (tenant && tenant !== account.tenantId) throw new AppError('Mailbox is outside this workspace.', 403);
  return tenantContext.exit(async () => await prisma.$queryRaw<T>(sql));
}

/** Normalized columns contain validated exact addresses. Derive identities only
 * after current message authorization. A provider thread with several external
 * participants is a separate group, including its later one-recipient replies.
 * Private threads never join that group merely because a participant matches. */
export function correspondentCte(account: EmailAccount, scope: MailboxScope, query?: string): Prisma.Sql {
  const mailbox = mailboxAddress(account.email) ?? '';
  const search = query ? Prisma.sql`(
    strpos(lower(m.subject), lower(${query})) > 0 OR strpos(lower(m.snippet), lower(${query})) > 0
    OR strpos(lower(m."from"), lower(${query})) > 0 OR strpos(lower(m.body), lower(${query})) > 0
    OR strpos(lower(array_to_string(m.recipients || m."ccRecipients", ' ')), lower(${query})) > 0)` : Prisma.sql`TRUE`;
  return Prisma.sql`authorized AS MATERIALIZED (
    SELECT m.id, m."providerMessageId", m."threadId", m."fromAddress", m."recipientAddresses", m."from", m.recipients,
      m."ccRecipients", m.subject, m.snippet, m."sentAt", m.labels, m.direction, m."replyToAddress", m."leadId", m."contactId",
      (${incomingUnread(account)}) AS unread, (${search}) AS matched
    FROM "MailboxMessage" m WHERE ${scopedMessagesSql(account, scope)} AND NOT ('DRAFT' = ANY(m.labels))
  ), thread_people AS (
    SELECT a."threadId", array_agg(DISTINCT address ORDER BY address) AS addresses
    FROM authorized a CROSS JOIN LATERAL unnest(ARRAY[a."fromAddress"] || a."recipientAddresses") address
    WHERE address <> ${mailbox} AND address <> '' GROUP BY a."threadId"
  ), eligible AS (
    SELECT a.*, COALESCE(p.addresses, ARRAY[]::text[]) AS "externalAddresses",
      CASE WHEN cardinality(p.addresses) = 1 THEN 'person' ELSE 'group' END AS "conversationKind",
      'c_' || md5(jsonb_build_array(${account.tenantId}::text, ${account.id}::text,
        CASE WHEN cardinality(p.addresses) = 1 THEN 'person' ELSE 'group:' || a."threadId" END,
        CASE WHEN cardinality(p.addresses) = 1 THEN p.addresses[1] ELSE '' END)::text) AS "conversationId"
    FROM authorized a LEFT JOIN thread_people p ON p."threadId" = a."threadId"
  )`;
}

export function conversationContext(account: EmailAccount, scope: MailboxScope, purpose: unknown) {
  return createHash('sha256').update(JSON.stringify(['correspondents-v1', account.tenantId, account.id, account.mailboxVersion, scope.hash, purpose])).digest('hex');
}

export async function countUnreadConversations(account: EmailAccount, scope: MailboxScope) {
  const [row] = await mailboxReadQuery<{ count: number }[]>(account, Prisma.sql`
    WITH ${correspondentCte(account, scope)} SELECT count(DISTINCT "conversationId")::int AS count FROM eligible WHERE unread`);
  return row.count;
}

/** Aggregate all authorized messages before filtering/search/pagination.
 * Mailbox revisions invalidate old cursors when activity or read state changes. */
export async function listMailboxConversations(account: EmailAccount, scope: MailboxScope, options: Options) {
  const context = conversationContext(account, scope, [options.filter, options.sort, options.query ?? '']);
  let cursor: { context: string; conversationId: string; date: string; unread: boolean } | undefined;
  if (options.pageToken) {
    try {
      cursor = JSON.parse(Buffer.from(options.pageToken, 'base64url').toString('utf8'));
      if (!cursor || !/^c_[a-f0-9]{32}$/.test(cursor.conversationId) || typeof cursor.unread !== 'boolean' || typeof cursor.date !== 'string' || !Number.isFinite(Date.parse(cursor.date))) throw new Error();
    } catch { throw new AppError('Invalid conversation page. Refresh your Inbox.', 400); }
    if (cursor.context !== context) throw new AppError('Mailbox page changed. Reloading the first page is required.', 400, 'MAILBOX_PAGE_CHANGED');
  }
  const ascending = options.sort === 'oldest';
  const order = ascending ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const cursorDate = cursor ? Prisma.sql`(${cursor.date}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`NULL`;
  const dateCursor = cursor ? ascending ? Prisma.sql`s.date > ${cursorDate}` : Prisma.sql`s.date < ${cursorDate}` : Prisma.sql`TRUE`;
  const activityCursor = cursor ? Prisma.sql`(${dateCursor} OR (s.date = ${cursorDate} AND s."conversationId" > ${cursor.conversationId}))` : Prisma.sql`TRUE`;
  const after = cursor && options.sort === 'unread'
    ? Prisma.sql`((s.unread = ${cursor.unread} AND ${activityCursor}) OR (${cursor.unread} AND NOT s.unread))` : activityCursor;
  const filter = options.filter === 'unread' ? Prisma.sql`s.unread` : options.filter === 'sent' ? Prisma.sql`s.sent` : Prisma.sql`TRUE`;
  const rows = await mailboxReadQuery<Summary[]>(account, Prisma.sql`
    WITH ${correspondentCte(account, scope, options.query)}, summaries AS (
      SELECT "conversationId", max("sentAt") AS date, count(*)::int AS "messageCount", bool_or(unread) AS unread,
        bool_or(direction = 'outbound' AND 'SENT' = ANY(labels)) AS sent, bool_or(matched) AS matched,
        array_agg(DISTINCT "from" ORDER BY "from") AS authors
      FROM eligible GROUP BY "conversationId"
    ), people AS (
      SELECT e."conversationId", array_agg(DISTINCT value ORDER BY value) AS presentations
      FROM eligible e CROSS JOIN LATERAL unnest(ARRAY[e."from"] || e.recipients || e."ccRecipients") value
      GROUP BY e."conversationId"
    ), page AS (
      SELECT s.* FROM summaries s WHERE ${filter} AND s.matched AND ${after}
      ORDER BY ${options.sort === 'unread' ? Prisma.sql`s.unread DESC,` : Prisma.empty} s.date ${order}, s."conversationId" ASC
      LIMIT ${options.maxResults + 1}
    ), latest AS (
      SELECT DISTINCT ON (e."conversationId") e.* FROM eligible e JOIN page p ON p."conversationId" = e."conversationId"
      ORDER BY e."conversationId", e."sentAt" DESC, e."providerMessageId" DESC
    )
    SELECT p.*, people.presentations, latest."providerMessageId" AS id, latest."threadId", latest."from", latest.recipients AS "to", latest."ccRecipients" AS cc,
      latest.subject, latest.snippet, latest.labels, latest.direction, latest."replyToAddress", latest."conversationKind", latest."externalAddresses"
    FROM page p JOIN people ON people."conversationId" = p."conversationId" JOIN latest ON latest."conversationId" = p."conversationId"
    ORDER BY ${options.sort === 'unread' ? Prisma.sql`p.unread DESC,` : Prisma.empty} p.date ${order}, p."conversationId" ASC`);
  const visible = rows.slice(0, options.maxResults);
  const mailbox = mailboxAddress(account.email);
  const emails: GmailEmail[] = visible.map(row => {
    const names = new Map(row.externalAddresses.map(address => [address, address.split('@')[0]]));
    for (const value of row.presentations) {
      const address = mailboxAddress(value);
      if (address && names.has(address) && value.includes('<')) names.set(address, (value.match(/^(.+?)\s*<[^<>]+>$/)?.[1] ?? address).replace(/^"|"$/g, '').trim());
    }
    if (row.authors.some(author => mailboxAddress(author) === mailbox)) names.set(mailbox ?? '', 'You');
    return { id: row.id, threadId: row.threadId, conversationId: row.conversationId, conversationKind: row.conversationKind,
      correspondentAddresses: row.externalAddresses, from: row.from, to: row.to, cc: row.cc, subject: row.subject, snippet: row.snippet,
      body: '', date: row.date.toISOString(), isRead: !row.unread, labels: row.labels, direction: row.direction,
      replyToAddress: row.replyToAddress, messageCount: row.messageCount, participants: [...names.values()] };
  });
  const last = visible[visible.length - 1];
  return { emails, nextPageToken: rows.length > options.maxResults && last ? Buffer.from(JSON.stringify({ context, conversationId: last.conversationId, date: last.date.toISOString(), unread: last.unread })).toString('base64url') : undefined };
}

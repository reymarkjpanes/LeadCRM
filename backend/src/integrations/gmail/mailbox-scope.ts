import { createHash } from 'node:crypto';
import { Prisma, EmailAccount } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { normalizeEmail } from './engagement-rules';
import type { MailboxPermissions } from './mailbox-ingestion.service';
import type { GmailEmail } from './gmail.types';

export const FIXED_MAILBOX_SENDERS = ['reymarkjpanes@12066156.brevosend.com', 'info@camxian.com'];
export function mailboxAddress(value: string): string | undefined {
  if (/[\r\n]/.test(value)) return;
  const address = normalizeEmail(value);
  // Restrict provider query tokens as well as validating the actual address.
  return z.string().email().max(254).safeParse(address).success && !/[\s"(){}<>\\:]/.test(address) ? address : undefined;
}
export interface MailboxScope {
  addresses: string[];
  leadIds: string[];
  contactIds: string[];
  fixedThreadIds: string[];
  threadRecipients: Record<string, string[]>;
  draftSourceIds: string[];
  hash: string;
}

/** Always read canonical assignments; role-wide record access is not mailbox access. */
export async function resolveMailboxScope(account: EmailAccount, permissions: MailboxPermissions): Promise<MailboxScope> {
  const where = { tenantId: account.tenantId, assignedUserId: account.userId, isArchived: false, deletedAt: null };
  const [assignedLeads, assignedContacts] = await Promise.all([
    permissions.leadsView ? prisma.lead.findMany({ where: { ...where, convertedAt: null }, select: { id: true, email: true } }) : [],
    permissions.contactsView ? prisma.contact.findMany({ where, select: { id: true, email: true } }) : [],
  ]);
  const leads = assignedLeads.filter(row => mailboxAddress(row.email ?? ''));
  const contacts = assignedContacts.filter(row => mailboxAddress(row.email ?? ''));
  const addresses = [...new Set([...leads, ...contacts].flatMap(row => mailboxAddress(row.email ?? '') ?? []))].sort();
  const fixed = await prisma.mailboxMessage.findMany({ where: { tenantId: account.tenantId, accountId: account.id,
    fromAddress: { in: FIXED_MAILBOX_SENDERS }, NOT: { labels: { hasSome: ['SPAM', 'TRASH', 'DELETED', 'DRAFT'] } } }, distinct: ['threadId'], select: { threadId: true } });
  const leadIds = leads.map(row => row.id), contactIds = contacts.map(row => row.id);
  const linked = await prisma.mailboxMessage.findMany({ where: { tenantId: account.tenantId, accountId: account.id,
    OR: [{ leadId: { in: leadIds } }, { contactId: { in: contactIds } }], NOT: { labels: { hasSome: ['SPAM', 'TRASH', 'DELETED', 'DRAFT'] } } },
    select: { threadId: true, fromAddress: true, recipientAddresses: true } });
  const threadRecipients: Record<string, string[]> = {};
  for (const row of linked) {
    const participants = row.fromAddress === mailboxAddress(account.email) ? row.recipientAddresses : [row.fromAddress];
    // Historical CRM linkage alone cannot authorize another email address.
    const permitted = participants.flatMap(value => mailboxAddress(value) ?? []).filter(address => addresses.includes(address));
    if (permitted.length) threadRecipients[row.threadId] = [...new Set([...(threadRecipients[row.threadId] ?? []), ...permitted])];
  }
  const hash = createHash('sha256').update(JSON.stringify([addresses, [...leadIds].sort(), [...contactIds].sort()])).digest('hex');
  const scope: MailboxScope = { addresses, leadIds, contactIds, fixedThreadIds: fixed.map(row => row.threadId), threadRecipients, draftSourceIds: [], hash };
  const drafts = await prisma.mailboxMessage.findMany({ where: { tenantId: account.tenantId, accountId: account.id, draftId: { not: null }, sourceMessageId: { not: null } }, select: { sourceMessageId: true }, distinct: ['sourceMessageId'] });
  if (drafts.length) {
    const sources = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { providerMessageId: { in: drafts.flatMap(row => row.sourceMessageId ?? []) }, NOT: { labels: { has: 'DRAFT' } } }] }, select: { providerMessageId: true } });
    scope.draftSourceIds = sources.map(row => row.providerMessageId);
  }
  return scope;
}

export function messageInScope(email: Pick<GmailEmail, 'from' | 'to' | 'cc' | 'threadId'> & { labels?: string[] }, mailbox: string, scope: MailboxScope): boolean {
  const from = mailboxAddress(email.from);
  if (!from) return false;
  if (email.labels?.includes('DRAFT') && from !== mailboxAddress(mailbox)) return false;
  if (from !== mailboxAddress(mailbox)) return FIXED_MAILBOX_SENDERS.includes(from) || scope.addresses.includes(from);
  const recipients = [...email.to, ...(email.cc ?? [])].flatMap(value => mailboxAddress(value) ?? []);
  return recipients.some(address => scope.addresses.includes(address)) ||
    recipients.some(address => scope.threadRecipients[email.threadId]?.includes(address)) ||
    scope.fixedThreadIds.includes(email.threadId) && recipients.some(address => FIXED_MAILBOX_SENDERS.includes(address));
}

/** Normalized persisted columns are backfilled by the forward migration. */
export function scopedMessagesWhere(account: EmailAccount, scope: MailboxScope): Prisma.MailboxMessageWhereInput {
  return { tenantId: account.tenantId, accountId: account.id, account: { isActive: true },
    NOT: { labels: { hasSome: ['SPAM', 'TRASH', 'DELETED'] } },
    AND: [{ OR: [{ NOT: { labels: { has: 'DRAFT' } } }, { sourceMessageId: null }, { sourceMessageId: { in: scope.draftSourceIds } }] }],
    OR: [
      { fromAddress: { in: [...FIXED_MAILBOX_SENDERS, ...scope.addresses], not: mailboxAddress(account.email) }, NOT: { labels: { has: 'DRAFT' } } },
      { fromAddress: mailboxAddress(account.email), OR: [
        { recipientAddresses: { hasSome: scope.addresses } },
        ...Object.entries(scope.threadRecipients).map(([threadId, addresses]) => ({ threadId, recipientAddresses: { hasSome: addresses } })),
        { threadId: { in: scope.fixedThreadIds }, recipientAddresses: { hasSome: FIXED_MAILBOX_SENDERS } },
        { labels: { has: 'DRAFT' }, crmDraft: true, recipientAddresses: { isEmpty: true } },
      ] },
    ] };
}

/** SQL counterpart of scopedMessagesWhere for aggregate conversation queries.
 * Keep the two predicates aligned; integration tests exercise both paths. */
export function scopedMessagesSql(account: EmailAccount, scope: MailboxScope): Prisma.Sql {
  const array = (values: string[]) => values.length ? Prisma.sql`ARRAY[${Prisma.join(values)}]::text[]` : Prisma.sql`ARRAY[]::text[]`;
  const mailbox = mailboxAddress(account.email) ?? '';
  const continuity = Object.entries(scope.threadRecipients).map(([threadId, addresses]) =>
    Prisma.sql`(m."threadId" = ${threadId} AND m."recipientAddresses" && ${array(addresses)})`);
  return Prisma.sql`m."tenantId" = ${account.tenantId} AND m."accountId" = ${account.id}
    AND EXISTS (SELECT 1 FROM "EmailAccount" a WHERE a.id = m."accountId" AND a."tenantId" = m."tenantId" AND a."userId" = ${account.userId} AND a."isActive")
    AND NOT (m.labels && ARRAY['SPAM', 'TRASH', 'DELETED']::text[])
    AND (NOT ('DRAFT' = ANY(m.labels)) OR m."sourceMessageId" IS NULL OR m."sourceMessageId" = ANY(${array(scope.draftSourceIds)}))
    AND ((m."fromAddress" = ANY(${array([...FIXED_MAILBOX_SENDERS, ...scope.addresses])}) AND m."fromAddress" <> ${mailbox} AND NOT ('DRAFT' = ANY(m.labels)))
      OR (m."fromAddress" = ${mailbox} AND (m."recipientAddresses" && ${array(scope.addresses)}
        ${continuity.length ? Prisma.sql`OR ${Prisma.join(continuity, ' OR ')}` : Prisma.empty}
        OR (m."threadId" = ANY(${array(scope.fixedThreadIds)}) AND m."recipientAddresses" && ${array(FIXED_MAILBOX_SENDERS)})
        OR ('DRAFT' = ANY(m.labels) AND m."crmDraft" AND cardinality(m."recipientAddresses") = 0))))`;
}

/** One bounded query per chunk, never an unscoped fallback. Returned pages are
 * persisted and globally sorted by sentAt by the Inbox API. */
export function mailboxProviderQueries(scope: MailboxScope): string[] {
  const terms = [...new Set([...FIXED_MAILBOX_SENDERS, ...scope.addresses])].map(address => `from:${address}`);
  for (const address of new Set([...scope.addresses, ...Object.values(scope.threadRecipients).flat()])) terms.push(`to:${address}`, `cc:${address}`);
  for (const address of FIXED_MAILBOX_SENDERS) terms.push(`to:${address}`);
  const queries: string[] = [];
  let chunk: string[] = [], length = 0;
  for (const term of terms) {
    if (chunk.length >= 40 || length + term.length > 3000) { queries.push(`-in:spam -in:trash {${chunk.join(' ')}}`); chunk = []; length = 0; }
    chunk.push(term); length += term.length + 1;
  }
  if (chunk.length) queries.push(`-in:spam -in:trash {${chunk.join(' ')}}`);
  return queries;
}

export async function assertStoredMessages(account: EmailAccount, scope: MailboxScope, ids: string[], excludeDrafts = false) {
  const found = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { providerMessageId: { in: ids } }, ...(excludeDrafts ? [{ NOT: { labels: { has: 'DRAFT' } } }] : [])] }, select: { providerMessageId: true } });
  if (new Set(found.map(row => row.providerMessageId)).size !== new Set(ids).size) throw new AppError('Email is outside your assigned CRM mailbox scope.', 404);
}

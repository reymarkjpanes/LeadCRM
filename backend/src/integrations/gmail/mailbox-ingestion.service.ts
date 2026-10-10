import { FIXED_MAILBOX_SENDERS, mailboxAddress, messageInScope, resolveMailboxScope } from './mailbox-scope';
import { EmailAccount, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeCrmStatus } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { salesTransaction } from '../../modules/crm/leads/lead-automation.service';
import { CustomerLink, changeCustomerStatus, customerDealWhere } from '../../modules/crm/engagement.service';
import { engagementStatus, engagementReason, normalizeEmail, ENGAGEMENT_RULE_VERSION, DAY_MS } from './engagement-rules';
import { GmailEmail } from './gmail.types';
import { fireLeadStatusChanged, fireContactStatusChanged } from '../../modules/automation/triggers/triggers.service';

export interface MailboxPermissions { leadsView: boolean; contactsView: boolean; leadsEdit: boolean; contactsEdit: boolean; dealsEdit: boolean; dealsView: boolean }
type Tx = Prisma.TransactionClient;

async function matchCustomer(tx: Tx, tenantId: string, userId: string, email: string, permissions: MailboxPermissions): Promise<CustomerLink | undefined> {
  // contains narrows legacy whitespace data; equality after normalization is mandatory.
  const where = { tenantId, assignedUserId: userId, isArchived: false, deletedAt: null, email: { contains: email, mode: 'insensitive' as const } };
  const leads = permissions.leadsView ? (await tx.lead.findMany({ where })).filter(row => normalizeEmail(row.email ?? '') === email) : [];
  const contacts = permissions.contactsView ? (await tx.contact.findMany({ where })).filter(row => normalizeEmail(row.email ?? '') === email) : [];
  const convertedContacts = permissions.contactsView ? await tx.contact.findMany({ where: { tenantId, assignedUserId: userId, isArchived: false, deletedAt: null,
    id: { in: leads.filter(lead => lead.convertedAt && lead.contactId).map(lead => lead.contactId!) } } }) : [];
  for (const contact of convertedContacts) if (!contacts.some(row => row.id === contact.id)) contacts.push(contact);
  const activeLeads = leads.filter(lead => !lead.convertedAt && (!lead.contactId || !contacts.some(contact => contact.id === lead.contactId)));
  if (activeLeads.length + contacts.length !== 1) return;
  return activeLeads[0] ? { leadId: activeLeads[0].id } : { contactId: contacts[0].id };
}

async function historyWhere(tx: Tx, tenantId: string, link: CustomerLink): Promise<Prisma.MailboxMessageWhereInput> {
  if (link.leadId) return { tenantId, leadId: link.leadId };
  const sources = await tx.lead.findMany({ where: { tenantId, contactId: link.contactId, convertedAt: { not: null } }, select: { id: true } });
  return { tenantId, OR: [{ contactId: link.contactId }, { leadId: { in: sources.map(row => row.id) } }] };
}

/** Rebuild from verified provider messages, never the old wording-based classification. */
async function evaluateCustomer(tx: Tx, account: EmailAccount, link: CustomerLink, now: Date, immediateReply = false) {
  const tenantId = account.tenantId;
  const customer = link.leadId
    ? await tx.lead.findFirst({ where: { tenantId, assignedUserId: account.userId, id: link.leadId, isArchived: false, deletedAt: null, convertedAt: null } })
    : await tx.contact.findFirst({ where: { tenantId, assignedUserId: account.userId, id: link.contactId, isArchived: false, deletedAt: null } });
  if (!customer) return;
  const where = await historyWhere(tx, tenantId, link);
  const verified = { ...where, engagementRuleVersion: ENGAGEMENT_RULE_VERSION, sentAt: { lte: now } };
  const inbound = await tx.mailboxMessage.findFirst({ where: { ...verified, direction: 'inbound', meaningful: true }, orderBy: { sentAt: 'desc' } });
  const outbound = !inbound ? await tx.mailboxMessage.findFirst({ where: { ...verified, direction: 'outbound' }, orderBy: { sentAt: 'asc' } }) : null;
  const data = { lastCustomerReplyAt: inbound?.sentAt ?? null, firstUnansweredOutboundAt: outbound?.sentAt ?? null };
  const pending = await tx.mailboxMessage.findFirst({ where: { ...where, engagementRuleVersion: { lt: ENGAGEMENT_RULE_VERSION } }, select: { id: true } });
  const stale = await tx.mailboxMessage.findFirst({ where: { ...where, account: { OR: [
    { isActive: false }, { lastSyncAt: null }, { lastSyncAt: { lt: new Date(+now - DAY_MS) } }, { syncCursor: null },
    { syncPageToken: { not: null } }, { syncBaselineHistoryId: { not: null } }, { syncError: { not: null } },
  ] } }, select: { id: true } });
  // A newly observed reply can prove Hot even while older history is incomplete.
  const status = engagementStatus({ ...data, status: customer.status }, now);
  const canEvaluate = (!pending && !stale) || (immediateReply && status === 'Hot');
  const timestamps = { ...data, ...(canEvaluate ? { engagementEvaluatedAt: now } : {}) };
  if (link.leadId) await tx.lead.update({ where: { tenantId, id: link.leadId }, data: timestamps });
  else await tx.contact.update({ where: { tenantId, id: link.contactId }, data: timestamps });
  if (!canEvaluate || !status || normalizeCrmStatus(customer.status) === status) return;
  return changeCustomerStatus(tx, tenantId, account.userId, link, status, engagementReason({ ...data, status }), now);
}

async function emitStatus(account: EmailAccount, link: CustomerLink, change: Awaited<ReturnType<typeof changeCustomerStatus>>) {
  if (!change) return;
  const event = { tenantId: account.tenantId, actorId: account.userId, eventId: change.eventId, prevStatus: change.prevStatus };
  if (link.leadId) await fireLeadStatusChanged({ ...event, lead: { id: change.id, status: change.status } });
  else await fireContactStatusChanged({ ...event, contact: { id: change.id, status: change.status } });
}

export async function ingestMailboxMessages(account: EmailAccount, messages: GmailEmail[], permissions: MailboxPermissions) {
  const scope = await resolveMailboxScope(account, permissions);
  const staff = await prisma.user.findMany({ where: { tenantId: account.tenantId }, select: { email: true } });
  const internalEmails = new Set([...staff.map(user => normalizeEmail(user.email)), normalizeEmail(account.email)]);
  const ordered = [...messages].sort((a, b) => +new Date(a.date) - +new Date(b.date) || a.id.localeCompare(b.id));
  for (const email of ordered) {
    if (!messageInScope(email, account.email, scope)) continue;
    const now = new Date(), sentAt = new Date(email.date);
    if (!Number.isFinite(+sentAt) || +sentAt > +now) continue;
    const result = await salesTransaction(async tx => {
      if (!await tx.emailAccount.findFirst({ where: { id: account.id, tenantId: account.tenantId, userId: account.userId, isActive: true } })) return;
      const key = { accountId: account.id, providerMessageId: email.id };
      const existing = await tx.mailboxMessage.findUnique({ where: { accountId_providerMessageId: key } });
      const previousDraft = email.labels.includes('DRAFT') && email.draftId ? await tx.mailboxMessage.findFirst({ where: { tenantId: account.tenantId, accountId: account.id, draftId: email.draftId, sourceMessageId: { not: null } }, select: { sourceMessageId: true, crmDraft: true } }) : null;
      const sourceDraft = previousDraft ?? existing;
      if (email.labels.includes('DRAFT') && sourceDraft?.sourceMessageId && !scope.draftSourceIds.includes(sourceDraft.sourceMessageId)) return;
      const excluded = email.labels.some(label => ['SPAM', 'TRASH', 'DELETED'].includes(label));
      if (excluded) {
        if (existing) await tx.mailboxMessage.update({ where: { id: existing.id }, data: { labels: email.labels, direction: 'unknown', meaningful: false, engagementRuleVersion: ENGAGEMENT_RULE_VERSION } });
        return;
      }
      if (existing?.engagementRuleVersion === ENGAGEMENT_RULE_VERSION && !existing.labels.includes('DRAFT') && !email.labels.includes('DRAFT')) {
        await tx.mailboxMessage.update({ where: { id: existing.id }, data: { threadId: email.threadId, labels: email.labels, fromAddress: mailboxAddress(email.from) ?? '', recipientAddresses: [...email.to, ...(email.cc ?? [])].flatMap(value => mailboxAddress(value) ?? []), ccRecipients: email.cc ?? [], replyToAddress: email.replyToAddress ? mailboxAddress(email.replyToAddress) ?? null : null,
          ...(email.rfcMessageId ? { rfcMessageId: email.rfcMessageId } : {}), ...(email.rfcInReplyTo ? { rfcInReplyTo: email.rfcInReplyTo } : {}),
          ...(email.rfcReferences ? { rfcReferences: email.rfcReferences } : {}), ...(email.attachments ? { attachments: email.attachments as unknown as Prisma.InputJsonValue } : {}), ...(email.draftId ? { draftId: email.draftId } : {}) } });
        return;
      }
      const from = normalizeEmail(email.from), recipients = [...email.to, ...(email.cc ?? [])].map(normalizeEmail);
      const direction = from === normalizeEmail(account.email) ? 'outbound' : recipients.includes(normalizeEmail(account.email)) && !internalEmails.has(from) ? 'inbound' : 'unknown';
      const externals = [...new Set([from, ...recipients].filter(address => address.includes('@') && !internalEmails.has(address)))];
      const matched = direction !== 'unknown' && externals.length === 1 ? await matchCustomer(tx, account.tenantId, account.userId, externals[0], permissions) : undefined;
      const priorLink: CustomerLink | undefined = existing?.contactId ? { contactId: existing.contactId } : existing?.leadId ? { leadId: existing.leadId } : undefined;
      const link = matched ?? (priorLink && (priorLink.leadId ? scope.leadIds.includes(priorLink.leadId) : scope.contactIds.includes(priorLink.contactId!)) ? priorLink : undefined);
      const prior = link ? await tx.mailboxMessage.findMany({ where: { ...await historyWhere(tx, account.tenantId, link), accountId: account.id, threadId: email.threadId }, select: { dealId: true } }) : [];
      const association = await tx.mailboxThreadAssociation.findUnique({ where: { accountId_threadId: { accountId: account.id, threadId: email.threadId } } });
      const explicitIds = association?.dealId ? [association.dealId] : existing?.dealId ? [existing.dealId] : [...new Set(prior.map(row => row.dealId).filter((id): id is string => !!id))];
      const deals = link && permissions.dealsView ? await tx.deal.findMany({ where: { ...customerDealWhere(account.tenantId, link), stage: { isWon: false, isLost: false } }, select: { id: true } }) : [];
      const dealId = explicitIds.length === 1 ? explicitIds[0] : !explicitIds.length && deals.length === 1 ? deals[0].id : undefined;
      const genuineReply = direction === 'inbound' && !email.automated && !FIXED_MAILBOX_SENDERS.includes(from) && !email.labels.includes('DRAFT');
      const data = { ...key, threadId: email.threadId, direction, from: email.from, recipients: email.to, subject: email.subject,
        ccRecipients: email.cc ?? [], replyToAddress: email.replyToAddress ? mailboxAddress(email.replyToAddress) ?? null : null,
        fromAddress: mailboxAddress(email.from) ?? '', recipientAddresses: recipients.flatMap(value => mailboxAddress(value) ?? []), draftId: email.draftId,
        ...(email.labels.includes('DRAFT') && sourceDraft ? { sourceMessageId: sourceDraft.sourceMessageId, crmDraft: sourceDraft.crmDraft } : {}),
        body: email.body, snippet: email.snippet, labels: email.labels, sentAt, rfcMessageId: email.rfcMessageId, rfcInReplyTo: email.rfcInReplyTo,
        ...(email.rfcReferences ? { rfcReferences: email.rfcReferences } : {}), ...(email.attachments ? { attachments: email.attachments as unknown as Prisma.InputJsonValue } : {}),
        leadId: link?.leadId ?? null, contactId: link?.contactId ?? null, dealId, meaningful: genuineReply,
        readyToClose: false, needsDealAssociation: !!link && !dealId && deals.length > 1, engagementRuleVersion: ENGAGEMENT_RULE_VERSION };
      const stored = existing ? await tx.mailboxMessage.update({ where: { id: existing.id }, data }) : await tx.mailboxMessage.create({ data: { ...data, tenantId: account.tenantId } });
      if (email.labels.includes('DRAFT') || !link || !(link.leadId ? permissions.leadsEdit : permissions.contactsEdit)) return;
      const hash = createHash('sha256').update([account.tenantId, link.leadId ?? link.contactId, email.rfcMessageId || `${account.id}:${email.id}`, direction].join(':')).digest('hex');
      const activityId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
      await tx.activity.upsert({ where: { id: activityId }, update: {}, create: { id: activityId, tenantId: account.tenantId, ...link,
        createdById: account.userId, type: 'email', title: `${direction === 'inbound' ? 'Received' : 'Sent'} email: ${email.subject}`.slice(0, 500), createdAt: sentAt,
        metadata: { mailboxMessageId: stored.id, providerMessageId: email.id, threadId: email.threadId, mailboxOwnerId: account.userId, direction } } });
      // Historical replay is evaluated once coverage is complete; fresh replies are immediate.
      const change = await evaluateCustomer(tx, account, link, now, !existing && genuineReply);
      return { link, change };
    });
    if (result) await emitStatus(account, result.link, result.change);
  }
}

export async function evaluateMailboxEngagement(account: EmailAccount, permissions: MailboxPermissions, now = new Date()) {
  if (!permissions.leadsEdit && !permissions.contactsEdit) return;
  const scope = await resolveMailboxScope(account, permissions);
  const messages = await prisma.mailboxMessage.findMany({ where: { tenantId: account.tenantId, accountId: account.id, OR: [{ leadId: { in: scope.leadIds } }, { contactId: { in: scope.contactIds } }] }, distinct: ['leadId', 'contactId'], select: { leadId: true, contactId: true } });
  const seen = new Set<string>();
  for (const message of messages) {
    let link: CustomerLink | undefined = message.contactId ? { contactId: message.contactId } : message.leadId ? { leadId: message.leadId } : undefined;
    if (link?.leadId) {
      const lead = await prisma.lead.findFirst({ where: { tenantId: account.tenantId, id: link.leadId }, select: { convertedAt: true, contactId: true } });
      if (lead?.convertedAt && lead.contactId) link = { contactId: lead.contactId };
    }
    if (!link || !(link.leadId ? permissions.leadsEdit : permissions.contactsEdit)) continue;
    const key = link.leadId ?? link.contactId!;
    if (seen.has(key)) continue;
    seen.add(key);
    const change = await salesTransaction(tx => evaluateCustomer(tx, account, link!, now));
    await emitStatus(account, link, change);
  }
}

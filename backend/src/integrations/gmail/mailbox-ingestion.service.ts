import { EmailAccount, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeCrmStatus } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { salesTransaction } from '../../modules/crm/leads/lead-automation.service';
import { CustomerLink, changeCustomerStatus, customerDealWhere, cancelOpenDeals } from '../../modules/crm/engagement.service';
import { classifyEngagement, engagementStatus, ENGAGEMENT_REASONS, hasBusinessContext, newMessageText, normalizeEmail, eligibleForCold } from './engagement-rules';
import { GmailEmail } from './gmail.types';
import { readDealStageAutomation } from '../../modules/crm/deal-stage-automation.service';

export interface MailboxPermissions { leadsView: boolean; contactsView: boolean; leadsEdit: boolean; contactsEdit: boolean; dealsEdit: boolean; dealsView: boolean }
type Tx = Prisma.TransactionClient;

async function matchCustomer(tx: Tx, tenantId: string, email: string, permissions: MailboxPermissions): Promise<CustomerLink | undefined> {
  // contains narrows legacy whitespace data; equality after normalization is mandatory.
  const where = { tenantId, isArchived: false, deletedAt: null, email: { contains: email, mode: 'insensitive' as const } };
  const leads = permissions.leadsView ? (await tx.lead.findMany({ where })).filter(row => normalizeEmail(row.email ?? '') === email) : [];
  const contacts = permissions.contactsView ? (await tx.contact.findMany({ where })).filter(row => normalizeEmail(row.email ?? '') === email) : [];
  const convertedContacts = permissions.contactsView ? await tx.contact.findMany({ where: { tenantId, isArchived: false, deletedAt: null,
    id: { in: leads.filter(lead => lead.convertedAt && lead.contactId).map(lead => lead.contactId!) } } }) : [];
  for (const contact of convertedContacts) if (!contacts.some(row => row.id === contact.id)) contacts.push(contact);
  const activeLeads = leads.filter(lead => !lead.convertedAt && (!lead.contactId || !contacts.some(contact => contact.id === lead.contactId)));
  if (activeLeads.length + contacts.length !== 1) return;
  return activeLeads[0] ? { leadId: activeLeads[0].id } : { contactId: contacts[0].id };
}

export async function ingestMailboxMessages(account: EmailAccount, messages: GmailEmail[], permissions: MailboxPermissions) {
  const staff = await prisma.user.findMany({ where: { tenantId: account.tenantId }, select: { email: true } });
  const internalEmails = new Set(staff.map(user => normalizeEmail(user.email)));
  internalEmails.add(normalizeEmail(account.email));
  const ordered = [...messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id.localeCompare(b.id));
  for (const email of ordered) {
    if (email.labels.some(label => ['DRAFT', 'SPAM', 'TRASH'].includes(label))) continue;
    await salesTransaction(async tx => {
      if (!await tx.emailAccount.findFirst({ where: { id: account.id, tenantId: account.tenantId, userId: account.userId, isActive: true } })) return;
      // All writes for one provider message, including history, commit together.
      const key = { accountId: account.id, providerMessageId: email.id };
      const existing = await tx.mailboxMessage.findUnique({ where: { accountId_providerMessageId: key } });
      if (existing && existing.engagementRuleVersion >= 1) {
        await tx.mailboxMessage.update({ where: { id: existing.id }, data: { labels: email.labels, engagementRuleVersion: 1 } }); return;
      }
      const from = normalizeEmail(email.from), recipients = [...email.to, ...(email.cc ?? [])].map(normalizeEmail);
      const direction = from === normalizeEmail(account.email) ? 'outbound' : recipients.includes(normalizeEmail(account.email)) && !internalEmails.has(from) ? 'inbound' : 'unknown';
      const externals = [...new Set([from, ...recipients].filter(address => address.includes('@') && !internalEmails.has(address)))];
      const matched = direction !== 'unknown' && externals.length === 1 ? await matchCustomer(tx, account.tenantId, externals[0], permissions) : undefined;
      const priorLink: CustomerLink | undefined = existing?.leadId ? { leadId: existing.leadId } : existing?.contactId ? { contactId: existing.contactId } : matched;
      const link = priorLink && (priorLink.leadId ? permissions.leadsView : permissions.contactsView) ? priorLink : undefined;
      const sentAt = new Date(email.date);
      if (!Number.isFinite(sentAt.getTime())) return;
      const sourceLeadIds = link?.contactId ? (await tx.lead.findMany({
        where: { tenantId: account.tenantId, contactId: link.contactId, convertedAt: { not: null } }, select: { id: true },
      })).map(lead => lead.id) : [];
      const prior = link ? await tx.mailboxMessage.findMany({ where: { tenantId: account.tenantId, accountId: account.id, threadId: email.threadId,
        ...(link.contactId ? { OR: [{ contactId: link.contactId }, { leadId: { in: sourceLeadIds } }] } : link),
        sentAt: { lt: sentAt } }, orderBy: { sentAt: 'desc' }, take: 100 }) : [];
      const businessThread = hasBusinessContext(email.subject) || prior.some(message => hasBusinessContext(newMessageText(message.body)));
      const signal = direction === 'inbound' ? classifyEngagement(email.plainText ?? email.body, businessThread, email.automated) : 'none';
      const deals = link && permissions.dealsView ? await tx.deal.findMany({ where: { ...customerDealWhere(account.tenantId, link), stage: { isWon: false, isLost: false } }, include: { stage: true } }) : [];
      // Existing thread linkage outranks the single-open-Deal fallback. A terminal link never falls through to a new opportunity.
      const association = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: { tenantId: account.tenantId, module: 'mailbox-thread', key: `${account.id}:${email.threadId}` } } });
      const associationValue = association?.value as { dealId?: string; linkedAt?: string } | null;
      const explicitIds = associationValue?.dealId ? [associationValue.dealId] : existing?.dealId ? [existing.dealId] : [...new Set(prior.map(message => message.dealId).filter((id): id is string => !!id))];
      const context = `${email.subject}\n${newMessageText(email.plainText ?? email.body)}`.toLowerCase();
      const productMatches = deals.filter(row => row.productInterests.some(product => product.trim().length >= 3 && context.includes(product.trim().toLowerCase())));
      const references = deals.filter(row => Object.entries((row.closingValues ?? {}) as Record<string, unknown>)
        .some(([key, value]) => key === 'reference-number' && typeof value === 'string' && value.trim().length >= 3 && context.includes(value.trim().toLowerCase())));
      const deal = explicitIds.length ? (explicitIds.length === 1 ? deals.find(row => row.id === explicitIds[0]) : undefined)
        : productMatches.length ? (productMatches.length === 1 ? productMatches[0] : undefined)
        : references.length ? (references.length === 1 ? references[0] : undefined) : deals.length === 1 ? deals[0] : undefined;
      const messageData = { ...key, tenantId: account.tenantId, threadId: email.threadId, direction,
        from: email.from, recipients: email.to, subject: email.subject, body: email.body, snippet: email.snippet, labels: email.labels, sentAt,
        rfcMessageId: email.rfcMessageId, ...link, dealId: deal?.id ?? explicitIds[0], meaningful: signal !== 'none',
        readyToClose: signal === 'proceed', needsDealAssociation: !!link && !deal && deals.length > 1, engagementRuleVersion: 1 };
      const { tenantId: _tenantId, ...messageUpdate } = messageData;
      const stored = existing ? await tx.mailboxMessage.update({ where: { id: existing.id }, data: messageUpdate }) : await tx.mailboxMessage.create({ data: messageData });
      if (!link || !(link.leadId ? permissions.leadsEdit : permissions.contactsEdit)) return;
      const eventKey = createHash('sha256').update([account.tenantId, link.leadId ?? link.contactId, email.rfcMessageId || `${account.id}:${email.id}`, direction].join(':')).digest('hex');
      const activityId = `${eventKey.slice(0, 8)}-${eventKey.slice(8, 12)}-${eventKey.slice(12, 16)}-${eventKey.slice(16, 20)}-${eventKey.slice(20, 32)}`;
      await tx.activity.upsert({ where: { id: activityId }, update: {}, create: { id: activityId, tenantId: account.tenantId, ...link, createdById: account.userId, type: 'email',
        title: `${direction === 'inbound' ? 'Received' : 'Sent'} email: ${email.subject}`.slice(0, 500), createdAt: sentAt,
        metadata: { mailboxMessageId: stored.id, providerMessageId: email.id, threadId: email.threadId, mailboxOwnerId: account.userId, direction } } });
      const customer = link.leadId ? await tx.lead.findFirst({ where: { tenantId: account.tenantId, id: link.leadId, isArchived: false, deletedAt: null } }) : await tx.contact.findFirst({ where: { tenantId: account.tenantId, id: link.contactId, isArchived: false, deletedAt: null } });
      if (!customer) return;
      const updateEngagement = async (data: { lastMeaningfulInboundAt?: Date; firstUnansweredOutboundAt?: Date | null; engagementEvaluatedAt?: Date }) => {
        if (link.leadId) await tx.lead.update({ where: { tenantId: account.tenantId, id: link.leadId }, data });
        else await tx.contact.update({ where: { tenantId: account.tenantId, id: link.contactId }, data });
      };
      const eligible = sentAt > account.connectedAt && sentAt >= customer.createdAt && sentAt <= new Date()
        && (!customer.lastStatusChangedAt || sentAt > customer.lastStatusChangedAt);
      if (!eligible) return;
      const isNew = !customer.engagementEvaluatedAt || sentAt > customer.engagementEvaluatedAt || !!existing && +sentAt === +customer.engagementEvaluatedAt;
      if (direction === 'outbound') {
        if (isNew && customer.lastMeaningfulInboundAt && sentAt > customer.lastMeaningfulInboundAt && !customer.firstUnansweredOutboundAt && hasBusinessContext(newMessageText(email.plainText ?? email.body))) await updateEngagement({ firstUnansweredOutboundAt: sentAt });
        return;
      }
      if (signal === 'none' || ['Closed', 'Cancelled'].includes(normalizeCrmStatus(customer.status))) return;
      if (isNew) await updateEngagement({ lastMeaningfulInboundAt: sentAt, firstUnansweredOutboundAt: null, engagementEvaluatedAt: sentAt });
      const nextStatus = engagementStatus(customer.status, signal);
      const reason = ENGAGEMENT_REASONS[signal];
      if (isNew && nextStatus) await changeCustomerStatus(tx, account.tenantId, account.userId, link, nextStatus, reason, sentAt);
      if (!(await readDealStageAutomation(tx, account.tenantId)).enabled) return;
      if (!deal || !permissions.dealsEdit || sentAt <= (deal.stageChangedAt ?? deal.createdAt) || associationValue?.linkedAt && sentAt <= new Date(associationValue.linkedAt)) return;
      if (signal === 'cancel') { if (isNew) await cancelOpenDeals(tx, account.tenantId, account.userId, link, reason, deal.id, sentAt); return; }
      const twoWay = prior.some(message => message.direction === 'outbound' && hasBusinessContext(newMessageText(message.body)));
      const targetName = signal === 'quotation' || signal === 'proceed' ? 'Qualified' : twoWay ? 'Contacted' : undefined;
      const rank = ['lead', 'contacted', 'qualified'];
      if (!targetName || rank.indexOf(deal.stage.name.toLowerCase()) < 0 || rank.indexOf(targetName.toLowerCase()) <= rank.indexOf(deal.stage.name.toLowerCase())) return;
      const targets = await tx.stage.findMany({ where: { tenantId: account.tenantId, pipelineId: deal.pipelineId, name: { equals: targetName, mode: 'insensitive' }, isWon: false, isLost: false } });
      if (targets.length !== 1 || targets[0].requiredFields.some(field => { const value = (deal as Record<string, unknown>)[field]; return value == null || value === '' || Array.isArray(value) && !value.length; })) return;
      await tx.deal.update({ where: { tenantId: account.tenantId, id: deal.id }, data: { stageId: targets[0].id, stageChangedAt: sentAt } });
      await tx.dealStageHistory.create({ data: { tenantId: account.tenantId, dealId: deal.id, previousStageId: deal.stageId, newStageId: targets[0].id, movedById: account.userId, note: reason } });
      await tx.activity.create({ data: { tenantId: account.tenantId, dealId: deal.id, createdById: account.userId, type: 'stage_change', title: `Deal moved from ${deal.stage.name} to ${targetName}`, description: reason } });
    });
  }
}

export async function evaluateMailboxCold(account: EmailAccount, permissions: MailboxPermissions, now = new Date()) {
  if (!permissions.leadsEdit && !permissions.contactsEdit) return;
  const messages = await prisma.mailboxMessage.findMany({ where: { tenantId: account.tenantId, accountId: account.id, meaningful: true }, distinct: ['leadId', 'contactId'], select: { leadId: true, contactId: true } });
  for (const message of messages) {
    const link: CustomerLink | undefined = message.leadId ? { leadId: message.leadId } : message.contactId ? { contactId: message.contactId } : undefined;
    if (!link || !(link.leadId ? permissions.leadsEdit : permissions.contactsEdit)) continue;
    await salesTransaction(async tx => {
      const customer = link.leadId ? await tx.lead.findFirst({ where: { tenantId: account.tenantId, id: link.leadId, isArchived: false } }) : await tx.contact.findFirst({ where: { tenantId: account.tenantId, id: link.contactId, isArchived: false } });
      if (!customer || !eligibleForCold(customer, now)) return;
      // Missing/revoked/stale mailbox coverage must never be mistaken for customer silence.
      const stale = await tx.mailboxMessage.findFirst({ where: { tenantId: account.tenantId, ...link, account: { OR: [{ isActive: false }, { lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - 86400000) } }, { syncPageToken: { not: null } }, { syncError: { not: null } }] } } });
      if (stale) return;
      await changeCustomerStatus(tx, account.tenantId, account.userId, link, 'Cold', 'No meaningful inbound customer response for 60 days after product-related communication.', now);
    });
  }
}

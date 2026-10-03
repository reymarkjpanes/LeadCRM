import { randomUUID } from 'node:crypto';
import prisma from '../../config/database.config';
import { readAuthUser } from '../../core/auth/auth-user';
import { assertPermissions } from '../../core/permissions/permission.service';
import { requireEmployeeAccount } from '../../core/auth/account-access';
import { tenantContext } from '../../core/tenant/tenant-context';
import { isOnboardingComplete } from '@leadcrm/shared';
import { AppError } from '../../shared/errors/app-error';
import { fetchMessageDetail, getValidAccessToken, parseGmailMessage, GmailApiMessage } from './gmail.service';
import { ingestMailboxMessages, evaluateMailboxCold, MailboxPermissions } from './mailbox-ingestion.service';
import { normalizeEmail } from './engagement-rules';
import { GmailEmail } from './gmail.types';
import { customerDealWhere, CustomerLink } from '../../modules/crm/engagement.service';
import { salesTransaction } from '../../modules/crm/leads/lead-automation.service';
import { isMailboxOwner } from './mailbox-ownership';
import { readGmailJson as gmailJson } from './gmail-read';

export async function mailboxPermissions(tenantId: string, userId: string, checkOwnership = true): Promise<MailboxPermissions> {
  const user = await readAuthUser(userId, tenantId);
  requireEmployeeAccount(user);
  if (user.status !== 'ACTIVE' || user.mustChangePassword || ['SUSPENDED', 'REJECTED'].includes(user.tenantStatus ?? '') || user.role === 'Client Admin' && !isOnboardingComplete(user)) throw new AppError('Mailbox access unavailable.', 403);
  const identity = { userId, tenantId, role: user.role };
  const allowed = async (permission: 'leads.view' | 'contacts.view' | 'leads.edit' | 'contacts.edit' | 'deals.edit' | 'deals.view') => {
    try { await assertPermissions(identity, [permission]); return true; } catch (error) { if (error instanceof AppError && error.statusCode === 403) return false; throw error; }
  };
  const leadsView = await allowed('leads.view'), contactsView = await allowed('contacts.view');
  if (!leadsView && !contactsView) throw new AppError('CRM View permission is required.', 403);
  const account = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (checkOwnership && account && !isMailboxOwner({ userId, tenantId, email: user.email }, account.email)) throw new AppError('Mailbox ownership does not match, or temporary test access expired. Reconnect your staff work email in Messages.', 403);
  return { leadsView, contactsView, leadsEdit: await allowed('leads.edit'), contactsEdit: await allowed('contacts.edit'), dealsEdit: await allowed('deals.edit'), dealsView: await allowed('deals.view') };
}

export async function decorateEmails(tenantId: string, userId: string, emails: GmailEmail[], permissions: MailboxPermissions) {
  const account = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account) return emails;
  const saved = await prisma.mailboxMessage.findMany({ where: { tenantId, accountId: account.id, providerMessageId: { in: emails.map(email => email.id) } } });
  const openDeals = permissions.dealsView ? await prisma.deal.findMany({ where: { tenantId, id: { in: saved.map(row => row.dealId).filter((id): id is string => !!id) }, isArchived: false, stage: { isWon: false, isLost: false } }, select: { id: true } }) : [];
  return emails.map(email => { const row = saved.find(item => item.providerMessageId === email.id); return {
    ...email, direction: row?.direction ?? (normalizeEmail(email.from) === normalizeEmail(account.email) ? 'outbound' : [...email.to, ...(email.cc ?? [])].some(address => normalizeEmail(address) === normalizeEmail(account.email)) ? 'inbound' : 'unknown'),
    leadId: permissions.leadsView ? row?.leadId : undefined, contactId: permissions.contactsView ? row?.contactId : undefined, dealId: permissions.dealsView ? row?.dealId : undefined,
    needsDealAssociation: permissions.dealsView ? row?.needsDealAssociation : false, readyToClose: !!row?.readyToClose && openDeals.some(deal => deal.id === row.dealId),
  }; });
}

export async function readMailboxThread(tenantId: string, userId: string, threadId: string) {
  const permissions = await mailboxPermissions(tenantId, userId);
  const accessToken = await getValidAccessToken(tenantId, userId);
  const data = await gmailJson<{ messages?: GmailApiMessage[] }>(accessToken, `threads/${encodeURIComponent(threadId)}?format=full`);
  const emails = (data.messages ?? []).map(parseGmailMessage).sort((a, b) => a.date.localeCompare(b.date));
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  await ingestMailboxMessages(account, emails, permissions);
  const decorated = await decorateEmails(tenantId, userId, emails, permissions);
  const latest = decorated[decorated.length - 1];
  const link: CustomerLink | undefined = latest?.leadId ? { leadId: latest.leadId } : latest?.contactId ? { contactId: latest.contactId } : undefined;
  const deals = link && permissions.dealsView ? await prisma.deal.findMany({ where: { ...customerDealWhere(tenantId, link), stage: { isWon: false, isLost: false } }, select: { id: true, title: true, stage: { select: { name: true } } } }) : [];
  return { emails: decorated, dealOptions: deals.map(deal => ({ id: deal.id, title: deal.title, stage: deal.stage.name })), canAssociateDeal: permissions.dealsEdit };
}

export async function associateMailboxDeal(tenantId: string, userId: string, threadId: string, dealId: string) {
  const permissions = await mailboxPermissions(tenantId, userId);
  if (!permissions.dealsEdit) throw new AppError('Deal edit permission is required.', 403);
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account.isActive) throw new AppError('Connect your mailbox first.', 409);
  await salesTransaction(async tx => {
    const messages = await tx.mailboxMessage.findMany({ where: { tenantId, accountId: account.id, threadId }, distinct: ['leadId', 'contactId'], select: { leadId: true, contactId: true } });
    const links = messages.filter(message => message.leadId || message.contactId);
    if (links.length !== 1) throw new AppError('This thread must have one unambiguous CRM email match.', 409);
    const link: CustomerLink = links[0].leadId ? { leadId: links[0].leadId } : { contactId: links[0].contactId! };
    if (!(link.leadId ? permissions.leadsView : permissions.contactsView)) throw new AppError('Access denied', 403);
    const deal = await tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), id: dealId, stage: { isWon: false, isLost: false } } });
    if (!deal) throw new AppError('Select an open Deal belonging to the linked CRM record.', 400);
    const key = { tenantId, module: 'mailbox-thread', key: `${account.id}:${threadId}` };
    const previous = await tx.tenantPreference.findUnique({ where: { tenantId_module_key: key } });
    if ((previous?.value as { dealId?: string } | null)?.dealId === dealId) return;
    const value = { dealId, linkedAt: new Date().toISOString() };
    await tx.tenantPreference.upsert({ where: { tenantId_module_key: key }, create: { ...key, value }, update: { value } });
    await tx.activity.create({ data: { tenantId, dealId, createdById: userId, type: 'note', title: 'Email conversation associated with this Deal', description: 'Staff selected this opportunity. Future customer messages may update its open stage.', metadata: { threadId, mailboxOwnerId: userId } } });
  });
  return { success: true };
}

/** Durable, resumable full/history sync. One bounded page per run avoids request timeouts. */
export async function syncMailbox(tenantId: string, userId: string) {
  const permissions = await mailboxPermissions(tenantId, userId);
  let account = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account?.isActive) throw new AppError('Connect your work Gmail account first.', 409);
  const leaseId = randomUUID();
  const lease = await prisma.emailAccount.updateMany({ where: { id: account.id, tenantId, isActive: true, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: new Date() } }] },
    data: { syncLeaseId: leaseId, syncLeaseUntil: new Date(Date.now() + 180000) } });
  if (!lease.count) return { syncing: true, hasMore: true };
  try {
    const accessToken = await getValidAccessToken(tenantId, userId);
    account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } });
    const wasHistorySync = !!account.syncCursor;
    let ids: string[] = [], pageToken: string | undefined, historyId: string | undefined;
    if (account.syncCursor) {
      const params = new URLSearchParams({ startHistoryId: account.syncCursor, maxResults: '20', historyTypes: 'messageAdded' });
      if (account.syncPageToken) params.set('pageToken', account.syncPageToken);
      try {
        const history = await gmailJson<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; nextPageToken?: string; historyId: string }>(accessToken, `history?${params}`);
        ids = [...new Set((history.history ?? []).flatMap(row => row.messagesAdded?.map(item => item.message.id) ?? []))];
        pageToken = history.nextPageToken; historyId = history.historyId;
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
        // Gmail expired this cursor. Rebuild without deleting already saved mail or histories.
        await prisma.emailAccount.update({ where: { id: account.id }, data: { syncCursor: null, syncPageToken: null, syncBaselineHistoryId: null } });
        return { syncing: true, hasMore: true };
      }
    } else {
      if (!account.syncBaselineHistoryId) {
        const profile = await gmailJson<{ historyId: string }>(accessToken, 'profile');
        account = await prisma.emailAccount.update({ where: { id: account.id }, data: { syncBaselineHistoryId: profile.historyId } });
      }
      const params = new URLSearchParams({ maxResults: '20', q: '-in:spam -in:trash -in:drafts' });
      if (account.syncPageToken) params.set('pageToken', account.syncPageToken);
      const list = await gmailJson<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, `messages?${params}`);
      ids = (list.messages ?? []).map(item => item.id); pageToken = list.nextPageToken; historyId = account.syncBaselineHistoryId!;
    }
    // Replay a bounded batch after a rule upgrade, retaining provider idempotency and
    // the status/stage timestamp barriers that protect subsequent manual changes.
    const pendingRules = await prisma.mailboxMessage.findMany({ where: { tenantId, accountId: account.id, direction: 'inbound', engagementRuleVersion: { lt: 1 } }, orderBy: { sentAt: 'desc' }, take: 20, select: { providerMessageId: true } });
    ids = [...new Set([...ids, ...pendingRules.map(message => message.providerMessageId)])];
    const messages: GmailEmail[] = [];
    for (let offset = 0; offset < ids.length; offset += 5) {
      const batch = await Promise.all(ids.slice(offset, offset + 5).map(async id => {
        try { return parseGmailMessage(await gmailJson<GmailApiMessage>(accessToken, `messages/${encodeURIComponent(id)}?format=full`)); }
        catch (error) { if (error instanceof AppError && error.statusCode === 404) return null; throw error; }
      }));
      messages.push(...batch.filter((message): message is GmailEmail => !!message));
      const renewed = await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId, isActive: true }, data: { syncLeaseUntil: new Date(Date.now() + 180000) } });
      if (!renewed.count) throw new AppError('Mailbox sync interrupted. Retry sync.', 409);
    }
    // Include earlier messages from each conversation before classifying its reply.
    // Gmail's full mailbox listing is newest-first and may split a thread across pages.
    const threadIds = [...new Set(messages.map(message => message.threadId))];
    for (let offset = 0; offset < threadIds.length; offset += 5) {
      const threads = await Promise.all(threadIds.slice(offset, offset + 5).map(threadId => gmailJson<{ messages?: GmailApiMessage[] }>(accessToken, `threads/${encodeURIComponent(threadId)}?format=full`)));
      threads.forEach(thread => messages.push(...(thread.messages ?? []).map(parseGmailMessage)));
      if (!(await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId, isActive: true }, data: { syncLeaseUntil: new Date(Date.now() + 180000) } })).count) throw new AppError('Mailbox sync interrupted. Retry sync.', 409);
    }
    await ingestMailboxMessages(account, [...new Map(messages.map(message => [message.id, message])).values()], permissions);
    await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId, isActive: true }, data: { syncPageToken: pageToken ?? null, syncError: null,
      ...(!pageToken ? { syncCursor: historyId, lastSyncAt: new Date(), syncBaselineHistoryId: null } : {}) } });
    // Full sync is a snapshot. Catch up from its baseline before treating silence as inactivity.
    if (!pageToken && wasHistorySync) await evaluateMailboxCold(account, permissions);
    return { syncing: !!pageToken, hasMore: !!pageToken, processed: messages.length };
  } catch (error) {
    await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId }, data: { syncError: 'Sync could not complete. Retry, or reconnect if Gmail access was revoked.' } });
    throw error;
  } finally {
    await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId }, data: { syncLeaseId: null, syncLeaseUntil: null } });
  }
}

export function startMailboxScheduler() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const accounts = await prisma.emailAccount.findMany({ where: { provider: 'gmail', isActive: true, tenantId: { not: 'system' } }, select: { tenantId: true, userId: true } });
      for (const account of accounts) {
        try { await tenantContext.run({ tenantId: account.tenantId }, () => syncMailbox(account.tenantId, account.userId)); }
        catch { console.warn('[mailbox-sync] A mailbox could not sync; retrying on the next scheduled run.'); }
      }
    } catch { console.warn('[mailbox-sync] Mailbox discovery unavailable.'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 5 * 60000);
  timer.unref();
  return () => clearInterval(timer);
}

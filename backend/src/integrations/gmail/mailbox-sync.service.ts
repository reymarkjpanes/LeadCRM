import { Prisma } from '@prisma/client';
import { mailboxProviderQueries, messageInScope, resolveMailboxScope, scopedMessagesWhere } from './mailbox-scope';
import { mailboxChanged, storedEmail } from './mailbox-store';
import { runScheduledMailboxEmails } from './scheduled-mailbox.service';
import { randomUUID } from 'node:crypto';
import prisma from '../../config/database.config';
import { readAuthUser } from '../../core/auth/auth-user';
import { assertPermissions } from '../../core/permissions/permission.service';
import { requireEmployeeAccount } from '../../core/auth/account-access';
import { tenantContext } from '../../core/tenant/tenant-context';
import { isOnboardingComplete, isWorkspaceAccessible } from '@leadcrm/shared';
import { AppError } from '../../shared/errors/app-error';
import { fetchMessageDetail, getValidAccessToken, parseGmailMessage, GmailApiMessage } from './gmail.service';
import { ingestMailboxMessages, evaluateMailboxEngagement, MailboxPermissions } from './mailbox-ingestion.service';
import { normalizeEmail, ENGAGEMENT_RULE_VERSION } from './engagement-rules';
import { GmailEmail } from './gmail.types';
import { customerDealWhere, CustomerLink } from '../../modules/crm/engagement.service';
import { salesTransaction } from '../../modules/crm/leads/lead-automation.service';
import { isMailboxOwner } from './mailbox-ownership';
import { readGmailJson as gmailJson } from './gmail-read';

export async function mailboxPermissions(tenantId: string, userId: string, checkOwnership = true): Promise<MailboxPermissions> {
  const user = await readAuthUser(userId, tenantId);
  requireEmployeeAccount(user);
  if (user.status !== 'ACTIVE' || user.mustChangePassword || !isWorkspaceAccessible(user.tenantStatus) || !isOnboardingComplete(user)) throw new AppError('Mailbox access unavailable.', 403);
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

export async function decorateEmails(tenantId: string, userId: string, emails: GmailEmail[], permissions: MailboxPermissions, expectedScopeHash?: string): Promise<GmailEmail[]> {
  const account = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account) return emails;
  const scope = await resolveMailboxScope(account, permissions);
  if (expectedScopeHash && expectedScopeHash !== scope.hash) throw new AppError('Mailbox assignments changed. Refresh your Inbox.', 409, 'MAILBOX_SCOPE_CHANGED');
  const saved = await prisma.mailboxMessage.findMany({ where: { tenantId, accountId: account.id, providerMessageId: { in: emails.map(email => email.id) } }, select: { providerMessageId: true, direction: true, leadId: true, contactId: true, dealId: true, needsDealAssociation: true } });
  return emails.map<GmailEmail>(email => { const row = saved.find(item => item.providerMessageId === email.id); return {
    ...email, direction: row?.direction as GmailEmail['direction'] ?? (normalizeEmail(email.from) === normalizeEmail(account.email) ? 'outbound' : [...email.to, ...(email.cc ?? [])].some(address => normalizeEmail(address) === normalizeEmail(account.email)) ? 'inbound' : 'unknown'),
    leadId: row?.leadId && scope.leadIds.includes(row.leadId) ? row.leadId : undefined,
    contactId: row?.contactId && scope.contactIds.includes(row.contactId) ? row.contactId : undefined,
    dealId: permissions.dealsView && (scope.leadIds.includes(row?.leadId ?? '') || scope.contactIds.includes(row?.contactId ?? '')) ? row?.dealId : undefined,
    needsDealAssociation: permissions.dealsView ? row?.needsDealAssociation : false,
  }; });
}

export async function readMailboxThread(tenantId: string, userId: string, threadId: string) {
  const permissions = await mailboxPermissions(tenantId, userId);
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account.isActive) throw new AppError('Connect your mailbox first.', 409);
  const scope = await resolveMailboxScope(account, permissions);
  const saved = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { threadId, NOT: { labels: { has: 'DRAFT' } } }] }, orderBy: [{ sentAt: 'asc' }, { providerMessageId: 'asc' }] });
  if (!saved.length) throw new AppError('Conversation is outside your assigned CRM mailbox scope.', 404);
  const emails = saved.map(storedEmail);
  const decorated = await decorateEmails(tenantId, userId, emails, permissions, scope.hash);
  const latest = decorated[decorated.length - 1];
  const link: CustomerLink | undefined = latest?.leadId ? { leadId: latest.leadId } : latest?.contactId ? { contactId: latest.contactId } : undefined;
  const deals = link && permissions.dealsView ? await prisma.deal.findMany({ where: { ...customerDealWhere(tenantId, link), stage: { isWon: false, isLost: false } }, select: { id: true, title: true, stage: { select: { name: true } } } }) : [];
  const association = link && permissions.dealsView ? await prisma.mailboxThreadAssociation.findUnique({ where: { accountId_threadId: { accountId: account.id, threadId } } }) : null;
  const associated = association && link ? await prisma.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), id: association.dealId }, select: { id: true } }) : null;
  return { emails: associated ? decorated.map(email => ({ ...email, dealId: associated.id, needsDealAssociation: false })) : decorated, dealOptions: deals.map(deal => ({ id: deal.id, title: deal.title, stage: deal.stage.name })), canAssociateDeal: permissions.dealsEdit && permissions.dealsView };
}

export async function associateMailboxDeal(tenantId: string, userId: string, threadId: string, dealId: string) {
  const permissions = await mailboxPermissions(tenantId, userId);
  if (!permissions.dealsView || !permissions.dealsEdit) throw new AppError('Deal view and edit permissions are required.', 403);
  const account = await prisma.emailAccount.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account.isActive) throw new AppError('Connect your mailbox first.', 409);
  const scope = await resolveMailboxScope(account, permissions);
  await salesTransaction(async tx => {
    const messages = await tx.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { threadId }] }, distinct: ['leadId', 'contactId'], select: { leadId: true, contactId: true } });
    const links = messages.filter(message => message.leadId ? scope.leadIds.includes(message.leadId) : message.contactId && scope.contactIds.includes(message.contactId));
    if (links.length !== 1) throw new AppError('This thread must have one unambiguous CRM email match.', 409);
    const link: CustomerLink = links[0].leadId ? { leadId: links[0].leadId } : { contactId: links[0].contactId! };
    if (!(link.leadId ? permissions.leadsView : permissions.contactsView)) throw new AppError('Access denied', 403);
    const deal = await tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), id: dealId, stage: { isWon: false, isLost: false } } });
    if (!deal) throw new AppError('Select an open Deal belonging to the linked CRM record.', 400);
    const key = { accountId: account.id, threadId };
    const previous = await tx.mailboxThreadAssociation.findUnique({ where: { accountId_threadId: key } });
    if (previous?.dealId === dealId) return;
    const value = { dealId, linkedAt: new Date() };
    await tx.mailboxThreadAssociation.upsert({ where: { accountId_threadId: key }, create: { ...key, tenantId, ...value }, update: value });
    await tx.activity.create({ data: { tenantId, dealId, createdById: userId, type: 'note', title: 'Email conversation associated with this Deal', description: 'Staff selected this opportunity for conversation history.', metadata: { threadId, mailboxOwnerId: userId } } });
  });
  await mailboxChanged(account.id);
  return { success: true };
}


interface SyncBatch { ids: string[]; deleted: string[]; drafts?: Record<string, string>; nextPage?: string; historyId: string; nextIndex: number; history: boolean }

function reconciliationQueries(scope: Awaited<ReturnType<typeof resolveMailboxScope>>) {
  return mailboxProviderQueries(scope).flatMap(query => [{ resource: 'messages', query: query + ' -in:drafts' }, { resource: 'drafts', query }]);
}

export function mailboxSyncIntervalMs() {
  const seconds = Number(process.env.GMAIL_SYNC_INTERVAL_SECONDS ?? 60);
  return (Number.isInteger(seconds) && seconds >= 60 && seconds <= 3600 ? seconds : 60) * 1000;
}

/** All entry points share this DB lease and durable continuation. Reads never start sync. */
export async function syncMailbox(tenantId: string, userId: string, trigger: 'manual' | 'worker' = 'manual') {
  const started = new Date();
  const permissions = await mailboxPermissions(tenantId, userId);
  let account = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (!account?.isActive) throw new AppError('Connect your work Gmail account first.', 409);
  if (account.syncRetryAt && account.syncRetryAt > started) return { syncing: false, hasMore: true, retryAt: account.syncRetryAt.toISOString() };
  const scope = await resolveMailboxScope(account, permissions);
  let changedScope = scope.hash !== account.syncScopeHash;
  const pollDue = !account.lastSyncAt || +started - +account.lastSyncAt >= mailboxSyncIntervalMs();
  const requested = !!account.syncRequestedAt;
  if (trigger === 'worker' && !changedScope && !pollDue && !requested && account.syncCursor && !account.syncBatch && !account.syncPageToken) {
    await prisma.emailAccount.updateMany({ where: { id: account.id }, data: { syncCheckedAt: started } });
    return { syncing: false, hasMore: false, processed: 0 };
  }
  // Repeated manual clicks/replicas cannot create a sequence of redundant calls.
  if (!changedScope && !requested && account.syncCursor && !account.syncPageToken && !account.syncBatch && account.lastSyncAt && +started - +account.lastSyncAt < 10000) return { syncing: false, hasMore: false, processed: 0 };
  const leaseId = randomUUID();
  const lease = await prisma.emailAccount.updateMany({ where: { id: account.id, tenantId, isActive: true, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: started } }] },
    data: { syncLeaseId: leaseId, syncLeaseUntil: new Date(Date.now() + 180000), syncCheckedAt: started } });
  if (!lease.count) return { syncing: true, hasMore: true };
  const checkpoint = async (data: Prisma.EmailAccountUpdateManyMutationInput) => {
    if (!(await prisma.emailAccount.updateMany({ where: { id: account!.id, syncLeaseId: leaseId, isActive: true }, data: { ...data, syncLeaseUntil: new Date(Date.now() + 180000) } })).count) throw new AppError('Mailbox sync interrupted.', 409);
  };
  try {
    // Another replica may have completed a page between our read and claim.
    account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } });
    changedScope = scope.hash !== account.syncScopeHash;
    const quietPeriod = trigger === 'worker' ? mailboxSyncIntervalMs() : 10000;
    if (!changedScope && !account.syncRequestedAt && account.syncCursor && !account.syncPageToken && !account.syncBatch && account.lastSyncAt && Date.now() - +account.lastSyncAt < quietPeriod) return { syncing: false, hasMore: false, processed: 0 };
    const token = await getValidAccessToken(tenantId, userId);
    if (changedScope) {
      await checkpoint({ syncScopeHash: scope.hash, syncCursor: null, syncPageToken: null, syncBatch: Prisma.DbNull, syncQueryIndex: 0, syncBaselineHistoryId: null });
      account = await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } });
    }
    let batch = account.syncBatch as unknown as SyncBatch | null;
    if (!batch) {
      if (account.syncCursor) {
        const params = new URLSearchParams({ startHistoryId: account.syncCursor, maxResults: '20' });
        if (account.syncPageToken) params.set('pageToken', account.syncPageToken);
        try {
          type HistoryRow = { messagesAdded?: { message: { id: string } }[]; labelsAdded?: { message: { id: string } }[]; labelsRemoved?: { message: { id: string } }[]; messagesDeleted?: { message: { id: string } }[] };
          const history = await gmailJson<{ history?: HistoryRow[]; nextPageToken?: string; historyId: string }>(token, 'history?' + params);
          const ids = [...new Set((history.history ?? []).flatMap(row => [...(row.messagesAdded ?? []), ...(row.labelsAdded ?? []), ...(row.labelsRemoved ?? [])].map(item => item.message.id)))];
          const deleted = [...new Set((history.history ?? []).flatMap(row => row.messagesDeleted?.map(item => item.message.id) ?? []))];
          if (ids.length > 10000) throw new AppError('Gmail history page exceeded the safe processing bound.', 503);
          batch = { ids, deleted, nextPage: history.nextPageToken, historyId: history.historyId, nextIndex: 0, history: true };
        } catch (error) {
          if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
          await checkpoint({ syncCursor: null, syncPageToken: null, syncBatch: Prisma.DbNull, syncQueryIndex: 0, syncBaselineHistoryId: null, syncRequestedAt: started });
          console.info('[mailbox-sync]', { accountId: account.id, trigger: 'history-recovery' });
          return { syncing: true, hasMore: true, processed: 0 };
        }
      } else {
        const queries = reconciliationQueries(scope);
        if (!account.syncBaselineHistoryId) {
          const profile = await gmailJson<{ historyId: string }>(token, 'profile');
          await checkpoint({ syncBaselineHistoryId: profile.historyId });
          account.syncBaselineHistoryId = profile.historyId;
        }
        const query = queries[account.syncQueryIndex] ?? queries[0];
        const params = new URLSearchParams({ maxResults: '20', q: query.query });
        if (account.syncPageToken) params.set('pageToken', account.syncPageToken);
        const list = await gmailJson<{ messages?: { id: string }[]; drafts?: { id: string; message: { id: string } }[]; nextPageToken?: string }>(token, query.resource + '?' + params);
        batch = { ids: [...new Set([...(list.messages ?? []).map(row => row.id), ...(list.drafts ?? []).map(row => row.message.id)])], drafts: Object.fromEntries((list.drafts ?? []).map(row => [row.message.id, row.id])), deleted: [], nextPage: list.nextPageToken, historyId: account.syncBaselineHistoryId!, nextIndex: list.nextPageToken ? account.syncQueryIndex : account.syncQueryIndex + 1, history: false };
      }
      // JSON strips undefined; persisting before ingestion makes interrupted pages replayable.
      await checkpoint({ syncBatch: JSON.parse(JSON.stringify(batch)) });
    }
    if (batch.deleted.length) await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, tenantId, providerMessageId: { in: batch.deleted } }, data: { labels: ['DELETED'] } });
    let processed = 0, examined = 0;
    for (const id of batch.ids.slice(0, 20)) {
      if (examined && Date.now() - +started > 45000) break;
      try {
        // History contains unfiltered IDs. Inspect headers before fetching any body.
        const meta = await gmailJson<GmailApiMessage>(token, 'messages/' + encodeURIComponent(id) + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Message-ID');
        const email = parseGmailMessage(meta);
        if (email.labels.some(label => ['SPAM', 'TRASH'].includes(label))) {
          await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, tenantId, providerMessageId: id }, data: { labels: email.labels } });
        } else if (messageInScope(email, account.email, scope)) {
          let draftId = batch.drafts?.[id];
          if (!draftId && email.labels.includes('DRAFT') && email.rfcMessageId && /^<[^\s<>]+>$/.test(email.rfcMessageId)) {
            const params = new URLSearchParams({ maxResults: '20', q: 'rfc822msgid:' + email.rfcMessageId });
            const drafts = await gmailJson<{ drafts?: { id: string; message: { id: string } }[] }>(token, 'drafts?' + params);
            draftId = drafts.drafts?.find(draft => draft.message.id === id)?.id;
          }
          // Gmail can replace a draft's message ID while preserving its draft ID.
          const savedDraft = email.labels.includes('DRAFT') ? await prisma.mailboxMessage.findFirst({ where: { tenantId, accountId: account.id,
            sourceMessageId: { not: null }, OR: [{ providerMessageId: id }, ...(draftId ? [{ draftId }] : [])] }, select: { sourceMessageId: true } }) : null;
          if (!savedDraft?.sourceMessageId || scope.draftSourceIds.includes(savedDraft.sourceMessageId)) {
            const full = await fetchMessageDetail(token, id);
            full.draftId = draftId;
            await ingestMailboxMessages(account, [full], permissions);
            processed++;
          }
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
        await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, tenantId, providerMessageId: id }, data: { labels: ['DELETED'] } });
      }
      await checkpoint({});
      examined++;
    }
    batch.ids = batch.ids.slice(examined); batch.deleted = [];
    const queriesDone = batch.history || batch.nextIndex >= reconciliationQueries(scope).length;
    const hasMore = !!batch.ids.length || !!batch.nextPage || !queriesDone;
    await checkpoint({ syncError: null, syncRetryAt: null, mailboxVersion: { increment: 1 },
      ...(batch.ids.length ? { syncBatch: JSON.parse(JSON.stringify(batch)) } : {
        syncBatch: Prisma.DbNull, syncPageToken: batch.nextPage ?? null, syncQueryIndex: batch.nextIndex,
        ...(!hasMore ? { syncCursor: batch.historyId, syncBaselineHistoryId: null, syncQueryIndex: 0, lastSyncAt: new Date() } : {}),
      }) });
    if (!hasMore) {
      // Requests arriving during processing remain pending for the next pass.
      await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId, syncRequestedAt: { lte: started } }, data: { syncRequestedAt: null } });
      if (batch.history) {
        const pending = await prisma.mailboxMessage.findMany({ where: { AND: [scopedMessagesWhere(account, scope), { engagementRuleVersion: { lt: ENGAGEMENT_RULE_VERSION }, NOT: { labels: { has: 'DRAFT' } } }] }, take: 5, orderBy: { sentAt: 'asc' } });
        for (const row of pending) {
          if (Date.now() - +started > 45000) break;
          // Old rule versions need original automation headers, absent from legacy rows.
          try { await ingestMailboxMessages(account, [await fetchMessageDetail(token, row.providerMessageId)], permissions); }
          catch (error) {
            if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
            await prisma.mailboxMessage.updateMany({ where: { id: row.id }, data: { labels: ['DELETED'] } });
          }
          await checkpoint({});
        }
        if (pending.length) await checkpoint({ syncRequestedAt: new Date() });
        await evaluateMailboxEngagement(account, permissions);
      }
      else await checkpoint({ syncRequestedAt: new Date() }); // Catch up from pre-reconciliation baseline.
    }
    console.info('[mailbox-sync]', { accountId: account.id, trigger, processed, durationMs: Date.now() - +started, hasMore });
    return { syncing: hasMore, hasMore, processed };
  } catch (error) {
    const retryAt = error instanceof AppError && error.retryAt ? new Date(error.retryAt) : new Date(Date.now() + 60000 + Math.random() * 5000);
    await checkpoint({ syncRetryAt: retryAt, syncRequestedAt: new Date(), mailboxVersion: { increment: 1 }, syncError: error instanceof AppError && error.code === 'GMAIL_RATE_LIMITED' ? 'Gmail updates are temporarily paused. Saved emails remain available.' : 'Email updates are delayed. Reconnect if Gmail access was revoked.' });
    console.warn('[mailbox-sync]', { accountId: account.id, trigger, category: error instanceof AppError ? error.code : 'SYNC_FAILED', durationMs: Date.now() - +started });
    throw error;
  } finally {
    await prisma.emailAccount.updateMany({ where: { id: account.id, syncLeaseId: leaseId }, data: { syncLeaseId: null, syncLeaseUntil: null } });
  }
}

export function startMailboxScheduler() {
  let running = false, sending = false, stopped = false;
  const sendDue = async () => {
    if (sending || stopped) return;
    sending = true;
    try { await runScheduledMailboxEmails(); }
    catch { console.warn('[mailbox-schedule] Worker unavailable; persisted jobs will resume.'); }
    finally { sending = false; }
  };
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const accounts = await prisma.emailAccount.findMany({ where: { provider: 'gmail', isActive: true, tenantId: { not: 'system' }, OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: new Date() } }] }, orderBy: { syncCheckedAt: { sort: 'asc', nulls: 'first' } }, take: 20, select: { id: true, tenantId: true, userId: true } });
      for (let index = 0; index < accounts.length && !stopped; index += 3) await Promise.all(accounts.slice(index, index + 3).map(async account => {
        try { await tenantContext.run({ tenantId: account.tenantId }, () => syncMailbox(account.tenantId, account.userId, 'worker')); }
        catch { await prisma.emailAccount.updateMany({ where: { id: account.id }, data: { syncCheckedAt: new Date() } }); }
      }));
    } catch { console.warn('[mailbox-sync] Worker iteration unavailable; persisted jobs will resume.'); }
    finally { running = false; }
  };
  void run(); void sendDue();
  const timer = setInterval(() => { void run(); void sendDue(); }, 10000);
  timer.unref();
  console.info('[mailbox-worker]', { queueCheckMs: 10000, mailboxConcurrency: 3, gmailSyncIntervalMs: mailboxSyncIntervalMs() });
  return () => { stopped = true; clearInterval(timer); };
}

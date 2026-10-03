import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { EmailAccount } from '@prisma/client';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';
import { issueAuthSession } from '../../core/auth/auth-session';
import { encryptToken, decryptToken } from '../../core/encryption/crypto.service';
import { hashToken } from '../../core/auth/session.service';
import { ingestMailboxMessages, evaluateMailboxCold } from './mailbox-ingestion.service';
import { syncMailbox, associateMailboxDeal, mailboxPermissions } from './mailbox-sync.service';
import { beginMailboxConnection, finishMailboxConnection } from './mailbox-auth.service';
import { moveDealStage } from '../../modules/crm/deals/deals.repository';
import { updateContact as updateLead } from '../../modules/crm/contacts/contacts.repository';
import { updateContact } from '../../modules/crm/contacts-v2/contacts-v2.repository';
import { salesPipeline, salesTransaction } from '../../modules/crm/leads/lead-automation.service';
import { convertClosedLead } from '../../modules/crm/leads/lead-conversion.service';
import { getValidAccessToken, sendEmail } from './gmail.service';
import app from '../../app';
import type { GmailEmail } from './gmail.types';
import { mailConfig } from '../../config/mail.config';
import { resolveRow as resolveImportRow } from '../../modules/crm/deal-imports/deal-imports.service';
import { ImportDealRowSchema } from '@leadcrm/shared';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && /^\/leadcrm_mailbox_test_\d+$/.test(url.pathname);
describe.skipIf(!disposable)('mailbox database and authenticated HTTP', () => {
  let tenantId: string, otherTenant: string, userId: string, token: string, denied: string, otherStaff: string, account: EmailAccount, base: string, server: Server;
  let stages: Record<string, string>, pipelineId: string;
  const permissions = { leadsView: true, contactsView: true, leadsEdit: true, contactsEdit: true, dealsEdit: true, dealsView: true };
  const now = new Date(), day = 86400000, before = (days: number) => new Date(+now - days * day);
  const scope = <T>(work: () => T) => tenantContext.run({ tenantId }, work);
  const realFetch = globalThis.fetch;
  const message = (threadId: string, address: string, direction: 'inbound' | 'outbound', body: string, days = 5): GmailEmail => ({
    id: randomUUID().replaceAll('-', ''), threadId, from: direction === 'inbound' ? address : account.email,
    to: [direction === 'inbound' ? account.email : address], date: before(days).toISOString(), subject: 'Product inquiry', body,
    snippet: body, isRead: true, labels: [direction === 'inbound' ? 'INBOX' : 'SENT'], rfcMessageId: `<${randomUUID()}@example.test>`,
  });
  const ingest = (messages: GmailEmail[], rights = permissions) => scope(() => ingestMailboxMessages(account, messages, rights));
  async function customer(dealCount = 1, status = 'Warm') {
    const email = `${randomUUID()}@example.test`;
    const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Customer', lastName: 'Test', email, status, productInterest: ['Product'], createdAt: before(180) } });
    const deals = [];
    for (let n = 0; n < dealCount; n++) deals.push(await prisma.deal.create({ data: { tenantId, pipelineId, stageId: stages.Lead, leadId: lead.id, title: `Opportunity ${n}`, value: 3250, assignedUserId: userId, productInterests: ['Product'], tags: [], createdAt: before(180) } }));
    return { lead, deals, email, thread: randomUUID().replaceAll('-', '') };
  }
  const read = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
  const stageOf = async (id: string) => (await prisma.deal.findUniqueOrThrow({ where: { id }, include: { stage: true } })).stage.name;
  const call = async (path: string, method = 'GET', body?: unknown, auth = token) => {
    const response = await realFetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Mailbox tests', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    // These pre-existing automation scenarios explicitly opt in; new tenants default to manual stages.
    await prisma.tenantPreference.create({ data: { tenantId, module: 'deal-stage-automation', key: 'default', value: { enabled: true } } });
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: randomUUID() } })).id;
    const user = await prisma.user.create({ data: { tenantId, email: 'mailbox-admin@camxian.com', firstName: 'Mail', lastName: 'Owner', role: 'Client Admin', mustChangePassword: false } });
    userId = user.id; token = (await issueAuthSession(user)).token;
    denied = (await issueAuthSession(await prisma.user.create({ data: { tenantId, email: 'denied-mail@camxian.com', firstName: 'Denied', lastName: 'Staff', role: 'Sales', mustChangePassword: false } }))).token;
    otherStaff = (await issueAuthSession(await prisma.user.create({ data: { tenantId, email: 'other-mail@camxian.com', firstName: 'Other', lastName: 'Staff', role: 'Client Admin', mustChangePassword: false } }))).token;
    account = await prisma.emailAccount.create({ data: { tenantId, userId, email: user.email, accessToken: encryptToken('test-access'), refreshToken: encryptToken('test-refresh'), tokenExpiresAt: new Date(+now + day), scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: before(365), lastSyncAt: now } });
    const pipeline = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    pipelineId = pipeline.pipeline.id;
    stages = Object.fromEntries((await prisma.stage.findMany({ where: { tenantId, pipelineId } })).map(stage => [stage.name, stage.id]));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('preserves source timestamps, directions and exact case/whitespace matching; skips generic replies', async () => {
    const c = await customer(1, 'Cold');
    await prisma.lead.update({ where: { id: c.lead.id }, data: { email: ` ${c.email.toUpperCase()} ` } });
    const outbound = message(c.thread, c.email, 'outbound', 'Here is product information.', 9);
    const thanks = message(c.thread, c.email, 'inbound', 'Thanks', 8);
    await ingest([outbound, thanks]);
    expect((await read(c.lead.id)).status).toBe('Cold'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    const inbound = message(c.thread, c.email, 'inbound', 'How does the product work?', 7);
    await ingest([inbound]);
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Contacted');
    const activity = await prisma.activity.findFirstOrThrow({ where: { leadId: c.lead.id, type: 'email', createdAt: new Date(inbound.date) } });
    expect(activity.metadata).toMatchObject({ direction: 'inbound', providerMessageId: inbound.id });
  });
  it('formal requests qualify; clear intent sets Hot but never closes', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'inbound', 'Please send a quotation.', 7)]);
    expect(await stageOf(c.deals[0].id)).toBe('Qualified'); expect((await read(c.lead.id)).status).toBe('Warm');
    await ingest([message(c.thread, c.email, 'inbound', 'We approve the quotation and will proceed.', 5)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Qualified');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: c.deals[0].id } })).closedAt).toBeNull();
  });
  it('retains converted Lead email aliases and original thread Deal context for the Contact', async () => {
    const c = await customer(2);
    const outbound = message(c.thread, c.email, 'outbound', 'Here is product information.', 9);
    await ingest([outbound]);
    await prisma.mailboxMessage.update({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: outbound.id } }, data: { dealId: c.deals[1].id } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Existing', lastName: 'Customer', email: `${randomUUID()}@example.test`, createdAt: before(180) } });
    await scope(() => salesTransaction(async tx => {
      await tx.lead.update({ where: { id: c.lead.id }, data: { status: 'Closed', contactId: contact.id } });
      await convertClosedLead(tx, tenantId, c.lead.id, userId);
    }));
    const reply = message(c.thread, c.email, 'inbound', 'Please send a quotation.', 5);
    await ingest([reply]);
    const stored = await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: reply.id } } });
    expect(stored).toMatchObject({ contactId: contact.id, leadId: null, dealId: c.deals[1].id });
    expect((await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: outbound.id } } })).leadId).toBe(c.lead.id);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe('CLOSED');
    expect(await prisma.activity.count({ where: { contactId: contact.id, type: 'email' } })).toBe(1);
    expect(await stageOf(c.deals[0].id)).toBe('Lead');
    expect(await stageOf(c.deals[1].id)).toBe('Lead');
  });
  it('abstains from duplicate CRM matches and multi-customer threads', async () => {
    const c = await customer();
    await prisma.contact.create({ data: { tenantId, firstName: 'Duplicate', lastName: 'Customer', email: c.email, productInterests: [], activeProducts: [] } });
    const duplicate = message(c.thread, c.email, 'inbound', 'We will proceed.');
    await ingest([duplicate]);
    expect((await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: duplicate.id } } })).leadId).toBeNull();
    expect((await read(c.lead.id)).status).toBe('Warm');
    const group = await customer();
    await ingest([{ ...message(group.thread, group.email, 'inbound', 'We want to proceed.'), cc: ['unrelated@example.test'] }]);
    expect((await read(group.lead.id)).status).toBe('Warm');
  });
  it('links only within the tenant and never by customer name', async () => {
    const c = await customer();
    const foreign = await prisma.lead.create({ data: { tenantId: otherTenant, firstName: 'Customer', lastName: 'Test', email: 'foreign@example.test', productInterest: [] } });
    await ingest([message(c.thread, 'foreign@example.test', 'inbound', 'We want to proceed.')]);
    expect((await read(foreign.id)).status).toBe('Warm'); expect((await read(c.lead.id)).status).toBe('Warm');
  });
  it('does not guess among multiple open Deals; explicit association applies to new messages', async () => {
    const c = await customer(2);
    await ingest([message(c.thread, c.email, 'inbound', 'Please send a quotation.', 5)]);
    expect(await stageOf(c.deals[0].id)).toBe('Lead'); expect(await stageOf(c.deals[1].id)).toBe('Lead');
    await scope(() => associateMailboxDeal(tenantId, userId, c.thread, c.deals[1].id));
    // Advance the saved association barrier into the past to represent a subsequent real response.
    await prisma.tenantPreference.update({ where: { tenantId_module_key: { tenantId, module: 'mailbox-thread', key: `${account.id}:${c.thread}` } }, data: { value: { dealId: c.deals[1].id, linkedAt: before(3).toISOString() } } });
    await ingest([message(c.thread, c.email, 'inbound', 'We want to proceed with the product.', 2)]);
    expect(await stageOf(c.deals[0].id)).toBe('Lead'); expect(await stageOf(c.deals[1].id)).toBe('Qualified');
    await expect(scope(() => associateMailboxDeal(otherTenant, userId, c.thread, c.deals[0].id))).rejects.toBeDefined();
  });
  it('cancellation closes the relevant open Deal, keeps terminal history, and does not reopen from replies', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'inbound', 'Please cancel our order.', 4)]);
    expect((await read(c.lead.id)).status).toBe('Cancelled'); expect(await stageOf(c.deals[0].id)).toBe('Closed Lost');
    await ingest([message(c.thread, c.email, 'inbound', 'We want to proceed.', 2)]);
    expect((await read(c.lead.id)).status).toBe('Cancelled'); expect(await stageOf(c.deals[0].id)).toBe('Closed Lost');
    expect(await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } })).toBe(1);
  });
  it('makes message ingestion and activity idempotent, including concurrent repeats', async () => {
    const c = await customer(), inbound = message(c.thread, c.email, 'inbound', 'We want to proceed.');
    await Promise.all([ingest([inbound]), ingest([inbound])]); await ingest([inbound]);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, providerMessageId: inbound.id } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, type: 'email' } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, type: 'stage_change' } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } })).toBe(1);
  });
  it('old mail never undoes manual status/stage changes', async () => {
    const c = await customer();
    await scope(() => updateLead(c.lead.id, tenantId, { status: 'Cold' }, userId, 'Warm'));
    await scope(() => moveDealStage(c.deals[0].id, tenantId, stages.Qualified, userId));
    await ingest([message(c.thread, c.email, 'outbound', 'Product information', 9), message(c.thread, c.email, 'inbound', 'How does the product work?', 8)]);
    expect((await read(c.lead.id)).status).toBe('Cold'); expect(await stageOf(c.deals[0].id)).toBe('Qualified');
  });
  it('validates configured requirements, closes after the final save, and preserves related sales data', async () => {
    const c = await customer();
    expect((await call(`/crm/deals/${c.deals[0].id}/stage`, 'PATCH', { stageId: stages['Closed Won'] })).status).toBe(400);
    const confirmation = { type: 'Approved Quotation', date: before(1).toISOString().slice(0, 10), note: 'Quote Q-123 approved; sale verified.' };
    expect((await call(`/crm/deals/${c.deals[0].id}/stage`, 'PATCH', { stageId: stages['Closed Won'], confirmation })).status).toBe(400);
    expect((await call(`/crm/deals/${c.deals[0].id}/stage`, 'PATCH', { stageId: stages.Qualified })).status).toBe(200);
    expect((await call(`/crm/deals/${c.deals[0].id}/closing-requirements`, 'PATCH', { values: { 'confirmation-type': confirmation.type, 'closing-notes': confirmation.note } })).status).toBe(200);
    expect(await stageOf(c.deals[0].id)).toBe('Qualified');
    expect((await call(`/crm/deals/${c.deals[0].id}/closing-requirements`, 'PATCH', { values: { 'confirmation-date': confirmation.date } })).status).toBe(200);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: c.deals[0].id } });
    expect(deal).toMatchObject({ value: 3250, assignedUserId: userId, productInterests: ['Product'], wonConfirmedById: userId });
    expect(deal.closingSnapshot).toMatchObject({ values: { 'confirmation-type': confirmation.type, 'confirmation-date': confirmation.date, 'closing-notes': confirmation.note } });
    expect(deal.closedAt).not.toBeNull(); expect(deal.wonConfirmedAt).not.toBeNull();
    const lead = await read(c.lead.id); expect(lead.status).toBe('Closed');
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: lead.contactId! } })).status).toBe('CLOSED');
    expect((await call(`/crm/deals/${c.deals[0].id}/stage`, 'PATCH', { stageId: stages['Closed Won'], confirmation })).status).toBe(200);
    expect(await prisma.dealStageHistory.count({ where: { dealId: deal.id } })).toBe(2);
    expect((await call(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages.Qualified })).status).toBe(400);
  });
  it('manual cancellation closes all open related Deals and writes Contact history atomically', async () => {
    const c = await customer(2);
    await scope(() => updateLead(c.lead.id, tenantId, { status: 'Cancelled' }, userId, 'Warm'));
    for (const deal of c.deals) expect(await stageOf(deal.id)).toBe('Closed Lost');
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Contact', lastName: 'Test', email: `${randomUUID()}@example.test`, productInterests: [], activeProducts: [] } });
    await scope(() => updateContact(contact.id, tenantId, { status: 'Cancelled' }, userId));
    expect(await prisma.activity.count({ where: { contactId: contact.id, type: 'stage_change' } })).toBe(1);
    await expect(scope(() => updateContact(contact.id, tenantId, { status: 'Closed' }, userId))).rejects.toBeDefined();
  });
  it('Cold needs customer silence, unanswered outreach, and fresh sync; follow-ups do not reset the clock', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'inbound', 'How does the product work?', 80)]);
    await scope(() => evaluateMailboxCold(account, permissions, now)); expect((await read(c.lead.id)).status).toBe('Warm');
    await ingest([message(c.thread, c.email, 'outbound', 'Here is product information.', 70), message(c.thread, c.email, 'outbound', 'Following up on the product.', 1)]);
    const savedCustomer = await read(c.lead.id); expect(savedCustomer.lastMeaningfulInboundAt).toEqual(before(80)); expect(savedCustomer.firstUnansweredOutboundAt).toEqual(before(70));
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncError: 'Revoked' } });
    await scope(() => evaluateMailboxCold(account, permissions, now)); expect((await read(c.lead.id)).status).toBe('Warm');
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncError: null, lastSyncAt: now } });
    await scope(() => evaluateMailboxCold(account, permissions, now)); expect((await read(c.lead.id)).status).toBe('Cold');
    expect(await stageOf(c.deals[0].id)).toBe('Lead');
    await scope(() => evaluateMailboxCold(account, permissions, now));
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, title: 'Status changed from Warm to Cold' } })).toBe(1);
  });
  it('enforces mailbox ownership, authentication and CRM permissions', async () => {
    expect((await call('/integrations/gmail/status', 'GET', undefined, '')).status).toBe(401);
    expect((await call('/integrations/gmail/status', 'GET', undefined, denied)).status).toBe(403);
    expect((await call('/integrations/gmail/status', 'GET', undefined, otherStaff)).body.isConnected).toBe(false);
    expect((await call('/integrations/gmail/status')).body).not.toHaveProperty('accessToken');
    const c = await customer(); await ingest([message(c.thread, c.email, 'inbound', 'We want to proceed.')], { ...permissions, leadsEdit: false, contactsEdit: false });
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
  });
  it('blocks closing through record creation, CSV imports, or stage reconfiguration', async () => {
    for (const module of ['leads', 'contacts']) expect((await call(`/crm/${module}`, 'POST', { firstName: 'Closed', lastName: 'Blocked', email: 'closed@example.test', status: 'Closed' })).status).toBe(400);
    const c = await customer();
    expect((await call(`/crm/stages/${stages.Lead}`, 'PUT', { isWon: true })).status).toBe(400);
    expect(await stageOf(c.deals[0].id)).toBe('Lead');
    const { resolveRow } = await import('../../modules/crm/deal-imports/deal-imports.service');
    await expect(scope(() => resolveRow(tenantId, { title: 'Bypass', pipeline: pipelineId, stage: stages['Closed Won'] } as never))).rejects.toBeDefined();
  });
  it('OAuth state is random, one-time, session-bound, PKCE-protected and stores encrypted tokens', async () => {
    const oauth = await scope(() => beginMailboxConnection({ userId, tenantId, email: account.email }, token));
    const parsed = new URL(oauth.url), state = parsed.searchParams.get('state')!;
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256'); expect(state).not.toContain(userId);
    expect(await prisma.mailboxOAuthState.findUnique({ where: { stateHash: hashToken(state) } })).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).includes('/token') ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify' }) : Response.json({ email: account.email })));
    await finishMailboxConnection(state, 'provider-code');
    const saved = await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(saved.accessToken).not.toBe('new-access'); expect(decryptToken(saved.accessToken)).toBe('new-access');
    await expect(finishMailboxConnection(state, 'provider-code')).rejects.toMatchObject({ statusCode: 400 });
    const second = await scope(() => beginMailboxConnection({ userId, tenantId, email: account.email }, token));
    await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { revokedAt: now } });
    await expect(finishMailboxConnection(new URL(second.url).searchParams.get('state')!, 'code')).rejects.toMatchObject({ statusCode: 401 });
    await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { revokedAt: null } });
  });
  it('refreshes expired Gmail tokens and persists rotation independently of application login', async () => {
    await prisma.emailAccount.update({ where: { id: account.id }, data: { tokenExpiresAt: new Date(0), refreshToken: encryptToken('refresh-before-rotation') } });
    const provider = vi.fn(async (_url: string, options: RequestInit) => {
      const body = options.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-before-rotation');
      return Response.json({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
    });
    vi.stubGlobal('fetch', provider);
    expect(await getValidAccessToken(tenantId, userId)).toBe('refreshed-access');
    const saved = await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(decryptToken(saved.accessToken)).toBe('refreshed-access');
    expect(decryptToken(saved.refreshToken!)).toBe('rotated-refresh');
    expect(saved.accessToken).not.toBe('refreshed-access');
    expect(saved.refreshToken).not.toBe('rotated-refresh');
    expect(saved.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await getValidAccessToken(tenantId, userId)).toBe('refreshed-access');
    expect(provider).toHaveBeenCalledOnce();
  });
  it('rejects connecting another email address to the staff account', async () => {
    const oauth = await scope(() => beginMailboxConnection({ userId, tenantId, email: account.email }, token));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => String(input).includes('/token') ? Response.json({ access_token: 'wrong-access', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify' }) : Response.json({ email: 'personal@gmail.com' })));
    await expect(finishMailboxConnection(new URL(oauth.url).searchParams.get('state')!, 'code')).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).email).toBe(account.email);
  });
  it('uses the same temporary ownership restriction for sync permissions and HTTP status', async () => {
    const original = mailConfig.gmail.testMailboxOverride;
    const exception = { tenantId, userId, staffEmail: account.email, mailboxEmail: 'approved-test@gmail.com', startsAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + day).toISOString() };
    try {
      Object.assign(mailConfig.gmail, { testMailboxOverride: JSON.stringify(exception) });
      await prisma.emailAccount.update({ where: { id: account.id }, data: { email: exception.mailboxEmail } });
      expect(await scope(() => mailboxPermissions(tenantId, userId))).toEqual(permissions);
      expect((await call('/integrations/gmail/status')).body).toMatchObject({ isConnected: true, email: exception.mailboxEmail });
      Object.assign(mailConfig.gmail, { testMailboxOverride: JSON.stringify({ ...exception, expiresAt: new Date(Date.now() - 1).toISOString() }) });
      await expect(scope(() => mailboxPermissions(tenantId, userId))).rejects.toMatchObject({ statusCode: 403 });
      expect((await call('/integrations/gmail/status')).body.isConnected).toBe(false);
      expect((await call('/integrations/gmail/emails')).status).toBe(403);
      expect((await call('/integrations/gmail/unread-count')).status).toBe(403);
      expect((await call('/integrations/gmail/disconnect', 'POST')).status).toBe(200);
      expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).accessToken).toBe('');
    } finally {
      Object.assign(mailConfig.gmail, { testMailboxOverride: original });
      await prisma.emailAccount.update({ where: { id: account.id }, data: { email: account.email, isActive: true, accessToken: account.accessToken, refreshToken: account.refreshToken } });
    }
  });
  it('sends from the connected owner and preserves reply threading headers', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/send')) { bodies.push(JSON.parse(String(init?.body))); return Response.json({ id: 'sentid', threadId: 'thread' }); }
      return Response.json({ id: 'replyid', threadId: 'thread', internalDate: String(+before(1)), labelIds: ['INBOX'], snippet: '', payload: { headers: [{ name: 'Message-ID', value: '<original@example.test>' }], mimeType: 'text/plain', body: { data: Buffer.from('Product question').toString('base64url') } } });
    }));
    await scope(() => sendEmail(tenantId, userId, 'customer@example.test', 'Re: Product', '<p>Details</p>', 'replyid'));
    expect(bodies[0].threadId).toBe('thread');
    const mime = Buffer.from(String(bodies[0].raw), 'base64url').toString(); expect(mime).toContain(`From: ${account.email}`); expect(mime).toContain('In-Reply-To: <original@example.test>');
  });
  it('resumes full sync, advances the history cursor only on completion, and recovers expired cursors', async () => {
    const c = await customer(), inbound = message(c.thread, c.email, 'inbound', 'Please send a quotation.');
    const apiMessage = { id: inbound.id, threadId: c.thread, internalDate: String(new Date(inbound.date).getTime()), labelIds: ['INBOX'], snippet: '', payload: { headers: [{ name: 'From', value: c.email }, { name: 'To', value: account.email }], mimeType: 'text/plain', body: { data: Buffer.from(inbound.body).toString('base64url') } } };
    let expire = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.includes('history?')) return expire ? new Response('{}', { status: 404 }) : Response.json({ historyId: '102', history: [] });
      if (path.endsWith('/profile')) return Response.json({ historyId: '100' });
      if (path.includes('messages?')) return path.includes('pageToken=next') ? Response.json({ messages: [] }) : Response.json({ messages: [{ id: inbound.id }], nextPageToken: 'next' });
      return Response.json(apiMessage);
    }));
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncCursor: null, syncPageToken: null } });
    expect((await scope(() => syncMailbox(tenantId, userId))).hasMore).toBe(true);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBeNull();
    expect((await scope(() => syncMailbox(tenantId, userId))).hasMore).toBe(false);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBe('100');
    await scope(() => syncMailbox(tenantId, userId)); expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBe('102');
    expire = true; await scope(() => syncMailbox(tenantId, userId)); expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBeNull();
    expect(await prisma.mailboxMessage.count({ where: { providerMessageId: inbound.id } })).toBe(1);
  });

  it('re-evaluates previously stored quotation requests without duplicating history or changing another Deal', async () => {
    const c = await customer(), unrelated = await customer();
    const request = message(c.thread, c.email, 'inbound', 'Please send me the formal quotation and let me know the next steps if we decide to proceed.', 5);
    await ingest([request]);
    await prisma.deal.update({ where: { id: c.deals[0].id }, data: { stageId: stages.Contacted, stageChangedAt: before(6) } });
    await prisma.lead.update({ where: { id: c.lead.id }, data: { engagementEvaluatedAt: before(2), status: 'Warm' } });
    await prisma.mailboxMessage.update({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: request.id } }, data: { engagementRuleVersion: 0, meaningful: true } });
    await ingest([request]); await ingest([request]);
    expect(await stageOf(c.deals[0].id)).toBe('Qualified');
    expect(await stageOf(unrelated.deals[0].id)).toBe('Lead');
    expect((await read(c.lead.id)).status).toBe('Warm');
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, type: 'email' } })).toBe(1);
    const history = await call(`/crm/activities?leadId=${c.lead.id}`);
    expect(history.body.data.find((a: { type: string }) => a.type === 'email').metadata.email).toMatchObject({ body: request.body, from: request.from, to: request.to, subject: request.subject, sentAt: request.date });
  });

  it('keeps outgoing quotation and reviewing customer Warm, but explicit approval Hot and Qualified', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'outbound', 'We approve the quotation. Please proceed with the order.', 8)]);
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    await ingest([message(c.thread, c.email, 'inbound', 'Could you please send me the available options and a quotation?', 7)]);
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Qualified');
    await ingest([message(c.thread, c.email, 'inbound', 'I am still deciding on the service.', 6)]);
    expect((await read(c.lead.id)).status).toBe('Warm');
    await ingest([message(c.thread, c.email, 'inbound', 'The quotation is acceptable.', 5)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Qualified');
  });

  it('enforces required names, trims valid edits and preserves create email validation over HTTP', async () => {
    const c = await customer();
    for (const key of ['firstName', 'lastName']) {
      expect((await call(`/crm/leads/${c.lead.id}`, 'PUT', { [key]: '   ' })).status).toBe(400);
      expect((await call('/crm/leads', 'POST', { firstName: 'New', lastName: 'Person', email: 'new@example.test', [key]: '   ' })).status).toBe(400);
      expect((await call(`/crm/leads/${c.lead.id}`, 'PUT', { [key]: '  Trimmed  ' })).status).toBe(200);
      expect((await read(c.lead.id))[key as 'firstName' | 'lastName']).toBe('Trimmed');
    }
    expect((await call('/crm/leads', 'POST', { firstName: 'New', lastName: 'Person', email: '' })).status).toBe(400);
  });

  it('persists field definitions, guards permissions/types/tenant access, and requires uploaded Deal evidence', async () => {
    const initial = (await call('/administration/closing-requirements')).body.data;
    const foreignUser = await prisma.user.create({ data: { tenantId: otherTenant, email: `${randomUUID()}@camxian.com`, firstName: 'Other', lastName: 'Admin', role: 'Client Admin', mustChangePassword: false } });
    await prisma.tenant.update({ where: { id: otherTenant }, data: { onboardingStep: 3, onboardingCompletedAt: new Date() } });
    const foreignToken = (await issueAuthSession(foreignUser)).token;
    const c = await customer(2), dealId = c.deals[0].id;
    const endpoint = `/crm/deals/${dealId}/closing-requirements`;
    try {
      expect((await call('/administration/closing-requirements', 'GET', undefined, denied)).status).toBe(403);
      expect((await call(endpoint, 'PATCH', { values: { 'confirmation-type': 'Approved Quotation' } }, denied)).status).toBe(403);
      expect((await call(endpoint, 'GET', undefined, foreignToken)).status).toBe(404);
      const document = { ...initial.find((f: { id: string }) => f.id === 'required-document') }; delete document.id; delete document.version; document.required = true;
      expect((await call('/administration/closing-requirements/required-document', 'PATCH', document)).status).toBe(200);
      expect((await call('/administration/closing-requirements/required-document', 'PATCH', { ...document, type: 'Text' })).status).toBe(400);
      expect((await call('/administration/closing-requirements', 'POST', { name: 'Count', type: 'Number', appliesTo: 'Closed Won Requirements', required: false })).status).toBe(200);
      const saved = (await call('/administration/closing-requirements')).body.data;
      expect(saved.some((f: { name: string }) => f.name === 'Count')).toBe(true);
      const optionalInput = { name: 'Delivery option', type: 'Dropdown', appliesTo: 'Closed Won Requirements', required: false, options: ['Old', 'New'] };
      const optionalFields = (await call('/administration/closing-requirements', 'POST', optionalInput)).body.data;
      const optionalId = optionalFields.id;
      expect((await call(endpoint, 'PATCH', { values: { [optionalId]: 'Old' } })).status).toBe(200);
      expect((await call(`/administration/closing-requirements/${optionalId}`, 'PATCH', { ...optionalInput, options: ['New'] })).status).toBe(200);
      expect((await call('/administration/closing-requirements', 'POST', { name: 'Invalid', type: 'Dropdown', appliesTo: 'Closed Won Requirements', required: false, options: ['Same', 'same'] })).status).toBe(400);
      expect((await call(endpoint, 'PATCH', { values: { 'confirmation-date': '2026-02-30' } })).status).toBe(400);
      expect((await call(endpoint, 'PATCH', { values: { 'confirmation-type': 'Fake' } })).status).toBe(400);
      expect((await call(endpoint, 'PATCH', { values: { 'required-document': 'blob:local-file' } })).status).toBe(400);
      expect((await call(endpoint, 'PATCH', { values: { 'required-document': randomUUID() } })).status).toBe(400);
      await call(endpoint, 'PATCH', { values: { 'confirmation-type': 'Approved Quotation', 'confirmation-date': '2026-10-01' } });
      expect(await stageOf(dealId)).toBe('Lead');
      expect((await call(`/crm/deals/${dealId}/stage`, 'PATCH', { stageId: stages['Closed Won'] })).status).toBe(400);
      await call(`/crm/deals/${dealId}/stage`, 'PATCH', { stageId: stages.Qualified });
      expect((await call(`/crm/deals/${dealId}/stage`, 'PATCH', { stageId: stages['Closed Won'] })).status).toBe(400);
      expect((await call('/crm/deals/bulk/stage', 'POST', { dealIds: [dealId], stageId: stages['Closed Won'] })).status).toBe(400);
      await expect(scope(() => resolveImportRow(tenantId, ImportDealRowSchema.parse({ title: 'Cannot import Won', pipeline: pipelineId, stage: stages['Closed Won'] })))).rejects.toThrow('Import into an open stage');
      expect(await prisma.deal.count({ where: { tenantId, title: 'Cannot import Won' } })).toBe(0);
      const foreignFile = await prisma.recordFile.create({ data: { tenantId, dealId: c.deals[1].id, name: 'other.pdf', type: 'application/pdf', size: 10, objectKey: randomUUID(), uploadedById: userId } });
      expect((await call(endpoint, 'PATCH', { values: { 'required-document': foreignFile.id } })).status).toBe(400);
      vi.stubEnv('SUPABASE_URL', 'https://storage.example.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test'); vi.stubEnv('SUPABASE_RECORD_FILES_BUCKET', 'files');
      let uploadFails = true;
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: uploadFails ? 503 : 200 })));
      const upload = () => realFetch(`${base}/crm/deals/${dealId}/files?name=approved.pdf&type=application%2Fpdf`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: '%PDF-1.4\nTest document' });
      expect((await upload()).status).toBe(502);
      expect(await prisma.recordFile.count({ where: { tenantId, dealId } })).toBe(0);
      uploadFails = false;
      const response = await upload(); expect(response.status).toBe(201); const file = (await response.json()).data;
      const close = await call(endpoint, 'PATCH', { values: { 'required-document': file.id } });
      expect(close.status).toBe(200); expect(close.body.data.locked).toBe(true);
      expect(await stageOf(dealId)).toBe('Closed Won'); expect(await stageOf(c.deals[1].id)).toBe('Lead');
      const snapshot = (await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).closingSnapshot;
      expect(snapshot).toMatchObject({ values: { 'required-document': file.id }, files: [{ name: 'approved.pdf' }] });
      await call('/administration/closing-requirements/required-document', 'PATCH', { ...document, name: 'New document label', required: false });
      expect((await prisma.deal.findUniqueOrThrow({ where: { id: dealId } })).closingSnapshot).toEqual(snapshot);
      expect((await call(endpoint, 'PATCH', { values: { 'closing-notes': 'rewrite' } })).status).toBe(400);
    } finally { vi.unstubAllEnvs(); await prisma.closingFieldDefinition.deleteMany({ where: { tenantId } }); await prisma.closingFieldDefinition.createMany({ data: initial.map((field: { id: string }) => ({ tenantId, id: field.id, definition: field })) }); }
  });
});

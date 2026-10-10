import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { EmailAccount } from '@prisma/client';
import prisma from '../../config/database.config';
import { tenantContext } from '../../core/tenant/tenant-context';
import { issueAuthSession } from '../../core/auth/auth-session';
import { encryptToken, decryptToken } from '../../core/encryption/crypto.service';
import { hashToken } from '../../core/auth/session.service';
import { ingestMailboxMessages, evaluateMailboxEngagement } from './mailbox-ingestion.service';
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
import { validateImportRow } from '../../modules/crm/imports/import-rows.service';
import { processBrevoEvent } from '../../modules/marketing/campaigns/brevo-webhook';
import * as dealRepository from '../../modules/crm/deals/deals.repository';

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
    const lead = await prisma.lead.create({ data: { tenantId, assignedUserId: userId, firstName: 'Customer', lastName: 'Test', email, status, productInterest: ['Product'], createdAt: before(180) } });
    const deals = [];
    for (let n = 0; n < dealCount; n++) deals.push(await prisma.deal.create({ data: { tenantId, pipelineId, stageId: stages.Lead, leadDeals: { create: { leadId: lead.id, position: 0 } }, title: `Opportunity ${n}`, value: 3250, assignedUserId: userId, productInterests: ['Product'], tags: [], createdAt: before(180) } }));
    return { lead, deals, email, thread: randomUUID().replaceAll('-', '') };
  }
  const read = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
  const stageOf = async (id: string) => (await prisma.deal.findUniqueOrThrow({ where: { id }, include: { stage: true } })).stage.name;
  const call = async (path: string, method = 'GET', body?: unknown, auth = token) => {
    const response = await realFetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const reviewClosedImport = async () => {
    const product = await prisma.productInterest.create({ data: { tenantId, name: `Import product ${randomUUID()}`, dealValue: 100 } });
    return scope(() => validateImportRow(prisma, 'deals', tenantId, { rowNumber: 2, data: {
      title: 'Cannot import Won', pipeline: pipelineId, stage: stages['Closed Won'], productInterest: product.id,
    } }));
  };
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Mailbox tests', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherTenant = (await prisma.tenant.create({ data: { name: 'Other', slug: randomUUID() } })).id;
    const user = await prisma.user.create({ data: { tenantId, email: 'mailbox-admin@camxian.com', firstName: 'Mail', lastName: 'Owner', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    userId = user.id; token = (await issueAuthSession(user)).token;
    denied = (await issueAuthSession(await prisma.user.create({ data: { tenantId, email: 'denied-mail@camxian.com', firstName: 'Denied', lastName: 'Staff', role: 'Sales', mustChangePassword: false, onboardingCompletedAt: new Date() } }))).token;
    otherStaff = (await issueAuthSession(await prisma.user.create({ data: { tenantId, email: 'other-mail@camxian.com', firstName: 'Other', lastName: 'Staff', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } }))).token;
    account = await prisma.emailAccount.create({ data: { tenantId, userId, email: user.email, accessToken: encryptToken('test-access'), refreshToken: encryptToken('test-refresh'), tokenExpiresAt: new Date(+now + day), scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: before(365), lastSyncAt: now, syncCursor: 'verified-history' } });
    const pipeline = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    pipelineId = pipeline.pipeline.id;
    stages = Object.fromEntries((await prisma.stage.findMany({ where: { tenantId, pipelineId } })).map(stage => [stage.name, stage.id]));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('preserves source timestamps, directions and exact case/whitespace matching; counts generic replies', async () => {
    const c = await customer(1, 'Cold');
    await prisma.lead.update({ where: { id: c.lead.id }, data: { email: ` ${c.email.toUpperCase()} ` } });
    const outbound = message(c.thread, c.email, 'outbound', 'Here is product information.', 9);
    const thanks = message(c.thread, c.email, 'inbound', 'Thanks', 8);
    await ingest([outbound, thanks]);
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    const inbound = message(c.thread, c.email, 'inbound', 'How does the product work?', 7);
    await ingest([inbound]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    const activity = await prisma.activity.findFirstOrThrow({ where: { leadId: c.lead.id, type: 'email', createdAt: new Date(inbound.date) } });
    expect(activity.metadata).toMatchObject({ direction: 'inbound', providerMessageId: inbound.id });
  });
  it('reply wording does not qualify or close a Deal', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'inbound', 'Please send a quotation.', 7)]);
    expect(await stageOf(c.deals[0].id)).toBe('Lead'); expect((await read(c.lead.id)).status).toBe('Hot');
    await ingest([message(c.thread, c.email, 'inbound', 'We approve the quotation and will proceed.', 5)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: c.deals[0].id } })).closedAt).toBeNull();
  });
  it('requires the current Contact email after conversion and preserves original thread history', async () => {
    const c = await customer(2);
    const outbound = message(c.thread, c.email, 'outbound', 'Here is product information.', 9);
    await ingest([outbound]);
    await prisma.mailboxMessage.update({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: outbound.id } }, data: { dealId: c.deals[1].id } });
    const contact = await prisma.contact.create({ data: { tenantId, assignedUserId: userId, firstName: 'Existing', lastName: 'Customer', email: `${randomUUID()}@example.test`, createdAt: before(180) } });
    await scope(() => salesTransaction(async tx => {
      await tx.lead.update({ where: { id: c.lead.id }, data: { status: 'Closed', contactId: contact.id } });
      await convertClosedLead(tx, tenantId, c.lead.id, userId);
    }));
    const oldAliasReply = message(c.thread, c.email, 'inbound', 'Please send a quotation.', 5);
    await ingest([oldAliasReply]);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, providerMessageId: oldAliasReply.id } })).toBe(0);
    const reply = message(c.thread, contact.email!, 'inbound', 'Please send a quotation.', 5);
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
    await prisma.contact.create({ data: { tenantId, assignedUserId: userId, firstName: 'Duplicate', lastName: 'Customer', email: c.email, productInterests: [], activeProducts: [] } });
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
    await scope(() => associateMailboxDeal(tenantId, userId, c.thread, c.deals[1].id));
    expect(await prisma.activity.count({ where: { tenantId, dealId: c.deals[1].id, title: 'Email conversation associated with this Deal' } })).toBe(1);
    const associated = await call(`/integrations/gmail/threads/${c.thread}`);
    expect(associated.body.emails[0].dealId).toBe(c.deals[1].id);
    expect(associated.body.emails[0].needsDealAssociation).toBe(false);
    // Advance the saved association barrier into the past to represent a subsequent real response.
    await prisma.mailboxThreadAssociation.update({ where: { accountId_threadId: { accountId: account.id, threadId: c.thread } }, data: { linkedAt: before(3) } });
    await ingest([message(c.thread, c.email, 'inbound', 'We want to proceed with the product.', 2)]);
    expect(await stageOf(c.deals[0].id)).toBe('Lead'); expect(await stageOf(c.deals[1].id)).toBe('Lead');
    await expect(scope(() => associateMailboxDeal(otherTenant, userId, c.thread, c.deals[0].id))).rejects.toBeDefined();
  });
  it('cancellation wording is still a reply and cannot cancel the customer or Deal', async () => {
    const c = await customer();
    const historyBefore = await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } });
    await ingest([message(c.thread, c.email, 'inbound', 'Please cancel our order.', 4)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    await ingest([message(c.thread, c.email, 'inbound', 'We want to proceed.', 2)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    expect(await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } })).toBe(historyBefore);
  });
  it('makes message ingestion and activity idempotent, including concurrent repeats', async () => {
    const c = await customer(), inbound = message(c.thread, c.email, 'inbound', 'We want to proceed.');
    const historyBefore = await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } });
    await Promise.all([ingest([inbound]), ingest([inbound])]); await ingest([inbound]);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, providerMessageId: inbound.id } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, type: 'email' } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, type: 'stage_change' } })).toBe(1);
    expect(await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } })).toBe(historyBefore);
  });
  it('verified history ages customer status without changing manual Deal stages', async () => {
    const c = await customer();
    await scope(() => updateLead(c.lead.id, tenantId, { status: 'Cold' }, userId, 'Warm'));
    await scope(() => moveDealStage(c.deals[0].id, tenantId, stages.Qualified, userId));
    await ingest([message(c.thread, c.email, 'outbound', 'Product information', 9), message(c.thread, c.email, 'inbound', 'How does the product work?', 8)]);
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Qualified');
  });
  it('validates configured requirements, closes after the final save, and preserves related sales data', async () => {
    const c = await customer();
    const historyBefore = await prisma.dealStageHistory.count({ where: { dealId: c.deals[0].id } });
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
    expect(await prisma.dealStageHistory.count({ where: { dealId: deal.id } })).toBe(historyBefore + 2);
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
  it('decays with fresh coverage, pauses with stale coverage and ignores outbound followups', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'inbound', 'Thanks', 7)]);
    expect((await read(c.lead.id)).status).toBe('Hot');
    const future = new Date(+now + 24 * day);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: before(2) } });
    await scope(() => evaluateMailboxEngagement(account, permissions, future));
    expect((await read(c.lead.id)).status).toBe('Hot');
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: future } });
    await scope(() => evaluateMailboxEngagement(account, permissions, future));
    expect((await read(c.lead.id)).status).toBe('Cold');
    await ingest([message(c.thread, c.email, 'outbound', 'Follow-up', 0)]);
    expect((await read(c.lead.id)).lastCustomerReplyAt).toEqual(before(7));
    expect((await read(c.lead.id)).firstUnansweredOutboundAt).toBeNull();
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: now } });
  });
  it('never-replied customers age from first outbound and no-history customers retain status', async () => {
    const fresh = await customer(0, 'Warm'), waiting = await customer(0, 'Cold'), overdue = await customer(0);
    await ingest([message(waiting.thread, waiting.email, 'outbound', 'Hello', 10), message(waiting.thread, waiting.email, 'outbound', 'Again', 1), message(overdue.thread, overdue.email, 'outbound', 'Hello', 30)]);
    await scope(() => evaluateMailboxEngagement(account, permissions, now));
    expect((await read(fresh.lead.id)).status).toBe('Warm');
    expect((await read(waiting.lead.id)).status).toBe('Warm');
    expect((await read(waiting.lead.id)).firstUnansweredOutboundAt).toEqual(before(10));
    expect((await read(overdue.lead.id)).status).toBe('Cold');
    const reply = message(overdue.thread, overdue.email, 'inbound', 'Noted', 0);
    await ingest([{ ...reply, automated: true }]);
    expect((await read(overdue.lead.id)).lastCustomerReplyAt).toBeNull();
    await ingest([{ ...reply, id: randomUUID(), automated: false }]);
    expect((await read(overdue.lead.id)).status).toBe('Hot');
  });
  it('creates a complete priced Deal set once across concurrent retries and preserves relationships', async () => {
    const c = await customer(0);
    const agent = await prisma.user.create({ data: { tenantId, email: `batch-agent-${randomUUID()}@camxian.com`, firstName: 'Batch', lastName: 'Agent', role: 'Sales', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: `Batch sales ${randomUUID()}` } });
    await prisma.rolePermission.createMany({ data: ['leads', 'deals'].map(module => ({ tenantId, roleId: role.id, module, canView: true, canEdit: true })) });
    await prisma.userRole.create({ data: { tenantId, userId: agent.id, roleId: role.id } });
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Linked', lastName: 'Contact', email: `${randomUUID()}@example.test` } });
    const accountRecord = await prisma.account.create({ data: { tenantId, name: 'Batch account', tags: [] } });
    const products = await Promise.all([25000, 15000].map((value, index) => prisma.productInterest.create({ data: { tenantId, name: `Batch product ${index} ${randomUUID()}`, dealValue: value } })));
    const dto = { idempotencyKey: randomUUID(), title: 'Installation', pipelineId, stageId: stages.Lead,
      productInterestIds: products.map(p => p.id), leadIds: [c.lead.id], contactIds: [contact.id], accountId: accountRecord.id,
      assignedUserId: agent.id, industry: 'Technology', address: '123 Main Street', priority: 'HIGH', leadSource: 'Referral', expectedCloseDate: '2026-12-01T00:00:00.000Z' };
    const responses = await Promise.all([call('/crm/deals/batch', 'POST', dto), call('/crm/deals/batch', 'POST', dto)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    const created = responses[0].body.data.deals;
    expect(created).toHaveLength(2);
    expect(responses[1].body.data.deals.map((d: {id: string}) => d.id)).toEqual(created.map((d: {id: string}) => d.id));
    for (const [index, deal] of created.entries()) {
      expect(deal).toMatchObject({ productInterestId: products[index].id, value: index ? 15000 : 25000, accountId: accountRecord.id,
        industry: 'Technology', address: dto.address, assignedUserId: agent.id, priority: 'HIGH', stageId: stages.Lead,
        title: `Installation — ${products[index].name}` });
      expect(await prisma.leadDeal.count({ where: { tenantId, dealId: deal.id, leadId: c.lead.id } })).toBe(1);
      expect(await prisma.contactDeal.count({ where: { tenantId, dealId: deal.id, contactId: contact.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { tenantId, entityId: deal.id, action: 'deal.created' } })).toBe(1);
    }
    await prisma.productInterest.update({ where: { id: products[0].id }, data: { dealValue: 99999 } });
    expect((await call('/crm/deals/batch', 'POST', dto)).body.data.deals[0].value).toBe(25000);
    expect((await call('/crm/deals/batch', 'POST', { ...dto, title: 'Changed' })).status).toBe(409);
    const invalid = { ...dto, idempotencyKey: randomUUID(), productInterestIds: [products[0].id, randomUUID()] };
    expect((await call('/crm/deals/batch', 'POST', invalid)).status).toBe(400);
    expect(await prisma.dealCreationReceipt.count({ where: { tenantId, idempotencyKey: invalid.idempotencyKey } })).toBe(0);
    expect(await prisma.deal.count({ where: { tenantId, leadDeals: { some: { leadId: c.lead.id } } } })).toBe(2);
    expect((await call('/crm/deals/batch', 'POST', { ...dto, idempotencyKey: randomUUID(), industry: 'Made up' })).status).toBe(400);
    expect((await call('/crm/deals/batch', 'POST', { ...dto, idempotencyKey: randomUUID(), stageId: stages['Closed Won'] })).status).toBe(400);
    expect((await call('/crm/deals/batch', 'POST', { ...dto, idempotencyKey: randomUUID() }, denied)).status).toBe(403);
    const foreignProduct = await prisma.productInterest.create({ data: { tenantId: otherTenant, name: 'Foreign', dealValue: 100 } });
    expect((await call('/crm/deals/batch', 'POST', { ...dto, idempotencyKey: randomUUID(), productInterestIds: [foreignProduct.id] })).status).toBe(400);
  });
  it('retains the newest reply across mailboxes and delayed sync, with Contact aging after recovery', async () => {
    const contact = await prisma.contact.create({ data: { tenantId, assignedUserId: userId, firstName: 'Reply', lastName: 'Contact', email: `${randomUUID()}@example.test`, status: 'COLD' } });
    const reply = message(randomUUID(), contact.email!, 'inbound', 'Anything at all', 2);
    await ingest([reply]);
    const owner = await prisma.user.create({ data: { tenantId, firstName: 'Second', lastName: 'Mailbox', email: `${randomUUID()}@camxian.com`, role: 'Client Admin' } });
    const second = await prisma.emailAccount.create({ data: { tenantId, userId: owner.id, email: owner.email, accessToken: encryptToken('test'), lastSyncAt: now, syncCursor: 'verified-history' } });
    await prisma.contact.update({ where: { id: contact.id }, data: { assignedUserId: owner.id } });
    await scope(() => ingestMailboxMessages(second, [{ ...message(reply.threadId, contact.email!, 'inbound', 'Older wording', 20), to: [second.email] }], permissions));
    await prisma.contact.update({ where: { id: contact.id }, data: { assignedUserId: userId } });
    const snapshot = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(snapshot.status).toBe('HOT'); expect(snapshot.lastCustomerReplyAt).toEqual(before(2));
    await ingest([message(reply.threadId, contact.email!, 'outbound', 'Follow up', 1), reply]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).lastCustomerReplyAt).toEqual(before(2));
    const future = new Date(+now + 31 * day);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: future } });
    await scope(() => evaluateMailboxEngagement(account, permissions, future));
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe('HOT');
    await prisma.emailAccount.update({ where: { id: second.id }, data: { lastSyncAt: future } });
    await scope(() => evaluateMailboxEngagement(account, permissions, future));
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).status).toBe('COLD');
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: now } });
  });
  it('keeps campaign delivery, opens and clicks outside customer engagement', async () => {
    const c = await customer(0, 'Cold');
    await ingest([message(c.thread, c.email, 'outbound', 'Hello', 40)]);
    const baseline = await read(c.lead.id);
    const campaign = await prisma.campaign.create({ data: { tenantId, name: 'Tracking only', type: 'EMAIL' } });
    const log = await prisma.emailDeliveryLog.create({ data: { tenantId, campaignId: campaign.id, leadId: c.lead.id,
      fromEmail: account.email, toEmail: c.email, subject: 'Tracking', status: 'sent', brevoMessageId: randomUUID() } });
    for (const event of ['delivered', 'opened', 'click']) await processBrevoEvent({ event, email: c.email, 'message-id': log.brevoMessageId, ts_event: Math.floor(now.getTime() / 1000) });
    const after = await read(c.lead.id);
    expect(after.status).toBe('Cold'); expect(after.lastCustomerReplyAt).toBeNull();
    expect(after.firstUnansweredOutboundAt).toEqual(baseline.firstUnansweredOutboundAt);
  });
  it('preserves single titles, creates three independent Deals, and rolls back a failure after the first insert', async () => {
    const products = await Promise.all([11, 22, 33].map((value, index) => prisma.productInterest.create({ data: { tenantId, name: `Set ${index} ${randomUUID()}`, dealValue: value } })));
    const dto = { idempotencyKey: randomUUID(), pipelineId, stageId: stages.Lead, title: 'Original title', productInterestIds: [products[0].id] };
    const single = await call('/crm/deals/batch', 'POST', dto);
    expect(single.body.data.deals[0]).toMatchObject({ title: dto.title, value: 11 });
    const three = await call('/crm/deals/batch', 'POST', { ...dto, idempotencyKey: randomUUID(), title: 'A'.repeat(255), productInterestIds: products.map(p => p.id) });
    expect(three.body.data.deals).toHaveLength(3);
    for (const [index, deal] of three.body.data.deals.entries()) {
      expect(deal.title).toHaveLength(255); expect(deal.title.endsWith(` — ${products[index].name}`)).toBe(true);
    }
    const count = await prisma.deal.count({ where: { tenantId } }), audits = await prisma.auditLog.count({ where: { tenantId, action: 'deal.created' } });
    const original = dealRepository.createDeal;
    let calls = 0;
    const failing = vi.spyOn(dealRepository, 'createDeal').mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('Test failure after first insertion');
      return original(...args);
    });
    const key = randomUUID();
    try { expect((await call('/crm/deals/batch', 'POST', { ...dto, idempotencyKey: key, productInterestIds: products.map(p => p.id) })).status).toBe(500); }
    finally { failing.mockRestore(); }
    expect(await prisma.deal.count({ where: { tenantId } })).toBe(count);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'deal.created' } })).toBe(audits);
    expect(await prisma.dealCreationReceipt.count({ where: { tenantId, idempotencyKey: key } })).toBe(0);
  });
  it('runs only configured status workflows and resolves one related Product Deal', async () => {
    const c = await customer(2, 'Cold');
    const product = await prisma.productInterest.create({ data: { tenantId, name: `Workflow product ${randomUUID()}`, dealValue: 100 } });
    await prisma.deal.update({ where: { id: c.deals[1].id }, data: { productInterestId: product.id } });
    const workflow = await prisma.workflow.create({ data: { tenantId, name: `Reply workflow ${randomUUID()}`, trigger: 'lead.status_changed', isActive: true, status: 'ACTIVE', activatedById: userId,
      conditions: { operator: 'AND', conditions: [{ field: 'lead.email', operator: 'equals', value: c.email }, { field: 'lead.status', operator: 'equals', value: 'Hot' }] },
      actions: [{ type: 'move_deal_stage', config: { stageId: stages.Contacted, currentStageId: stages.Lead, productInterestId: product.id } }] } });
    try {
      const definitions = await prisma.closingFieldDefinition.count({ where: { tenantId } });
      const preview = await call(`/automation/workflows/${workflow.id}/test`, 'POST', { entityId: c.lead.id });
      expect(preview.status).toBe(200); expect(preview.body.data.actions[0].message).toContain(c.deals[1].id);
      expect(await stageOf(c.deals[1].id)).toBe('Lead');
      expect(await prisma.closingFieldDefinition.count({ where: { tenantId } })).toBe(definitions);
      const reply = message(c.thread, c.email, 'inbound', 'Thanks', 0);
      await ingest([reply]); await ingest([reply]);
      expect(await stageOf(c.deals[0].id)).toBe('Lead');
      expect(await prisma.workflowExecutionRun.findFirst({ where: { workflowId: workflow.id }, include: { steps: true } })).toMatchObject({ status: 'completed' });
      expect(await stageOf(c.deals[1].id)).toBe('Contacted');
      expect(await prisma.workflowExecutionRun.count({ where: { tenantId, workflowId: workflow.id, status: 'completed' } })).toBe(1);
    } finally { await prisma.workflow.update({ where: { id: workflow.id }, data: { isActive: false } }); }
  });
  it('requires Deal access for related Workflow previews and supports Contact junction targeting', async () => {
    const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Workflow', lastName: 'Contact', email: `${randomUUID()}@example.test` } });
    const c = await customer();
    await prisma.contactDeal.create({ data: { tenantId, dealId: c.deals[0].id, contactId: contact.id, position: 0 } });
    const workflow = await prisma.workflow.create({ data: { tenantId, name: `Contact preview ${randomUUID()}`, trigger: 'contact.status_changed', actions: [{ type: 'move_deal_stage', config: { stageId: stages.Contacted } }] } });
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: `Preview reader ${randomUUID()}`, permissions: { create: [{ module: 'workflows', canView: true }, { module: 'contacts', canView: true }] } } });
    const viewer = await prisma.user.create({ data: { tenantId, firstName: 'Preview', lastName: 'Reader', email: `${randomUUID()}@camxian.com`, role: role.name, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    await prisma.userRole.create({ data: { tenantId, roleId: role.id, userId: viewer.id } });
    const viewerToken = (await issueAuthSession(viewer)).token;
    expect((await call(`/automation/workflows/${workflow.id}/test`, 'POST', { entityId: contact.id }, viewerToken)).status).toBe(403);
    const allowed = await call(`/automation/workflows/${workflow.id}/test`, 'POST', { entityId: contact.id });
    expect(allowed.status).toBe(200); expect(allowed.body.data.actions[0].message).toContain(c.deals[0].id);
    expect(await stageOf(c.deals[0].id)).toBe('Lead');
    const { dispatchAction } = await import('../../modules/automation/actions/action-dispatcher');
    expect(await scope(() => dispatchAction({ type: 'move_deal_stage', config: { stageId: stages.Contacted } }, { 'contact.id': contact.id }, tenantId, userId))).toMatchObject({ success: true });
    expect(await stageOf(c.deals[0].id)).toBe('Contacted');
  });
  it('requires explicit all-matching targeting and never bypasses Closed Won requirements', async () => {
    const { dispatchAction } = await import('../../modules/automation/actions/action-dispatcher');
    const c = await customer(2);
    const context = { 'lead.id': c.lead.id };
    const run = (config: Record<string, unknown>) => scope(() => dispatchAction({ type: 'move_deal_stage', config }, context, tenantId, userId));
    expect((await run({ stageId: stages.Contacted })).success).toBe(false);
    expect(await stageOf(c.deals[0].id)).toBe('Lead');
    const all = await run({ stageId: stages.Qualified, targetMode: 'all_matching', currentStageId: stages.Lead });
    expect(all, JSON.stringify(all)).toMatchObject({ success: true }); expect(all.output?.movedDealIds).toHaveLength(2);
    const blocked = await run({ stageId: stages['Closed Won'], targetMode: 'all_matching' });
    expect(blocked.success).toBe(false); expect(await stageOf(c.deals[0].id)).toBe('Qualified');
    const none = await run({ stageId: stages.Contacted, currentStageId: stages.Lead });
    expect(none).toMatchObject({ success: true, output: { matchedDealIds: [], unchanged: true } });
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
    expect((await reviewClosedImport()).errors.join()).toContain('Import into an open stage');
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
    const c = await customer(0);
    await ingest([{ ...message('thread', c.email, 'inbound', 'Question'), id: 'replyid', rfcMessageId: '<original@example.test>' }]);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/send')) { bodies.push(JSON.parse(String(init?.body))); return Response.json({ id: 'sentid', threadId: 'thread' }); }
      return Response.json({ id: 'replyid', threadId: 'thread', internalDate: String(+before(1)), labelIds: ['INBOX'], snippet: '', payload: { headers: [{ name: 'Message-ID', value: '<original@example.test>' }], mimeType: 'text/plain', body: { data: Buffer.from('Product question').toString('base64url') } } });
    }));
    await scope(() => sendEmail(tenantId, userId, c.email, 'Re: Product inquiry', '<p>Details</p>', 'replyid'));
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
      if (path.includes('drafts?')) return Response.json({ drafts: [] });
      if (path.includes('messages?')) return path.includes('pageToken=next') ? Response.json({ messages: [] }) : Response.json({ messages: [{ id: inbound.id }], nextPageToken: 'next' });
      return Response.json(apiMessage);
    }));
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncCursor: null, syncPageToken: null } });
    expect((await scope(() => syncMailbox(tenantId, userId))).hasMore).toBe(true);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBeNull();
    let remaining = true;
    for (let pass = 0; pass < 100 && remaining; pass++) remaining = (await scope(() => syncMailbox(tenantId, userId))).hasMore;
    expect(remaining).toBe(false);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBe('100');
    await scope(() => syncMailbox(tenantId, userId)); expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBe('102');
    expire = true;
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncRequestedAt: new Date() } });
    await scope(() => syncMailbox(tenantId, userId)); expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBeNull();
    expect(await prisma.mailboxMessage.count({ where: { providerMessageId: inbound.id } })).toBe(1);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncCursor: '102', syncPageToken: null, syncBaselineHistoryId: null, lastSyncAt: new Date(), syncError: null } });
  });

  it('re-evaluates previously stored quotation requests without duplicating history or changing another Deal', async () => {
    const c = await customer(), unrelated = await customer();
    const request = message(c.thread, c.email, 'inbound', 'Please send me the formal quotation and let me know the next steps if we decide to proceed.', 5);
    await ingest([request]);
    await prisma.deal.update({ where: { id: c.deals[0].id }, data: { stageId: stages.Contacted, stageChangedAt: before(6) } });
    await prisma.lead.update({ where: { id: c.lead.id }, data: { engagementEvaluatedAt: before(2), status: 'Warm' } });
    await prisma.mailboxMessage.update({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: request.id } }, data: { engagementRuleVersion: 0, meaningful: true } });
    await ingest([request]); await ingest([request]);
    expect(await stageOf(c.deals[0].id)).toBe('Contacted');
    expect(await stageOf(unrelated.deals[0].id)).toBe('Lead');
    expect((await read(c.lead.id)).status).toBe('Hot');
    expect(await prisma.activity.count({ where: { leadId: c.lead.id, type: 'email' } })).toBe(1);
    const history = await call(`/crm/activities?leadId=${c.lead.id}`);
    expect(history.body.data.find((a: { type: string }) => a.type === 'email').metadata.email).toMatchObject({ body: request.body, from: request.from, to: request.to, subject: request.subject, sentAt: request.date });
  });

  it('keeps outbound Warm and every genuine recent reply Hot without moving Deals', async () => {
    const c = await customer();
    await ingest([message(c.thread, c.email, 'outbound', 'We approve the quotation. Please proceed with the order.', 8)]);
    expect((await read(c.lead.id)).status).toBe('Warm'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    await ingest([message(c.thread, c.email, 'inbound', 'Could you please send me the available options and a quotation?', 7)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
    await ingest([message(c.thread, c.email, 'inbound', 'I am still deciding on the service.', 6)]);
    expect((await read(c.lead.id)).status).toBe('Hot');
    await ingest([message(c.thread, c.email, 'inbound', 'The quotation is acceptable.', 5)]);
    expect((await read(c.lead.id)).status).toBe('Hot'); expect(await stageOf(c.deals[0].id)).toBe('Lead');
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
    const foreignUser = await prisma.user.create({ data: { tenantId: otherTenant, email: `${randomUUID()}@camxian.com`, firstName: 'Other', lastName: 'Admin', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
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
      expect((await reviewClosedImport()).errors.join()).toContain('Import into an open stage');
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
    } finally { vi.unstubAllEnvs(); /* The disposable database preserves referenced field definitions until teardown. */ }
  });
});

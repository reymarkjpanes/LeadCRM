import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { EmailAccount, Prisma } from '@prisma/client';
import prisma from '../../config/database.config';
import app from '../../app';
import { tenantContext } from '../../core/tenant/tenant-context';
import { issueAuthSession } from '../../core/auth/auth-session';
import { encryptToken } from '../../core/encryption/crypto.service';
import { ingestMailboxMessages } from './mailbox-ingestion.service';
import { resolveMailboxScope, mailboxAddress, mailboxProviderQueries } from './mailbox-scope';
import { syncMailbox } from './mailbox-sync.service';
import { scheduleMailboxEmail, runScheduledMailboxEmails, scheduleMessageId } from './scheduled-mailbox.service';
import { fetchEmails, sendEmailWithToken, parseGmailMessage } from './gmail.service';
import type { GmailEmail } from './gmail.types';
import { salesPipeline, salesTransaction } from '../../modules/crm/leads/lead-automation.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = url.hostname === '127.0.0.1' && /^\/leadcrm_mailbox_test_\d+$/.test(url.pathname);
const permissions = { leadsView: true, contactsView: true, leadsEdit: true, contactsEdit: true, dealsEdit: true, dealsView: true };
describe.skipIf(!disposable)('scoped persisted mailbox, incremental sync and scheduled delivery', () => {
  let tenantId: string, userId: string, otherId: string, token: string, account: EmailAccount, server: Server, base: string;
  let leadEmail: string, contactEmail: string, leadId: string;
  const realFetch = globalThis.fetch;
  const scope = <T>(fn: () => T) => tenantContext.run({ tenantId }, fn);
  const mail = (from: string, id = randomUUID().replaceAll('-', ''), labels = ['INBOX', 'UNREAD']): GmailEmail => ({ id, threadId: id, from, to: [account.email], subject: 'Electric Fence inquiry', body: '<p>Customer question</p>', snippet: 'Customer question', date: new Date(Date.now() - 1000).toISOString(), labels, isRead: !labels.includes('UNREAD') });
  const apiMail = (email: GmailEmail, extra: { name: string; value: string }[] = []) => ({ id: email.id, threadId: email.threadId, labelIds: email.labels, snippet: email.snippet, internalDate: String(Date.parse(email.date)), payload: { headers: [{ name: 'From', value: email.from }, { name: 'To', value: email.to.join(', ') }, { name: 'Subject', value: email.subject }, ...extra], mimeType: 'text/html', body: { data: Buffer.from(email.body).toString('base64url') } } });
  const persistHistorical = (email: GmailEmail, extra: Partial<Prisma.MailboxMessageUncheckedCreateInput> = {}) => prisma.mailboxMessage.create({ data: {
    tenantId, accountId: account.id, providerMessageId: email.id, threadId: email.threadId, from: email.from, fromAddress: mailboxAddress(email.from)!,
    recipients: email.to, recipientAddresses: email.to, direction: email.from === account.email ? 'outbound' : 'inbound', subject: email.subject,
    body: email.body, snippet: email.snippet, sentAt: new Date(email.date), labels: email.labels, draftId: email.draftId, ...extra,
  } });
  const call = async (path: string, method = 'GET', body?: unknown, authorization = `Bearer ${token}`) => {
    const response = await realFetch(base + path, { method, headers: { Authorization: authorization, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: response.status === 204 ? undefined : await response.json() };
  };
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Scoped mail tests', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    otherId = (await prisma.user.create({ data: { tenantId, email: `other-${randomUUID()}@camxian.com`, firstName: 'Other', lastName: 'Agent', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } })).id;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/integrations/gmail`;
  });
  beforeEach(async () => {
    const user = await prisma.user.create({ data: { tenantId, email: `scope-${randomUUID()}@camxian.com`, firstName: 'Inbox', lastName: 'Agent', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    userId = user.id; token = (await issueAuthSession(user)).token;
    account = await prisma.emailAccount.create({ data: { tenantId, userId, email: user.email, accessToken: encryptToken(randomUUID()), tokenExpiresAt: new Date(Date.now() + 3600000), scopes: ['https://www.googleapis.com/auth/gmail.modify'] } });
    leadEmail = `lead-${randomUUID()}@example.test`; contactEmail = `contact-${randomUUID()}@example.test`;
    leadId = (await prisma.lead.create({ data: { tenantId, assignedUserId: userId, email: ` Customer <${leadEmail.toUpperCase()}> `, firstName: 'Lead', lastName: 'Customer', productInterest: [] } })).id;
    await prisma.contact.create({ data: { tenantId, assignedUserId: userId, email: contactEmail, firstName: 'Contact', lastName: 'Customer', activeProducts: [], productInterests: [] } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it.each(['', '   '])('rejects an unconfigured legacy sender before contacting Gmail (%j)', async value => {
    vi.stubEnv('SMTP_FROM', value); vi.stubEnv('GMAIL_SYSTEM_SENDER_GMAIL_EMAIL', value);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    await expect(sendEmailWithToken('test-token', leadEmail, 'Inquiry', '<p>Hello</p>')).rejects.toMatchObject({ message: 'Gmail sender is not configured.', statusCode: 503 });
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(['SMTP_FROM', 'GMAIL_SYSTEM_SENDER_GMAIL_EMAIL'])('uses the explicitly configured Camxian sender from %s', async key => {
    vi.stubEnv('SMTP_FROM', ''); vi.stubEnv('GMAIL_SYSTEM_SENDER_GMAIL_EMAIL', '');
    vi.stubEnv(key, key === 'SMTP_FROM' ? 'Camxian Technologies <info@camxian.com>' : 'info@camxian.com');
    const provider = vi.fn(async () => Response.json({ id: 'system-sent', threadId: 'system-thread' })); vi.stubGlobal('fetch', provider);
    await sendEmailWithToken('test-token', leadEmail, 'Inquiry', '<p>Hello</p>');
    const [, init] = (provider.mock.calls as unknown as [string, RequestInit][])[0];
    const raw = Buffer.from(JSON.parse(String(init.body)).raw, 'base64url').toString();
    expect(raw.split('\r\n')[0]).toBe('From: Camxian Technologies <info@camxian.com>');
  });
  it('uses exact normalized fixed senders and current Lead/Contact assignments', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail), mail(contactEmail), mail('Info <INFO@CAMXIAN.COM>'), mail('reymarkjpanes@12066156.brevosend.com'), mail('sales@camxian.com'), mail('admin@camxian.com'), mail('jobs@camxian.com'), mail('bank@example.com'), mail('other@camxian.com'), mail('other@12066156.brevosend.com'), mail('someoneelse@12066156.brevosend.com'), mail('LinkedIn <jobs@linkedin.com>')], permissions));
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const result = await call('/emails');
    expect(result.status).toBe(200); expect(result.body.emails).toHaveLength(4); expect(result.body.unreadCount).toBe(4); expect(result.cache).toBe('no-store');
    expect(provider).not.toHaveBeenCalled();
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(4);
  });
  it('keeps empty assignments restricted to the two exact fixed senders', async () => {
    await prisma.lead.updateMany({ where: { tenantId, assignedUserId: userId }, data: { assignedUserId: null } });
    await prisma.contact.updateMany({ where: { tenantId, assignedUserId: userId }, data: { assignedUserId: null } });
    await scope(() => ingestMailboxMessages(account, [mail('info@camxian.com', 'fixed-info'), mail('reymarkjpanes@12066156.brevosend.com', 'fixed-brevo'), mail(leadEmail), mail(contactEmail), mail('bank@example.com')], permissions));
    expect((await call('/emails')).body.emails.map((row: GmailEmail) => row.id).sort()).toEqual(['fixed-brevo', 'fixed-info']);
    expect((await call('/unread-count')).body.unreadCount).toBe(2);
    const resolved = await resolveMailboxScope(account, permissions);
    expect(resolved.addresses).toEqual([]);
    expect(mailboxProviderQueries(resolved)).toEqual(['-in:spam -in:trash {from:reymarkjpanes@12066156.brevosend.com from:info@camxian.com to:reymarkjpanes@12066156.brevosend.com to:info@camxian.com}']);
  });
  it('does not elevate historical CRM links or unrelated participants into provider or thread scope', async () => {
    await persistHistorical({ ...mail(account.email, 'legacy-bank', ['SENT']), to: ['bank@example.com'] }, { leadId });
    await persistHistorical(mail('bank@example.com', 'legacy-bank-reply'), { leadId });
    const resolved = await resolveMailboxScope(account, permissions);
    expect(resolved.threadRecipients).toEqual({});
    expect(mailboxProviderQueries(resolved).join(' ')).not.toContain('bank@example.com');
    for (const query of ['', '?filter=sent', '?query=Electric%20Fence']) expect((await call('/emails' + query)).body.emails).toHaveLength(0);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await call('/threads/legacy-bank')).status).toBe(404);
    expect((await call('/archive', 'POST', { messageIds: ['legacy-bank'] })).status).toBe(404);
    expect((await call('/send', 'POST', { to: 'bank@example.com', subject: 'Reply', body: 'Hello', replyToMessageId: 'legacy-bank' })).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(2);
  });
  it('does not ingest or expose personal drafts merely authored using a fixed sender alias', async () => {
    const draft = { ...mail('info@camxian.com', 'alias-draft', ['DRAFT']), to: ['bank@example.com'], draftId: 'alias-draft-id' };
    await scope(() => ingestMailboxMessages(account, [draft], permissions));
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(0);
    await persistHistorical(draft);
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(0);
    expect((await resolveMailboxScope(account, permissions)).fixedThreadIds).toEqual([]);
  });
  it.each(['lead', 'contact'] as const)('does not grant another mailbox access to an assigned %s, then honors reassignment', async module => {
    const email = module === 'lead' ? leadEmail : contactEmail;
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    const otherAccount = await prisma.emailAccount.upsert({ where: { tenantId_userId_provider: { tenantId, userId: otherId, provider: 'gmail' } }, update: {}, create: { tenantId, userId: otherId, email: otherUser.email, accessToken: encryptToken('test-only'), tokenExpiresAt: new Date(Date.now() + 3600000), scopes: ['https://www.googleapis.com/auth/gmail.modify'] } });
    const incoming = mail(email, randomUUID());
    const otherIncoming = { ...incoming, to: [otherAccount.email] };
    await scope(() => ingestMailboxMessages(account, [incoming], permissions));
    await scope(() => ingestMailboxMessages(otherAccount, [otherIncoming], permissions));
    const authorization = `Bearer ${(await issueAuthSession(otherUser)).token}`;
    expect((await call('/threads/' + incoming.threadId)).status).toBe(200);
    expect((await call('/threads/' + incoming.threadId, 'GET', undefined, authorization)).status).toBe(404);
    if (module === 'lead') await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    else await prisma.contact.updateMany({ where: { tenantId, assignedUserId: userId }, data: { assignedUserId: otherId } });
    await scope(() => ingestMailboxMessages(otherAccount, [otherIncoming], permissions));
    expect((await call('/threads/' + incoming.threadId)).status).toBe(404);
    expect((await call('/threads/' + incoming.threadId, 'GET', undefined, authorization)).status).toBe(200);
  });
  it.each(['lead', 'contact'] as const)('revokes %s correspondence after its email changes or becomes invalid', async module => {
    const email = module === 'lead' ? leadEmail : contactEmail;
    await scope(() => ingestMailboxMessages(account, [mail(email, 'old-address'), { ...mail(account.email, 'old-sent', ['SENT']), to: [email] }], permissions));
    for (const replacement of ['new-customer@example.com', 'not an email', '']) {
      if (module === 'lead') await prisma.lead.update({ where: { id: leadId }, data: { email: replacement } });
      else await prisma.contact.updateMany({ where: { tenantId, assignedUserId: userId }, data: { email: replacement } });
      expect((await call('/emails')).body.emails).toHaveLength(0);
      expect((await call('/threads/old-sent')).status).toBe(404);
      const resolved = await resolveMailboxScope(account, permissions);
      expect(mailboxProviderQueries(resolved).join(' ')).not.toContain(email);
      expect(resolved.threadRecipients).toEqual({});
      if (replacement !== 'new-customer@example.com') expect(module === 'lead' ? resolved.leadIds : resolved.contactIds).toEqual([]);
    }
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(2);
  });
  it('does not retain mailbox access through a converted Lead after its Contact is reassigned', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'converted-customer')], permissions));
    const contact = await prisma.contact.findFirstOrThrow({ where: { tenantId, assignedUserId: userId } });
    await prisma.contact.update({ where: { id: contact.id }, data: { email: leadEmail } });
    await prisma.lead.update({ where: { id: leadId }, data: { convertedAt: new Date(), contactId: contact.id } });
    expect((await call('/threads/converted-customer')).status).toBe(200);
    await prisma.contact.update({ where: { id: contact.id }, data: { assignedUserId: otherId } });
    expect((await call('/threads/converted-customer')).status).toBe(404);
    expect((await call('/emails')).body.emails).toHaveLength(0);
    const resolved = await resolveMailboxScope(account, permissions);
    expect(resolved.leadIds).toEqual([]); expect(resolved.addresses).toEqual([]);
    expect(mailboxProviderQueries(resolved).join(' ')).not.toContain(leadEmail);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(1);
  });
  it.each(['unassigned', 'archived'])('removes %s Contacts from current read and mutation scope', async state => {
    await scope(() => ingestMailboxMessages(account, [mail(contactEmail, 'contact-revoked')], permissions));
    const before = await prisma.activity.count({ where: { tenantId, createdById: userId, type: 'email' } });
    await prisma.contact.updateMany({ where: { tenantId, assignedUserId: userId }, data: state === 'archived' ? { isArchived: true } : { assignedUserId: null } });
    expect((await call('/emails')).body.emails).toHaveLength(0);
    expect((await call('/unread-count')).body.unreadCount).toBe(0);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await call('/threads/contact-revoked')).status).toBe(404);
    for (const action of ['archive', 'trash']) expect((await call('/threads/contact-revoked/' + action, 'POST', {})).status).toBe(404);
    expect((await call('/send', 'POST', { to: contactEmail, subject: 'Reply', body: 'Hello', replyToMessageId: 'contact-revoked' })).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
    expect(await prisma.activity.count({ where: { tenantId, createdById: userId, type: 'email' } })).toBe(before);
  });
  it.each(['assigned recipient', 'empty recipient'])('hides retained source drafts with an %s after source access is revoked', async kind => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'forward-source')], permissions));
    const draft = { ...mail(account.email, 'forward-draft', ['DRAFT']), to: kind === 'assigned recipient' ? [contactEmail] : [], draftId: 'forward-draft-id' };
    await persistHistorical(draft, { crmDraft: true, sourceMessageId: 'forward-source' });
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(1);
    const scheduled = await prisma.scheduledMailboxEmail.create({ data: { tenantId, accountId: account.id, createdById: userId, requestId: randomUUID(), draftId: draft.draftId, recipients: draft.to, subject: 'Source content', scheduledAt: new Date(0), status: 'pending' } });
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(1);
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(0);
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(0);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await call('/drafts/' + draft.draftId, 'DELETE')).status).toBe(404);
    expect((await call('/drafts', 'POST', { draftId: draft.draftId, to: contactEmail, subject: 'Forward', body: 'Hello' })).status).toBe(404);
    await runScheduledMailboxEmails(); expect(provider).not.toHaveBeenCalled();
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: scheduled.id } })).status).toBe('failed');
    const resolved = await resolveMailboxScope(account, permissions);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncScopeHash: resolved.hash, syncCursor: '100', syncRequestedAt: new Date() } });
    provider.mockImplementation(async (input: string | URL) => String(input).includes('/history?') ? Response.json({ historyId: '110', history: [{ messagesAdded: [{ message: { id: draft.id } }] }] }) : Response.json(apiMail(draft)));
    await scope(() => syncMailbox(tenantId, userId));
    expect(provider.mock.calls.some(([path]) => String(path).includes('format=full'))).toBe(false);
    if (kind === 'assigned recipient') {
      // A Gmail edit replaces the message ID but retains the actual draft ID.
      const replacement = { ...draft, id: 'replacement-draft-message' };
      await prisma.emailAccount.update({ where: { id: account.id }, data: { syncRequestedAt: new Date() } });
      provider.mockClear();
      provider.mockImplementation(async (input: string | URL) => {
        const path = String(input);
        if (path.includes('/history?')) return Response.json({ historyId: '120', history: [{ messagesAdded: [{ message: { id: replacement.id } }] }] });
        if (path.includes('/drafts?')) return Response.json({ drafts: [{ id: draft.draftId, message: { id: replacement.id } }] });
        return Response.json(apiMail(replacement, [{ name: 'Message-ID', value: '<replacement@example.test>' }]));
      });
      await scope(() => syncMailbox(tenantId, userId));
      expect(provider.mock.calls.some(([path]) => String(path).includes('format=full'))).toBe(false);
      expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, providerMessageId: replacement.id } })).toBe(0);
    }
    await scope(() => ingestMailboxMessages(account, [{ ...draft, body: 'Replaced private source' }], permissions));
    expect((await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: draft.id } } })).body).toBe(draft.body);
  });
  it('excludes historical unrelated mail without deleting it; search cannot expand scope', async () => {
    const unrelated = mail('bank@example.test', 'oldbank');
    await prisma.mailboxMessage.create({ data: { tenantId, accountId: account.id, providerMessageId: unrelated.id, threadId: unrelated.threadId, from: unrelated.from, fromAddress: unrelated.from, recipients: unrelated.to, recipientAddresses: unrelated.to, direction: 'inbound', subject: 'Electric Fence payment', snippet: 'private bank', body: 'private bank', sentAt: new Date(unrelated.date), labels: unrelated.labels } });
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail)], permissions));
    expect((await call('/emails?query=Electric%20Fence')).body.emails).toHaveLength(1);
    expect((await call('/emails?query=from%3Abank%40example.test%20OR%20in%3Aanywhere')).body.emails).toHaveLength(0);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(2);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    for (const [path, method, body] of [['/threads/oldbank', 'GET', undefined], ['/archive', 'POST', { messageIds: ['oldbank'] }], ['/trash', 'POST', { messageIds: ['oldbank'] }]] as const) expect((await call(path, method, body)).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });
  it('revokes reassigned correspondence, even for Client Admin and direct thread IDs', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'reassigned')], permissions));
    expect((await call('/threads/reassigned')).status).toBe(200);
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    expect((await call('/emails')).body.emails).toHaveLength(0);
    expect((await call('/threads/reassigned')).status).toBe(404);
    expect((await call('/trash', 'POST', { messageIds: ['reassigned'] })).status).toBe(404);
    // Fixed-sender visibility must not grant access to a historical customer's Deal.
    await prisma.mailboxMessage.updateMany({ where: { accountId: account.id, providerMessageId: 'reassigned' }, data: { fromAddress: 'info@camxian.com' } });
    expect((await call('/threads/reassigned')).body.emails[0].leadId).toBeUndefined();
    expect((await call('/threads/reassigned/deal', 'PATCH', { dealId: randomUUID() })).status).toBe(409);
  });
  it('denies direct thread reads and mutations across mailbox owners and tenants', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'owner-private')], permissions));
    const foreignTenant = await prisma.tenant.create({ data: { name: 'Other tenant', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
    const foreignUser = await prisma.user.create({ data: { tenantId: foreignTenant.id, email: 'foreign@camxian.com', firstName: 'Other', lastName: 'Tenant', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    const sameTenantUser = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    for (const user of [sameTenantUser, foreignUser]) {
      await prisma.emailAccount.upsert({ where: { tenantId_userId_provider: { tenantId: user.tenantId, userId: user.id, provider: 'gmail' } }, update: {}, create: { tenantId: user.tenantId, userId: user.id, email: user.email, accessToken: encryptToken('test-only'), tokenExpiresAt: new Date(Date.now() + 3600000), scopes: ['https://www.googleapis.com/auth/gmail.modify'] } });
      const authorization = `Bearer ${(await issueAuthSession(user)).token}`;
      expect((await call('/threads/owner-private', 'GET', undefined, authorization)).status).toBe(404);
      expect((await call('/threads/owner-private/read-state', 'PATCH', { isRead: true }, authorization)).status).toBe(404);
      expect((await call('/threads/owner-private/archive', 'POST', undefined, authorization)).status).toBe(404);
      expect((await call('/threads/owner-private/trash', 'POST', undefined, authorization)).status).toBe(404);
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it('keeps four incoming/outgoing messages in one verified conversation across historical replay', async () => {
    const first = { ...mail(`Doris <${leadEmail}>`, 'thread-first'), threadId: 'thread-one', date: '2026-10-01T01:00:00Z' };
    await scope(() => ingestMailboxMessages(account, [first], permissions));
    expect((await call('/emails')).body.emails[0].messageCount).toBe(1);
    const messages = [first, { ...mail(account.email, 'thread-send', ['SENT']), threadId: 'thread-one', to: [leadEmail], date: '2026-10-01T02:00:00Z' },
      { ...first, id: 'thread-reply', date: '2026-10-01T03:00:00Z' },
      { ...mail(account.email, 'thread-latest', ['SENT']), threadId: 'thread-one', to: [leadEmail], snippet: 'Latest follow-up', date: '2026-10-01T04:00:00Z' }];
    for (let i = 0; i < 2; i++) await scope(() => ingestMailboxMessages(account, [...messages].reverse(), permissions));
    const result = await call('/emails');
    expect(result.body.emails).toHaveLength(1);
    expect(result.body.emails[0]).toMatchObject({ id: 'thread-latest', threadId: 'thread-one', messageCount: 4, participants: ['Doris', 'You'], snippet: 'Latest follow-up', date: '2026-10-01T04:00:00.000Z', isRead: false, body: '' });
    expect(result.body.unreadCount).toBe(1); expect((await call('/unread-count')).body).toMatchObject({ unreadCount: 1, unreadCountUnit: 'conversations' });
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(4);
    const detail = await call('/threads/thread-one');
    expect(detail.body.emails.map((row: GmailEmail) => row.id)).toEqual(['thread-first', 'thread-send', 'thread-reply', 'thread-latest']);
    expect(detail.body.emails[0].body).toBe(first.body);
  });
  it('consolidates exact correspondents across provider threads while keeping different addresses separate', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'separate-a'), mail(leadEmail, 'separate-b'), mail(contactEmail, 'separate-c')], permissions));
    const result = await call('/emails');
    expect(result.body.emails).toHaveLength(2); expect(result.body.emails.map((row: GmailEmail) => row.messageCount).sort()).toEqual([1, 2]);
    const customer = result.body.emails.find((row: GmailEmail) => row.messageCount === 2);
    expect(customer.conversationId).toMatch(/^c_[a-f0-9]{32}$/);
    const history = await call('/conversations/' + customer.conversationId);
    expect(history.status).toBe(200); expect(history.body.emails.map((row: GmailEmail) => row.threadId).sort()).toEqual(['separate-a', 'separate-b']);
  });
  it('keeps the same display name at two exact addresses separate', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(`John <${leadEmail}>`, 'john-one'), mail(`John <${contactEmail}>`, 'john-two')], permissions));
    const rows = (await call('/emails?query=John')).body.emails;
    expect(rows).toHaveLength(2); expect(new Set(rows.map((row: GmailEmail) => row.conversationId)).size).toBe(2);
    expect(rows.every((row: GmailEmail) => row.participants?.includes('John'))).toBe(true);
  });
  it('consolidates approved Welcome/Reset senders without changing original subjects or provider threads', async () => {
    await scope(() => ingestMailboxMessages(account, [
      { ...mail('Camxian Technologies <INFO@CAMXIAN.COM>', 'welcome'), subject: 'Welcome to LeadCRM' },
      { ...mail('Camxian Technologies <info@camxian.com>', 'reset-one'), subject: 'Reset your LeadCRM password' },
      { ...mail('info@camxian.com', 'reset-two'), subject: 'Reset your LeadCRM password' },
    ], permissions));
    const row = (await call('/emails')).body.emails[0]; expect(row.messageCount).toBe(3);
    expect((await call('/unread-count')).body.unreadCount).toBe(1);
    const history = (await call('/conversations/' + row.conversationId)).body;
    expect(history.messageCount).toBe(3); expect(new Set(history.emails.map((message: GmailEmail) => message.threadId)).size).toBe(3);
    expect(history.emails.map((message: GmailEmail) => message.subject)).toContain('Welcome to LeadCRM');
  });
  it('isolates multi-participant topics from private histories and retains later replies within the group', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'personal-a'), mail(contactEmail, 'personal-b'),
      { ...mail(leadEmail, 'group-first'), cc: [`Contact Two <${contactEmail}>`], threadId: 'group-topic' },
      { ...mail(account.email, 'group-reply', ['SENT']), to: [leadEmail], threadId: 'group-topic' },
      { ...mail(leadEmail, 'other-group'), cc: [contactEmail], threadId: 'other-group-topic' },
    ], permissions));
    const rows = (await call('/emails')).body.emails; expect(rows).toHaveLength(4);
    const group = rows.find((row: GmailEmail) => row.messageCount === 2);
    expect(group.conversationKind).toBe('group'); expect(group.correspondentAddresses.sort()).toEqual([leadEmail, contactEmail].sort());
    expect(group.participants).toContain('Contact Two');
    expect((await call('/conversations/' + group.conversationId)).body.emails.map((row: GmailEmail) => row.id).sort()).toEqual(['group-first', 'group-reply']);
  });
  it('does not invent a CRM identity for duplicated email records and revokes a correspondent after assignment loss', async () => {
    await prisma.lead.create({ data: { tenantId, assignedUserId: userId, email: leadEmail, firstName: 'Duplicate', lastName: 'Record', productInterest: [] } });
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'ambiguous-one'), mail(leadEmail, 'ambiguous-two')], permissions));
    const row = (await call('/emails')).body.emails[0]; expect(row.messageCount).toBe(2); expect(row.leadId).toBeUndefined();
    const history = (await call('/conversations/' + row.conversationId)).body;
    expect(history.emails.every((message: GmailEmail) => !message.leadId && !message.contactId && !message.dealId)).toBe(true);
    expect(history.threads.every((topic: any) => !topic.canAssociateDeal)).toBe(true);
    await prisma.lead.updateMany({ where: { tenantId, assignedUserId: userId, email: { in: [leadEmail, ` Customer <${leadEmail.toUpperCase()}> `] } }, data: { assignedUserId: otherId } });
    expect((await call('/conversations/' + row.conversationId)).status).toBe(404);
    expect((await call('/emails')).body.emails).toHaveLength(0); expect((await call('/unread-count')).body.unreadCount).toBe(0);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(2);
  });
  it('bounds detail pages and orders complete original thread blocks chronologically', async () => {
    for (let i = 0; i < 55; i++) await persistHistorical({ ...mail(leadEmail, `history-${String(i).padStart(2, '0')}`), threadId: i % 2 ? 'topic-b' : 'topic-a', date: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() });
    const row = (await call('/emails?maxResults=1')).body.emails[0]; expect(row.messageCount).toBe(55);
    const first = (await call('/conversations/' + row.conversationId)).body;
    expect(first.emails).toHaveLength(50); expect(first.messageCount).toBe(55); expect(first.nextPageToken).toBeTruthy();
    const second = (await call('/conversations/' + row.conversationId + '?pageToken=' + encodeURIComponent(first.nextPageToken))).body;
    expect(second.emails).toHaveLength(5); expect(second.nextPageToken).toBeUndefined();
    const all = [...first.emails, ...second.emails]; expect(new Set(all.map((message: GmailEmail) => message.id)).size).toBe(55);
    expect(all.slice(0, 28).every((message: GmailEmail) => message.threadId === 'topic-a')).toBe(true);
    expect(all.slice(28).every((message: GmailEmail) => message.threadId === 'topic-b')).toBe(true);
    for (const threadId of ['topic-a', 'topic-b']) { const dates = all.filter((message: GmailEmail) => message.threadId === threadId).map((message: GmailEmail) => Date.parse(message.date)); expect(dates).toEqual([...dates].sort((a, b) => a - b)); }
  });
  it('marks only the opened message read and counts one unread correspondent across original topics', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'unread-topic-a'), mail(leadEmail, 'unread-topic-b'), mail(leadEmail, 'unread-topic-c')], permissions));
    const row = (await call('/emails')).body.emails[0]; expect(row.messageCount).toBe(3);
    expect((await call('/unread-count')).body.unreadCount).toBe(1);
    const provider = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', provider);
    expect((await call('/messages/unread-topic-a/read-state', 'PATCH', { isRead: true })).body.count).toBe(1);
    const history = (await call('/conversations/' + row.conversationId)).body.emails;
    expect(history.filter((message: GmailEmail) => !message.isRead)).toHaveLength(2); expect(provider).toHaveBeenCalledOnce();
    expect((await call('/unread-count')).body.unreadCount).toBe(1);
  });
  it.each(['archive', 'trash'])('applies correspondent %s only to authorized messages across its topics', async action => {
    await persistHistorical(mail(leadEmail, 'group-action-one'));
    await persistHistorical(mail(leadEmail, 'group-action-two'));
    await persistHistorical({ ...mail('bank@example.com', 'group-action-private'), threadId: 'group-action-one' });
    await persistHistorical({ ...mail(account.email, 'group-action-draft', ['DRAFT']), to: [leadEmail], draftId: 'draft-action' });
    const row = (await call('/emails')).body.emails[0];
    const provider = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', provider);
    expect((await call('/' + action, 'POST', { conversationIds: [row.conversationId, 'c_' + '0'.repeat(32)] })).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
    expect((await call('/' + action, 'POST', { conversationIds: [row.conversationId] })).body.count).toBe(2);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.every(([path]) => !String(path).includes('private') && !String(path).includes('draft'))).toBe(true);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(4);
  });
  it('preserves separate per-message Deal associations inside one correspondent history', async () => {
    const { pipeline, initial } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenantId)));
    const deals = [];
    for (const title of ['CCTV topic', 'Telephone topic']) deals.push(await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: initial.id, title, value: 100,
      leadDeals: { create: { leadId, position: 0 } }, productInterests: [], tags: [] } }));
    await persistHistorical(mail(leadEmail, 'deal-topic-a'), { leadId, dealId: deals[0].id });
    await persistHistorical(mail(leadEmail, 'deal-topic-b'), { leadId, dealId: deals[1].id });
    const row = (await call('/emails')).body.emails[0];
    const history = (await call('/conversations/' + row.conversationId)).body;
    expect(history.emails.find((message: GmailEmail) => message.id === 'deal-topic-a').dealId).toBe(deals[0].id);
    expect(history.emails.find((message: GmailEmail) => message.id === 'deal-topic-b').dealId).toBe(deals[1].id);
    await prisma.leadDeal.deleteMany({ where: { tenantId, dealId: deals[1].id } });
    expect((await call('/conversations/' + row.conversationId)).body.emails.find((message: GmailEmail) => message.id === 'deal-topic-b').dealId).toBeUndefined();
  });
  it('denies correspondent details and mutations to other mailboxes and tenants', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'correspondent-private')], permissions));
    const row = (await call('/emails')).body.emails[0];
    const user = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    await prisma.emailAccount.upsert({ where: { tenantId_userId_provider: { tenantId, userId: otherId, provider: 'gmail' } }, update: {}, create: { tenantId, userId: otherId, email: user.email, accessToken: encryptToken('test-only'), tokenExpiresAt: new Date(Date.now() + 3600000), scopes: ['https://www.googleapis.com/auth/gmail.modify'] } });
    const authorization = `Bearer ${(await issueAuthSession(user)).token}`;
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await call('/conversations/' + row.conversationId, 'GET', undefined, authorization)).status).toBe(404);
    expect((await call('/trash', 'POST', { conversationIds: [row.conversationId] }, authorization)).status).toBe(404);
    expect((await call('/messages/correspondent-private/read-state', 'PATCH', { isRead: true }, authorization)).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
    const tenant = await prisma.tenant.create({ data: { name: 'Isolated mailbox', slug: randomUUID(), onboardingCompletedAt: new Date() } });
    const foreign = await prisma.user.create({ data: { tenantId: tenant.id, email: `foreign-${randomUUID()}@camxian.com`, firstName: 'Other', lastName: 'Tenant', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
    await prisma.emailAccount.create({ data: { tenantId: tenant.id, userId: foreign.id, email: foreign.email, accessToken: encryptToken('test-only'), tokenExpiresAt: new Date(Date.now() + 3600000), scopes: ['https://www.googleapis.com/auth/gmail.modify'] } });
    expect((await call('/conversations/' + row.conversationId, 'GET', undefined, `Bearer ${(await issueAuthSession(foreign)).token}`)).status).toBe(404);
  });
  it('stops a correspondent bulk action if assignment is revoked between provider writes', async () => {
    await persistHistorical(mail(leadEmail, 'mid-action-a')); await persistHistorical(mail(leadEmail, 'mid-action-b'));
    const row = (await call('/emails')).body.emails[0];
    const provider = vi.fn(async () => { await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } }); return Response.json({}); });
    vi.stubGlobal('fetch', provider);
    expect((await call('/trash', 'POST', { conversationIds: [row.conversationId] })).status).toBe(404);
    expect(provider).toHaveBeenCalledOnce();
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, labels: { has: 'TRASH' } } })).toBe(1);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).mailboxVersion).toBeGreaterThan(account.mailboxVersion);
  });
  it('trashes approved fixed-sender replies before removing their authorizing original messages', async () => {
    await scope(() => ingestMailboxMessages(account, [mail('info@camxian.com', 'fixed-original')], permissions));
    await scope(() => ingestMailboxMessages(account, [{ ...mail(account.email, 'fixed-reply', ['SENT']), to: ['info@camxian.com'], threadId: 'fixed-original' }], permissions));
    const row = (await call('/emails')).body.emails[0]; expect(row.messageCount).toBe(2);
    const provider = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', provider);
    expect((await call('/trash', 'POST', { conversationIds: [row.conversationId] })).body.count).toBe(2);
    expect(provider.mock.calls[0][0]).toContain('/messages/fixed-reply/trash');
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, labels: { has: 'TRASH' } } })).toBe(2);
  });
  it('retains original RFC reply headers through authorized ingestion and replay', async () => {
    const email = parseGmailMessage(apiMail(mail(leadEmail, 'reply-header'), [
      { name: 'Message-ID', value: '<current@example.test>' }, { name: 'In-Reply-To', value: '<parent@example.test>' }, { name: 'References', value: '<first@example.test> <parent@example.test>' },
    ]));
    for (let i = 0; i < 2; i++) await scope(() => ingestMailboxMessages(account, [email], permissions));
    const row = (await call('/emails')).body.emails[0];
    expect((await call('/conversations/' + row.conversationId)).body.emails[0]).toMatchObject({ rfcMessageId: '<current@example.test>', rfcInReplyTo: '<parent@example.test>', rfcReferences: ['<first@example.test>', '<parent@example.test>'] });
    expect(parseGmailMessage(apiMail(email, [{ name: 'In-Reply-To', value: '<parent@example.test>\r\nBcc: bank@example.test' }])).rfcInReplyTo).toBeNull();
  });
  it.each([false, true])('replies to an older selected topic from consolidated history (Reply All=%s)', async all => {
    const source = { ...mail(leadEmail, 'selected-old'), date: '2026-10-01T01:00:00Z', subject: 'Older topic', rfcMessageId: '<older@example.test>' };
    await scope(() => ingestMailboxMessages(account, [source, { ...mail(leadEmail, 'newer-topic'), subject: 'Newer topic' }], permissions));
    const row = (await call('/emails')).body.emails[0]; expect(row.messageCount).toBe(2);
    const selected = (await call('/conversations/' + row.conversationId)).body.emails.find((message: GmailEmail) => message.id === source.id);
    let write: any;
    const to = all ? [leadEmail, contactEmail] : [leadEmail];
    const sent = { ...mail(account.email, 'older-send', ['SENT']), threadId: source.threadId, to, subject: 'Re: Older topic' };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/messages/send')) { write = JSON.parse(String(init?.body)); return Response.json({ id: sent.id, threadId: sent.threadId }); }
      return Response.json(apiMail(sent));
    }));
    expect((await call('/send', 'POST', { to, subject: sent.subject, body: '<p>Reply to older topic</p>', replyToMessageId: selected.id })).status).toBe(200);
    expect(write.threadId).toBe(source.threadId); expect(write.threadId).not.toBe(row.conversationId);
    expect(Buffer.from(write.raw, 'base64url').toString()).toContain('In-Reply-To: <older@example.test>');
    expect((await call('/threads/' + source.threadId)).body.emails).toHaveLength(2);
  });
  it('searches any eligible message and filters whole conversations using latest activity', async () => {
    await persistHistorical({ ...mail(leadEmail, 'search-old'), threadId: 'search-thread', body: 'Historical rare-needle text', date: '2026-10-01T01:00:00Z' });
    await persistHistorical({ ...mail(account.email, 'search-new', ['SENT']), threadId: 'search-thread', to: [leadEmail], snippet: 'Latest response', date: '2026-10-03T01:00:00Z' });
    await persistHistorical({ ...mail(contactEmail, 'search-other', []), date: '2026-10-02T01:00:00Z' });
    for (const filter of ['all', 'unread', 'sent']) {
      const rows = (await call(`/emails?filter=${filter}&query=rare-needle`)).body.emails;
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: 'search-new', messageCount: 2, isRead: false, snippet: 'Latest response' });
    }
    expect((await call('/emails?sort=oldest')).body.emails.map((row: GmailEmail) => row.threadId)).toEqual(['search-other', 'search-thread']);
    expect((await call('/emails?sort=newest')).body.emails.map((row: GmailEmail) => row.threadId)).toEqual(['search-thread', 'search-other']);
    expect((await call('/emails?sort=unread')).body.emails[0].threadId).toBe('search-thread');
    expect((await call('/emails?query=' + encodeURIComponent(account.email))).body.emails).toHaveLength(2);
  });
  it('counts unread incoming conversations and excludes outgoing UNREAD labels', async () => {
    await persistHistorical({ ...mail(account.email, 'unread-sent', ['SENT', 'UNREAD']), to: [leadEmail] });
    await persistHistorical(mail(leadEmail, 'unread-incoming'));
    await persistHistorical({ ...mail(leadEmail, 'unread-second'), threadId: 'unread-incoming' });
    expect((await call('/unread-count')).body.unreadCount).toBe(1);
    expect((await call('/emails?filter=unread')).body.emails).toHaveLength(1);
  });
  it('paginates correspondent groups with deterministic ties and invalidates cursors after mailbox changes', async () => {
    for (let i = 0; i < 5; i++) {
      const email = i === 0 ? leadEmail : `page-${i}@example.test`;
      if (i) await prisma.lead.create({ data: { tenantId, assignedUserId: userId, email, firstName: 'Page', lastName: String(i), productInterest: [] } });
      await persistHistorical({ ...mail(email, `page-${i}`), date: '2026-10-01T01:00:00Z' });
    }
    for (let i = 0; i < 10; i++) await persistHistorical({ ...mail(leadEmail, `page-reply-${i}`), threadId: 'page-0', date: '2026-10-01T01:00:00Z' });
    const first = (await call('/emails?maxResults=2')).body;
    expect(first.emails).toHaveLength(2);
    const second = (await call('/emails?maxResults=2&pageToken=' + encodeURIComponent(first.nextPageToken))).body;
    expect(second.emails).toHaveLength(2);
    const last = (await call('/emails?maxResults=2&pageToken=' + encodeURIComponent(second.nextPageToken))).body;
    expect(last.emails).toHaveLength(1); expect(last.nextPageToken).toBeUndefined();
    const groups = [...first.emails, ...second.emails, ...last.emails];
    expect(new Set(groups.map((row: GmailEmail) => row.conversationId)).size).toBe(5);
    expect(groups.find((row: GmailEmail) => row.correspondentAddresses?.includes(leadEmail)).messageCount).toBe(11);
    expect((await call('/emails?sort=oldest&pageToken=' + encodeURIComponent(first.nextPageToken))).status).toBe(400);
    expect((await call('/emails?pageToken=invalid')).status).toBe(400);
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'page-arrival')], permissions));
    await prisma.emailAccount.update({ where: { id: account.id }, data: { mailboxVersion: { increment: 1 } } });
    expect((await call('/emails?maxResults=2&pageToken=' + encodeURIComponent(first.nextPageToken))).status).toBe(400);
  });
  it('does not let a matching thread ID expose unauthorized participants, previews, search or counts', async () => {
    await persistHistorical(mail(leadEmail, 'shared-thread'));
    await persistHistorical({ ...mail('bank@example.com', 'private-reply'), threadId: 'shared-thread', subject: 'Secret matching subject', body: 'Secret matching body', date: new Date().toISOString() });
    const row = (await call('/emails')).body.emails[0];
    expect(row).toMatchObject({ id: 'shared-thread', messageCount: 1 }); expect(row.participants).not.toContain('bank');
    expect((await call('/emails?query=Secret')).body.emails).toHaveLength(0);
    expect((await call('/threads/shared-thread')).body.emails).toHaveLength(1);
    expect((await call('/unread-count')).body.unreadCount).toBe(1);
  });
  it('bulk conversation actions cover all applicable messages and validate every conversation before writing', async () => {
    await persistHistorical(mail(leadEmail, 'bulk-thread'));
    await persistHistorical({ ...mail(leadEmail, 'bulk-reply'), threadId: 'bulk-thread' });
    await persistHistorical({ ...mail(account.email, 'bulk-draft', ['DRAFT']), threadId: 'bulk-thread', to: [leadEmail], draftId: 'bulk-draft-id' });
    await persistHistorical({ ...mail('bank@example.com', 'bulk-private'), threadId: 'bulk-thread' });
    const provider = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', provider);
    expect((await call('/archive', 'POST', { threadIds: ['bulk-thread', 'unknown'] })).status).toBe(404); expect(provider).not.toHaveBeenCalled();
    expect((await call('/trash', 'POST', { threadIds: ['bulk-thread'] })).body.count).toBe(2);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.every(([path]) => !String(path).includes('bulk-draft') && !String(path).includes('bulk-private'))).toBe(true);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(4);
  });
  it.each([false, true])('keeps provider-confirmed Reply/Reply All delivery in the same conversation (all=%s)', async all => {
    const incoming = { ...mail(leadEmail, 'send-source'), rfcMessageId: '<source@example.test>' };
    await scope(() => ingestMailboxMessages(account, [incoming], permissions));
    const recipients = all ? [leadEmail, contactEmail] : [leadEmail];
    const sent = { ...mail(account.email, 'confirmed-reply', ['SENT']), threadId: 'send-source', to: recipients };
    const writes: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/messages/send')) { writes.push(JSON.parse(String(init?.body))); return Response.json({ id: sent.id, threadId: sent.threadId }); }
      return Response.json(apiMail(sent));
    }));
    expect((await call('/send', 'POST', { to: recipients, subject: 'Re: ' + incoming.subject, body: '<p>Reply</p>', replyToMessageId: incoming.id, requestId: randomUUID() })).status).toBe(200);
    expect(writes[0].threadId).toBe(incoming.threadId);
    const raw = Buffer.from(writes[0].raw, 'base64url').toString();
    expect(raw).toContain('In-Reply-To: <source@example.test>'); expect(raw).toContain('References: <source@example.test>');
    const rows = (await call('/emails')).body.emails; expect(rows).toHaveLength(1); expect(rows[0].messageCount).toBe(2);
  });
  it('filters Sent and Drafts inside CRM scope and sorts across persisted pages', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'received'), { ...mail(account.email, 'sent', ['SENT']), to: [leadEmail] }, { ...mail(account.email, 'draft', ['DRAFT']), draftId: 'draft-id', to: [contactEmail] }, { ...mail(account.email, 'personal', ['SENT']), to: ['personal@example.test'] }], permissions));
    expect((await call('/emails?filter=sent')).body.emails.map((row: GmailEmail) => row.id)).toEqual(['sent']);
    expect((await call('/emails?filter=drafts')).body.emails[0].draftId).toBe('draft-id');
    expect((await call('/emails?filter=unread')).body.emails).toHaveLength(1);
    expect((await call('/emails?filter=unread')).body.emails[0].messageCount).toBe(2);
    const first = await call('/emails?maxResults=1&sort=oldest');
    expect(first.body.nextPageToken).toBeUndefined(); expect(first.body.emails[0].messageCount).toBe(2);
  });
  it('preserves nested attachment metadata through replay and authorizes downloads by message and mailbox', async () => {
    const payload = apiMail(mail(leadEmail, 'file-source'));
    const attachmentId = 'provider-attachment';
    Object.assign(payload.payload, { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/html', body: payload.payload.body },
      { mimeType: 'multipart/mixed', parts: [{ filename: 'proposal.pdf', mimeType: 'application/pdf', body: { attachmentId, size: 4 } }] },
    ] });
    const parsed = parseGmailMessage(payload);
    await scope(() => ingestMailboxMessages(account, [parsed], permissions));
    await scope(() => ingestMailboxMessages(account, [parsed], permissions));
    const detail = (await call('/threads/file-source')).body.emails[0];
    expect(detail.attachments).toEqual([{ id: attachmentId, filename: 'proposal.pdf', mimeType: 'application/pdf', size: 4 }]);
    expect(detail.body).toBe(parsed.body); expect(await prisma.mailboxMessage.count({ where: { accountId: account.id } })).toBe(1);
    const provider = vi.fn(async () => Response.json({ data: Buffer.from([0, 1, 2, 255]).toString('base64url'), size: 4 })); vi.stubGlobal('fetch', provider);
    const download = await realFetch(base + '/messages/file-source/attachments/' + attachmentId, { headers: { Authorization: `Bearer ${token}` } });
    expect(download.status).toBe(200); expect(download.headers.get('cache-control')).toBe('no-store');
    expect(download.headers.get('content-disposition')).toContain('proposal.pdf'); expect(download.headers.get('content-type')).toContain('application/octet-stream');
    expect([...new Uint8Array(await download.arrayBuffer())]).toEqual([0, 1, 2, 255]); expect(provider).toHaveBeenCalledOnce();
    expect((await call('/messages/file-source/attachments/unknown')).status).toBe(404); expect(provider).toHaveBeenCalledOnce();
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    expect((await call('/messages/file-source/attachments/' + attachmentId)).status).toBe(404); expect(provider).toHaveBeenCalledOnce();
  });
  it('rejects attachment access after reassignment during a provider read', async () => {
    await scope(() => ingestMailboxMessages(account, [{ ...mail(leadEmail, 'file-race'), attachments: [{ id: 'file-id', filename: 'private.pdf', mimeType: 'application/pdf', size: 1 }] }], permissions));
    vi.stubGlobal('fetch', vi.fn(async () => {
      await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
      return Response.json({ data: 'YQ', size: 1 });
    }));
    expect((await call('/messages/file-race/attachments/file-id')).status).toBe(404);
  });
  it('retains the References chain in authorized replies without unsafe header values', async () => {
    const incoming = { ...mail(leadEmail, 'references-source'), rfcMessageId: '<parent@example.test>', rfcReferences: ['<original@example.test>', '<previous@example.test>'] };
    await scope(() => ingestMailboxMessages(account, [incoming], permissions));
    const sent = { ...mail(account.email, 'references-sent', ['SENT']), threadId: incoming.threadId, to: [leadEmail] };
    let raw = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/messages/send')) { raw = Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString(); return Response.json({ id: sent.id, threadId: sent.threadId }); }
      return Response.json(apiMail(sent));
    }));
    expect((await call('/send', 'POST', { to: leadEmail, subject: 'Re: ' + incoming.subject, body: '<p>Follow-up</p>', replyToMessageId: incoming.id })).status).toBe(200);
    expect(raw).toContain('References: <original@example.test>\r\n <previous@example.test>\r\n <parent@example.test>');
    expect(raw).toContain('In-Reply-To: <parent@example.test>');
    expect(parseGmailMessage(apiMail(incoming, [{ name: 'References', value: '<safe@example.test>\r\nBcc: bank@example.test' }])).rfcReferences).toEqual([]);
  });
  it('creates a new Gmail thread for Compose and adds it to the existing correspondent history', async () => {
    const incoming = mail(leadEmail, 'compose-existing'); await scope(() => ingestMailboxMessages(account, [incoming], permissions));
    const sent = { ...mail(account.email, 'compose-new', ['SENT']), to: [leadEmail] };
    let write: any;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('/messages/send')) { write = JSON.parse(String(init?.body)); return Response.json({ id: sent.id, threadId: sent.threadId }); }
      return Response.json(apiMail(sent));
    }));
    expect((await call('/send', 'POST', { to: leadEmail, subject: incoming.subject, body: '<p>New inquiry</p>' })).status).toBe(200);
    expect(write.threadId).toBeUndefined(); expect(Buffer.from(write.raw, 'base64url').toString()).not.toContain('In-Reply-To:');
    const row = (await call('/emails')).body.emails[0]; expect(row.messageCount).toBe(2);
    const history = (await call('/conversations/' + row.conversationId)).body.emails;
    expect(new Set(history.map((message: GmailEmail) => message.threadId)).size).toBe(2);
  });
  it('updates and sends saved reply drafts with their existing thread, and deletes only authorized drafts', async () => {
    // Provider threading requires the existing subject as well as reply headers.
    vi.stubEnv('SMTP_FROM', 'Camxian Technologies <info@camxian.com>');
    vi.stubEnv('GMAIL_SYSTEM_SENDER_GMAIL_EMAIL', 'info@camxian.com');
    const incoming = { ...mail(leadEmail, 'draft-reply'), rfcMessageId: '<customer-message@example.test>' };
    await scope(() => ingestMailboxMessages(account, [incoming], permissions));
    const writes: { path: string; data: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (init?.method) {
        writes.push({ path, data: JSON.parse(String(init.body)) });
        if (path.endsWith('/drafts/send')) return Response.json({ id: 'sent-draft', threadId: incoming.threadId });
        return Response.json({ id: 'saved-draft', message: { id: 'draft-message', threadId: incoming.threadId } });
      }
      return Response.json(apiMail({ ...mail(account.email, 'sent-draft', ['SENT']), threadId: incoming.threadId, to: [leadEmail] }));
    }));
    const draft = { to: leadEmail, subject: 'Re: ' + incoming.subject, body: '<p>Original</p>', replyToMessageId: incoming.id };
    expect((await call('/drafts', 'POST', draft)).status).toBe(200);
    expect((await call('/drafts', 'POST', { ...draft, replyToMessageId: undefined, draftId: 'saved-draft', body: '<p>Edited</p>' })).status).toBe(200);
    const saved = (await call('/emails?filter=drafts')).body.emails[0]; expect(saved.body).toBe('<p>Edited</p>');
    expect((await call('/send', 'POST', { to: leadEmail, subject: draft.subject, body: saved.body, draftId: 'saved-draft' })).status).toBe(200);
    expect(writes.at(-1)?.path).toMatch(/drafts\/send$/);
    const update = writes.at(-2)!; expect(update.data.message.threadId).toBe(incoming.threadId);
    expect(Buffer.from(update.data.message.raw, 'base64url').toString().split('\r\n')[0]).toBe(`From: ${account.email}`);
    expect(Buffer.from(update.data.message.raw, 'base64url').toString()).toContain('In-Reply-To: <customer-message@example.test>');
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(0);
    expect((await call('/drafts/personal-draft', 'DELETE')).status).toBe(404);
  });
  it('rejects changed reply subjects before a provider send can split the conversation', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'subject-source')], permissions));
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const payload = { to: leadEmail, subject: 'Different inquiry', body: '<p>Hello</p>', replyToMessageId: 'subject-source' };
    expect((await call('/send', 'POST', payload)).body.error.code).toBe('MAILBOX_REPLY_SUBJECT_CHANGED');
    expect((await call('/drafts', 'POST', payload)).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it('refreshes provider-edited draft bodies without creating engagement activities', async () => {
    const draft = { ...mail(account.email, 'edit-draft', ['DRAFT']), to: [leadEmail], draftId: 'draft-id' };
    await scope(() => ingestMailboxMessages(account, [draft], permissions));
    await scope(() => ingestMailboxMessages(account, [{ ...draft, body: '<p>Changed in Gmail</p>' }], permissions));
    expect((await call('/emails?filter=drafts')).body.emails[0].body).toBe('<p>Changed in Gmail</p>');
    expect(await prisma.activity.count({ where: { tenantId, leadId, type: 'email' } })).toBe(0);
  });
  it('retains CRM source authorization when Gmail replaces an authorized draft message ID', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'retained-source')], permissions));
    const oldDraft = { ...mail(account.email, 'old-draft-message', ['DELETED']), to: [contactEmail], draftId: 'retained-draft-id' };
    await persistHistorical(oldDraft, { crmDraft: true, sourceMessageId: 'retained-source' });
    const replacement = { ...oldDraft, id: 'new-draft-message', labels: ['DRAFT'] };
    await scope(() => ingestMailboxMessages(account, [replacement], permissions));
    const saved = await prisma.mailboxMessage.findUniqueOrThrow({ where: { accountId_providerMessageId: { accountId: account.id, providerMessageId: replacement.id } } });
    expect(saved.sourceMessageId).toBe('retained-source'); expect(saved.crmDraft).toBe(true);
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(1);
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(0);
  });
  it('bounds and validates provider queries for thousands of assigned addresses', async () => {
    const resolved = await resolveMailboxScope(account, permissions);
    const queries = mailboxProviderQueries({ ...resolved, addresses: Array.from({ length: 2000 }, (_, n) => `customer${n}@example.test`) });
    expect(queries.length).toBeGreaterThan(50);
    expect(queries.every(query => query.length < 3100 && query.includes('-in:spam -in:trash {'))).toBe(true);
    expect(mailboxAddress('bad@example.test OR from:bank@example.test')).toBeUndefined();
    expect(mailboxAddress('Name < INFO@CAMXIAN.COM >')).toBe('info@camxian.com');
  });
  it('single-flights history sync and never fetches unrelated bodies', async () => {
    const resolved = await resolveMailboxScope(account, permissions);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncScopeHash: resolved.hash, syncCursor: '100', syncRequestedAt: new Date() } });
    const relevant = mail(leadEmail, 'customer'), unrelated = mail('bank@example.test', 'bank');
    const provider = vi.fn(async (input: string | URL) => {
      const path = String(input);
      if (path.includes('/history?')) return Response.json({ historyId: '110', history: [{ messagesAdded: [{ message: { id: 'customer' } }, { message: { id: 'bank' } }, { message: { id: 'customer' } }] }] });
      return Response.json(apiMail(path.includes('/customer?') ? relevant : unrelated));
    });
    vi.stubGlobal('fetch', provider);
    await Promise.all([scope(() => syncMailbox(tenantId, userId)), scope(() => syncMailbox(tenantId, userId))]);
    expect(provider.mock.calls.filter(([path]) => String(path).includes('/history?'))).toHaveLength(1);
    expect(provider.mock.calls.some(([path]) => String(path).includes('/bank?format=full'))).toBe(false);
    expect(await prisma.mailboxMessage.count({ where: { accountId: account.id, providerMessageId: 'bank' } })).toBe(0);
    expect((await call('/emails')).body.emails.map((row: GmailEmail) => row.id)).toEqual(['customer']);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBe('110');
  });
  it('persists Retry-After across calls and reloads continue reading saved mail', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail)], permissions));
    const provider = vi.fn(async () => Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 429, headers: { 'Retry-After': '180' } }));
    vi.stubGlobal('fetch', provider);
    await expect(scope(() => syncMailbox(tenantId, userId))).rejects.toMatchObject({ code: 'GMAIL_RATE_LIMITED' });
    const retry = (await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncRetryAt!;
    expect(+retry).toBeGreaterThan(Date.now() + 179000);
    await scope(() => syncMailbox(tenantId, userId));
    for (let n = 0; n < 3; n++) expect((await call('/emails')).body.emails).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('recovers expired history through scoped bounded reconciliation', async () => {
    const resolved = await resolveMailboxScope(account, permissions);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncScopeHash: resolved.hash, syncCursor: '100', syncRequestedAt: new Date() } });
    const provider = vi.fn(async (input: string | URL) => String(input).includes('/history?') ? Response.json({}, { status: 404 }) : String(input).endsWith('/profile') ? Response.json({ historyId: '200' }) : Response.json({}));
    vi.stubGlobal('fetch', provider);
    await scope(() => syncMailbox(tenantId, userId));
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBeNull();
    await scope(() => syncMailbox(tenantId, userId)); await scope(() => syncMailbox(tenantId, userId));
    const listings = provider.mock.calls.map(([path]) => String(path)).filter(path => /\/(messages|drafts)\?/.test(path));
    expect(listings.length).toBeGreaterThan(0); expect(listings.every(path => new URL(path).searchParams.get('q')?.includes(`from:${leadEmail}`))).toBe(true);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).syncCursor).toBe('200');
  });

  async function queuedEmail() {
    let draftRfc = '', sends = 0;
    const outgoing = { ...mail(account.email, 'sent-schedule', ['SENT']), to: [leadEmail] };
    const provider = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/drafts') && init?.method === 'POST') {
        draftRfc = Buffer.from(JSON.parse(String(init.body)).message.raw, 'base64url').toString();
        return Response.json({ id: 'draft-schedule-' + userId, message: { id: 'draft-message', threadId: 'schedule-thread' } });
      }
      if (path.includes('/drafts/') && path.includes('?format=metadata')) return Response.json({ message: apiMail({ ...outgoing, id: 'draft-message', labels: ['DRAFT'] }, [{ name: 'Message-ID', value: draftRfc.match(/Message-ID: ([^\r\n]+)/)![1] }]) });
      if (path.endsWith('/drafts/send')) { sends++; return Response.json({ id: outgoing.id, threadId: outgoing.threadId }); }
      if (path.includes('/messages?')) return Response.json({ messages: [{ id: outgoing.id, threadId: outgoing.threadId }] });
      return Response.json(apiMail(outgoing));
    });
    vi.stubGlobal('fetch', provider);
    const input = { to: leadEmail, subject: 'Scheduled inquiry', body: '<p>Hello</p>', scheduledAt: new Date(Date.now() + 3600000).toISOString(), requestId: randomUUID() };
    const item = await scope(() => scheduleMailboxEmail(tenantId, userId, input));
    return { item, input, provider, sends: () => sends };
  }
  it('persists future delivery, deduplicates requests, claims once, and transitions Scheduled to Sent', async () => {
    const test = await queuedEmail();
    expect((await scope(() => scheduleMailboxEmail(tenantId, userId, test.input))).id).toBe(test.item.id);
    await runScheduledMailboxEmails(); expect(test.sends()).toBe(0);
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(1);
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(0);
    await prisma.scheduledMailboxEmail.update({ where: { id: test.item.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await Promise.all([runScheduledMailboxEmails(), runScheduledMailboxEmails()]);
    expect(test.sends()).toBe(1);
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(0);
    expect((await call('/emails?filter=sent')).body.emails).toHaveLength(1);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: test.item.id } })).status).toBe('sent');
  });
  it('reviews a pending schedule from persisted data, cancels it once, and preserves its editable draft', async () => {
    const queued = await queuedEmail(); queued.provider.mockClear();
    const detail = await call('/scheduled/' + queued.item.id);
    expect(detail.status).toBe(200); expect(detail.body).toMatchObject({ id: queued.item.id, subject: 'Scheduled inquiry', recipients: [leadEmail], body: '<p>Hello</p>', canCancel: true });
    expect(queued.provider).not.toHaveBeenCalled();
    expect((await call('/scheduled/' + queued.item.id + '/cancel', 'POST', {})).status).toBe(200);
    expect((await call('/scheduled/' + queued.item.id + '/cancel', 'POST', {})).status).toBe(200);
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(0);
    expect((await call('/emails?filter=drafts')).body.emails).toHaveLength(1);
    await prisma.scheduledMailboxEmail.update({ where: { id: queued.item.id }, data: { scheduledAt: new Date(0) } });
    await runScheduledMailboxEmails(); expect(queued.sends()).toBe(0);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: queued.item.id } })).status).toBe('cancelled');
  });
  it('does not expose or cancel another employee schedule and rejects cancellation after sending begins', async () => {
    const queued = await queuedEmail();
    const other = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    const otherToken = (await issueAuthSession(other)).token;
    await prisma.emailAccount.upsert({ where: { tenantId_userId_provider: { tenantId, userId: otherId, provider: 'gmail' } },
      create: { tenantId, userId: otherId, email: other.email, accessToken: encryptToken(randomUUID()), scopes: ['https://www.googleapis.com/auth/gmail.modify'] }, update: { isActive: true } });
    expect((await call('/scheduled/' + queued.item.id, 'GET', undefined, 'Bearer ' + otherToken)).status).toBe(404);
    expect((await call('/scheduled/' + queued.item.id + '/cancel', 'POST', {}, 'Bearer ' + otherToken)).status).toBe(404);
    await prisma.scheduledMailboxEmail.update({ where: { id: queued.item.id }, data: { status: 'sending' } });
    expect((await call('/scheduled/' + queued.item.id + '/cancel', 'POST', {})).status).toBe(409);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: queued.item.id } })).status).toBe('sending');
  });
  it('recovers an expired pre-send claim after restart and rechecks assignments', async () => {
    const test = await queuedEmail();
    await prisma.scheduledMailboxEmail.update({ where: { id: test.item.id }, data: { scheduledAt: new Date(0), status: 'claimed', leaseId: 'old-worker', leaseUntil: new Date(0) } });
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    await runScheduledMailboxEmails();
    expect(test.sends()).toBe(0);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: test.item.id } })).status).toBe('failed');
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(0);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: test.item.id } })).lastError).toContain('assignment');
  });
  it('reconciles a send interrupted after provider acceptance without resending', async () => {
    const test = await queuedEmail();
    await prisma.scheduledMailboxEmail.update({ where: { id: test.item.id }, data: { scheduledAt: new Date(0), status: 'sending', leaseId: 'old-worker', leaseUntil: new Date(0) } });
    await runScheduledMailboxEmails();
    expect(test.sends()).toBe(0);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: test.item.id } })).status).toBe('sent');
    expect(test.provider.mock.calls.some(([path]) => decodeURIComponent(String(path)).includes(scheduleMessageId(test.item.id)))).toBe(true);
  });
  it('does not fetch uncertain delivery content after recipient assignment is revoked', async () => {
    const queued = await queuedEmail();
    await prisma.scheduledMailboxEmail.update({ where: { id: queued.item.id }, data: { scheduledAt: new Date(0), status: 'uncertain' } });
    await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: otherId } });
    queued.provider.mockClear(); await runScheduledMailboxEmails();
    expect(queued.provider).not.toHaveBeenCalled(); expect(queued.sends()).toBe(0);
    expect((await call('/emails?filter=scheduled')).body.emails).toHaveLength(0);
  });
  it.each(['To', 'Cc', 'Bcc'])('rejects a provider-edited scheduled %s recipient using only metadata', async header => {
    const queued = await queuedEmail();
    await prisma.scheduledMailboxEmail.update({ where: { id: queued.item.id }, data: { scheduledAt: new Date(0) } });
    const changed = apiMail({ ...mail(account.email, 'changed-draft', ['DRAFT']), to: header === 'To' ? ['bank@example.com'] : [leadEmail] }, [
      { name: 'Message-ID', value: scheduleMessageId(queued.item.id) }, ...(header === 'To' ? [] : [{ name: header, value: 'bank@example.com' }]),
    ]);
    const { body: _body, ...headersOnly } = changed.payload;
    const provider = vi.fn(async () => Response.json({ message: { ...changed, payload: headersOnly } })); vi.stubGlobal('fetch', provider);
    await runScheduledMailboxEmails(); expect(provider).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('?format=metadata');
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: queued.item.id } })).status).toBe('failed');
    expect(queued.sends()).toBe(0);
  });
  it('resumes a permitted expired claim once without browser state', async () => {
    const test = await queuedEmail();
    await prisma.scheduledMailboxEmail.update({ where: { id: test.item.id }, data: { scheduledAt: new Date(0), status: 'claimed', leaseId: 'terminated-worker', leaseUntil: new Date(0) } });
    await runScheduledMailboxEmails(); await runScheduledMailboxEmails();
    expect(test.sends()).toBe(1); expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: test.item.id } })).status).toBe('sent');
  });
  it('bounds uncertain-delivery reconciliation and never blindly resends', async () => {
    const test = await queuedEmail();
    await prisma.scheduledMailboxEmail.update({ where: { id: test.item.id }, data: { scheduledAt: new Date(0), status: 'sending', leaseUntil: new Date(0) } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ messages: [] })));
    for (let n = 0; n < 6; n++) { await runScheduledMailboxEmails(); await prisma.scheduledMailboxEmail.update({ where: { id: test.item.id }, data: { retryAt: new Date(0) } }); }
    expect(test.sends()).toBe(0); expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: test.item.id } })).status).toBe('failed');
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes('/messages?'))).toBe(true);
  });
  it('checks Gmail only when the server interval is due, without Pub/Sub or page-load sync', async () => {
    vi.stubEnv('GMAIL_SYNC_INTERVAL_SECONDS', '60');
    const resolved = await resolveMailboxScope(account, permissions);
    await prisma.emailAccount.update({ where: { id: account.id }, data: { syncScopeHash: resolved.hash, syncCursor: '100', lastSyncAt: new Date() } });
    const provider = vi.fn(async (_input: string | URL) => Response.json({ historyId: '120', history: [] })); vi.stubGlobal('fetch', provider);
    await scope(() => syncMailbox(tenantId, userId, 'worker'));
    await call('/emails'); await call('/emails');
    expect(provider).not.toHaveBeenCalled();
    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(Date.now() - 61000) } });
    await Promise.all([scope(() => syncMailbox(tenantId, userId, 'worker')), scope(() => syncMailbox(tenantId, userId, 'worker'))]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(String(provider.mock.calls[0]?.[0])).toContain('/history?');
    await scope(() => syncMailbox(tenantId, userId, 'worker')); expect(provider).toHaveBeenCalledTimes(1);
  });

  it('marks only authorized non-draft thread messages read, persists after success, increments revision and is idempotent', async () => {
    const incoming = mail(leadEmail, 'read-one');
    await scope(() => ingestMailboxMessages(account, [incoming, { ...mail(leadEmail, 'read-two'), threadId: incoming.threadId }, { ...mail(account.email, 'read-draft', ['DRAFT', 'UNREAD']), threadId: incoming.threadId, to: [leadEmail] }], permissions));
    const activities = await prisma.activity.count({ where: { tenantId, leadId } });
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const provider = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', provider);
    const result = await call('/threads/read-one/read-state', 'PATCH', { isRead: true });
    expect(result.status).toBe(200); expect(result.body.count).toBe(2);
    expect(provider.mock.calls).toHaveLength(2);
    for (const [path, init] of provider.mock.calls as unknown as [string, RequestInit][]) {
      expect(path).not.toContain('read-draft'); expect(JSON.parse(String(init.body)).removeLabelIds).toEqual(['UNREAD']);
    }
    expect((await call('/unread-count')).body.unreadCount).toBe(0);
    expect((await call('/threads/read-one')).body.emails).toHaveLength(2);
    expect((await call('/threads/read-one/read-state', 'PATCH', { isRead: true })).body.count).toBe(0);
    expect(provider).toHaveBeenCalledTimes(2);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).mailboxVersion).toBeGreaterThan(account.mailboxVersion);
    expect(await prisma.activity.count({ where: { tenantId, leadId } })).toBe(activities);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(after.lastCustomerReplyAt).toEqual(before.lastCustomerReplyAt); expect(after.status).toBe(before.status);
    expect((await call('/threads/read-one/read-state', 'PATCH', { isRead: false })).body.count).toBe(2);
  });
  it('does not mark persisted email read when Google rejects the write', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'read-failed')], permissions));
    const provider = vi.fn(async () => Response.json({}, { status: 403 })); vi.stubGlobal('fetch', provider);
    expect((await call('/threads/read-failed/read-state', 'PATCH', { isRead: true })).status).toBe(403);
    expect((await call('/threads/read-failed')).body.emails[0].isRead).toBe(false);
    expect((await prisma.emailAccount.findUniqueOrThrow({ where: { id: account.id } })).mailboxVersion).toBe(account.mailboxVersion);
  });
  it.each(['archive', 'trash'])('applies %s to the authorized conversation without drafts or unrelated messages and preserves activity', async action => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'mutate-one'), { ...mail(leadEmail, 'mutate-two'), threadId: 'mutate-one' }, { ...mail(account.email, 'mutate-draft', ['DRAFT']), threadId: 'mutate-one', to: [leadEmail] }], permissions));
    await prisma.mailboxMessage.create({ data: { tenantId, accountId: account.id, providerMessageId: 'personal', threadId: 'mutate-one', direction: 'inbound', from: 'bank@example.com', fromAddress: 'bank@example.com', recipients: [account.email], recipientAddresses: [account.email], subject: 'Private', snippet: 'Private', body: 'Private', labels: ['INBOX'], sentAt: new Date() } });
    const activities = await prisma.activity.count({ where: { tenantId, leadId } });
    const provider = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', provider);
    expect((await call(`/threads/mutate-one/${action}`, 'POST', {})).body.count).toBe(2);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls.every(([path]) => !String(path).includes('personal') && !String(path).includes('mutate-draft'))).toBe(true);
    expect(await prisma.activity.count({ where: { tenantId, leadId } })).toBe(activities);
    expect((await call(`/${action}`, 'POST', { messageIds: ['mutate-draft'] })).status).toBe(404);
  });
  it('persists CC and normalized Reply-To on initial and repeated ingestion without rewriting the body', async () => {
    const original = apiMail(mail(leadEmail, 'headers'), [{ name: 'Cc', value: 'Sales <sales@example.test>, "Agent, One" <one@example.test>' }, { name: 'Reply-To', value: 'Reply <REPLY@example.test>' }]);
    const parsed = parseGmailMessage(original); await scope(() => ingestMailboxMessages(account, [parsed], permissions));
    expect((await call('/threads/headers')).body.emails[0]).toMatchObject({ cc: ['Sales <sales@example.test>', '"Agent, One" <one@example.test>'], replyToAddress: 'reply@example.test' });
    await scope(() => ingestMailboxMessages(account, [{ ...parsed, replyToAddress: 'updated@example.test', body: 'Do not replace history' }], permissions));
    const email = (await call('/threads/headers')).body.emails[0]; expect(email.replyToAddress).toBe('updated@example.test'); expect(email.body).toBe(parsed.body);
  });
  it.each(['broken', 'a@example.test, b@example.test', 'safe@example.test\r\nBcc: other@example.test', 'Reply <safe@example.test>\r\nBcc: other@example.test'])('rejects unsafe Reply-To as a delivery target: %j', value => {
    expect(parseGmailMessage(apiMail(mail(leadEmail), [{ name: 'Reply-To', value }])).replyToAddress).toBeNull();
  });
  it('blocks outside Reply-To, mixed recipients, and unauthorized forward sources before Gmail', async () => {
    await scope(() => ingestMailboxMessages(account, [{ ...mail(leadEmail, 'reply-source'), replyToAddress: 'bank@example.com' }], permissions));
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const payload = { subject: 'Reply', body: '<p>Hello</p>' };
    expect((await call('/send', 'POST', { ...payload, to: 'bank@example.com', replyToMessageId: 'reply-source' })).status).toBe(403);
    expect((await call('/send', 'POST', { ...payload, to: [leadEmail, 'bank@example.com'] })).status).toBe(403);
    expect((await call('/drafts', 'POST', { ...payload, to: `${leadEmail}, bank@example.com` })).status).toBe(403);
    expect((await call('/send', 'POST', { ...payload, to: leadEmail, forwardSourceMessageId: 'personal-thread' })).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });
  async function setReadOnly(leadEdit = false, contactEdit = false) {
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Inbox access ' + randomUUID() } });
    await prisma.rolePermission.createMany({ data: [{ tenantId, roleId: role.id, module: 'leads', canView: true, canEdit: leadEdit }, { tenantId, roleId: role.id, module: 'contacts', canView: true, canEdit: contactEdit }] });
    await prisma.userRole.create({ data: { tenantId, roleId: role.id, userId } });
    await prisma.user.update({ where: { id: userId }, data: { role: 'Sales' } });
  }
  it('allows scoped reading but rejects customer sends, drafts and scheduling for a read-only role', async () => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'read-only')], permissions)); await setReadOnly();
    expect((await call('/threads/read-only')).status).toBe(200);
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const data = { to: leadEmail, subject: 'Inquiry', body: '<p>Hello</p>' };
    expect((await call('/send', 'POST', data)).status).toBe(403);
    expect((await call('/drafts', 'POST', data)).status).toBe(403);
    expect((await call('/scheduled', 'POST', { ...data, requestId: randomUUID(), scheduledAt: new Date(Date.now() + 3600000).toISOString() })).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it('requires the specific customer module edit permission', async () => {
    await setReadOnly(true, false); const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await call('/send', 'POST', { to: contactEmail, subject: 'Inquiry', body: '<p>Hello</p>' })).status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(['leads', 'contacts'])('requires current %s View permission for assigned email visibility', async module => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'lead-view'), mail(contactEmail, 'contact-view'), mail('info@camxian.com', 'fixed-view')], permissions));
    await setReadOnly();
    const userRole = await prisma.userRole.findFirstOrThrow({ where: { tenantId, userId } });
    await prisma.rolePermission.updateMany({ where: { tenantId, roleId: userRole.roleId, module }, data: { canView: false } });
    const result = await call('/emails');
    expect(result.body.emails.map((row: GmailEmail) => row.id).sort()).toEqual([module === 'leads' ? 'contact-view' : 'lead-view', 'fixed-view'].sort());
    expect((await call('/threads/' + (module === 'leads' ? 'lead-view' : 'contact-view'))).status).toBe(404);
  });
  it('rechecks revoked Edit permission at scheduled delivery', async () => {
    const queued = await queuedEmail(); await setReadOnly();
    await prisma.scheduledMailboxEmail.update({ where: { id: queued.item.id }, data: { scheduledAt: new Date(0) } });
    await runScheduledMailboxEmails(); expect(queued.sends()).toBe(0);
    expect((await prisma.scheduledMailboxEmail.findUniqueOrThrow({ where: { id: queued.item.id } })).status).toBe('failed');
  });
  it.each(['unassigned', 'archived', 'reassigned'])('removes %s records from every thread mutation scope', async state => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'revoked')], permissions));
    await prisma.lead.update({ where: { id: leadId }, data: state === 'archived' ? { isArchived: true } : { assignedUserId: state === 'unassigned' ? null : otherId } });
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect((await call('/emails')).body.emails).toHaveLength(0);
    expect((await call('/threads/revoked')).status).toBe(404);
    expect((await call('/threads/revoked/read-state', 'PATCH', { isRead: true })).status).toBe(404);
    for (const action of ['archive', 'trash']) expect((await call(`/threads/revoked/${action}`, 'POST', {})).status).toBe(404);
    expect((await call('/send', 'POST', { to: leadEmail, subject: 'Reply', body: 'Hello', replyToMessageId: 'revoked' })).status).toBe(404);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'disconnected'])('rejects %s mailbox access before provider mutation', async state => {
    await scope(() => ingestMailboxMessages(account, [mail(leadEmail, 'disabled')], permissions));
    if (state === 'inactive') {
      await prisma.lead.updateMany({ where: { tenantId, assignedUserId: userId }, data: { assignedUserId: otherId } });
      await prisma.contact.updateMany({ where: { tenantId, assignedUserId: userId }, data: { assignedUserId: otherId } });
      await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
    }
    else await prisma.emailAccount.update({ where: { id: account.id }, data: { isActive: false } });
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    expect([401, 403, 409]).toContain((await call('/threads/disabled/read-state', 'PATCH', { isRead: true })).status);
    expect(provider).not.toHaveBeenCalled();
  });
  it('claims interactive sends once across concurrent retries and returns the saved receipt', async () => {
    const outgoing = { ...mail(account.email, 'once-sent', ['SENT']), to: [leadEmail] };
    let sends = 0;
    vi.stubGlobal('fetch', vi.fn(async (_path: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') { sends++; return Response.json({ id: outgoing.id, threadId: outgoing.threadId }); }
      return Response.json(apiMail(outgoing));
    }));
    const payload = { to: leadEmail, subject: 'One send', body: '<p>Details</p>', requestId: randomUUID() };
    const responses = await Promise.all([call('/send', 'POST', payload), call('/send', 'POST', payload)]);
    expect(responses.some(result => result.status === 200)).toBe(true);
    expect(responses.every(result => [200, 409].includes(result.status))).toBe(true);
    expect(sends).toBe(1);
    expect((await call('/send', 'POST', payload)).body.messageId).toBe(outgoing.id); expect(sends).toBe(1);
    expect((await call('/send', 'POST', { ...payload, body: 'Different content' })).status).toBe(409);
    expect(await prisma.mailboxSendReceipt.count({ where: { accountId: account.id } })).toBe(1);
  });
  it('does not replay an interactive send with an unknown provider outcome', async () => {
    const provider = vi.fn(async () => { throw new Error('Connection lost after acceptance'); }); vi.stubGlobal('fetch', provider);
    const payload = { to: leadEmail, subject: 'Uncertain', body: '<p>Details</p>', requestId: randomUUID() };
    expect((await call('/send', 'POST', payload)).status).toBe(503);
    expect((await call('/send', 'POST', payload)).status).toBe(409);
    expect(provider).toHaveBeenCalledOnce();
    expect((await prisma.mailboxSendReceipt.findFirstOrThrow({ where: { accountId: account.id } })).status).toBe('uncertain');
  });
});

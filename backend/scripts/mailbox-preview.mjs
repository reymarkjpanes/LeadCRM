// Local disposable preview with simulated Gmail responses. No real email is read or sent.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
process.env.DATABASE_URL = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1`;
process.env.JWT_SECRET = randomBytes(32).toString('hex'); process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.APP_URL = 'http://localhost:3013'; process.env.ALLOWED_ORIGINS = process.env.APP_URL;
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const Module = require('module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const prisma = require(resolve(root, 'dist/backend/src/config/database.config.js')).default;
const { hashPassword } = require(resolve(root, 'dist/backend/src/shared/helpers/crypto.js'));
const { encryptToken } = require(resolve(root, 'dist/backend/src/core/encryption/crypto.service.js'));
const { salesPipeline, salesTransaction } = require(resolve(root, 'dist/backend/src/modules/crm/leads/lead-automation.service.js'));
const { ingestMailboxMessages } = require(resolve(root, 'dist/backend/src/integrations/gmail/mailbox-ingestion.service.js'));
const tenant = await prisma.tenant.create({ data: { name: 'Mailbox verification', slug: 'mailbox-verification', onboardingStep: 3, onboardingCompletedAt: new Date() } });
const user = await prisma.user.create({ data: { tenantId: tenant.id, email: 'preview@camxian.com', firstName: 'Mailbox', lastName: 'Tester', role: 'Client Admin', mustChangePassword: false, passwordHash: await hashPassword('Preview2026!') } });
const old = new Date(Date.now() - 30 * 86400000);
const { pipeline, initial } = await salesTransaction(tx => salesPipeline(tx, tenant.id));
const lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'Jamie', lastName: 'Rivera', email: 'jamie@example.test', status: 'Warm', productInterest: ['CCTV'], createdAt: old } });
const deal = await prisma.deal.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, stageId: initial.id, leadId: lead.id, title: 'Jamie Rivera — CCTV installation', value: 32500, productInterests: ['CCTV'], assignedUserId: user.id, tags: [], createdAt: old } });
await prisma.leadDeal.create({ data: { tenantId: tenant.id, leadId: lead.id, dealId: deal.id, addedById: user.id } });
const account = await prisma.emailAccount.create({ data: { tenantId: tenant.id, userId: user.id, email: user.email, accessToken: encryptToken('preview-access'), tokenExpiresAt: new Date(Date.now() + 86400000), scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: old, lastSyncAt: new Date(), syncCursor: '100' } });
const emails = [
  { id: 'message1', threadId: 'thread1', from: user.email, to: [lead.email], subject: 'CCTV installation quotation', body: '<p>Hello Jamie, here is the quotation for the CCTV installation.</p>', snippet: 'Here is the quotation.', date: new Date(Date.now() - 2 * 86400000).toISOString(), isRead: true, labels: ['SENT'], rfcMessageId: '<message1@example.test>' },
  { id: 'message2', threadId: 'thread1', from: 'Jamie Rivera <jamie@example.test>', to: [user.email], subject: 'Re: CCTV installation quotation', body: '<p>We approve the quotation and will proceed.</p><p>Please send the contract for the installation.</p>', snippet: 'We approve the quotation and will proceed.', date: new Date(Date.now() - 86400000).toISOString(), isRead: false, labels: ['INBOX', 'UNREAD'], rfcMessageId: '<message2@example.test>' },
];
await ingestMailboxMessages(account, emails, { crmEdit: true, dealsEdit: true, dealsView: true });
const apiMessage = email => ({ id: email.id, threadId: email.threadId, internalDate: String(new Date(email.date).getTime()), labelIds: email.labels, snippet: email.snippet, payload: { mimeType: 'text/html', headers: [{ name: 'From', value: email.from }, { name: 'To', value: email.to.join(', ') }, { name: 'Subject', value: email.subject }, { name: 'Message-ID', value: email.rfcMessageId }], body: { data: Buffer.from(email.body).toString('base64url') } } });
const originalFetch = globalThis.fetch;
let inboxReads = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith('https://gmail.googleapis.com/')) return originalFetch(input, init);
  if (init?.method && init.method !== 'GET') return Response.json({ error: 'Preview does not send real mail.' }, { status: 503 });
  if (url.includes('/labels/INBOX')) return Response.json({ messagesUnread: emails.filter(email => email.labels.includes('INBOX') && !email.isRead).length });
  // Opt-in, disposable reproduction of a limit after the inbox has loaded once.
  if (url.includes('/messages?') && ++inboxReads === 2 && process.env.PREVIEW_GMAIL_THROTTLE_ONCE === 'true') return Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 429, headers: { 'Retry-After': '60' } });
  if (url.includes('/history?')) return Response.json({ historyId: '100', history: [] });
  if (url.endsWith('/profile')) return Response.json({ historyId: '100' });
  if (url.includes('/threads/')) return Response.json({ messages: emails.map(apiMessage) });
  if (url.includes('/messages?')) { const query = new URL(url).searchParams.get('q') ?? ''; return Response.json({ messages: emails.filter(email => query.includes('in:sent') ? email.labels.includes('SENT') : query.includes('in:inbox') ? email.labels.includes('INBOX') : true).map(email => ({ id: email.id, threadId: email.threadId })) }); }
  return Response.json(apiMessage(emails.find(email => url.includes(email.id)) ?? emails[0]));
};
const app = require(resolve(root, 'dist/backend/src/app.js')).default;
const server = app.listen(4012, '127.0.0.1', () => console.log('Disposable mailbox preview API at http://127.0.0.1:4012; preview@camxian.com / Preview2026!'));
process.on('SIGINT', async () => { server.close(); await prisma.$disconnect(); await socket.stop(); await db.close(); process.exit(0); });

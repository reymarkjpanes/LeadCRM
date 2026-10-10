// Durable schedule acceptance across independent worker processes. Disposable DB,
// simulated Gmail only; never loads .env or transmits a real message.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const root = resolve(import.meta.dirname, '../..');
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
let message, sends = 0;
const requests = [];
const provider = createServer(async (req, res) => {
  try {
    let body = ''; for await (const part of req) body += part;
    const path = new URL(req.url, 'http://localhost').pathname.split('/me/')[1];
    requests.push({ path, method: req.method });
    let result;
    if (path === 'drafts') {
      const raw = Buffer.from(JSON.parse(body).message.raw, 'base64url').toString();
      const header = name => raw.match(new RegExp('^' + name + ': (.*)$', 'im'))?.[1].trim() ?? '';
      message = { id: 'restart-draft-message', threadId: 'restart-thread', labelIds: ['DRAFT'], internalDate: String(Date.now()), snippet: 'Restart acceptance', payload: { headers: ['From', 'To', 'Subject', 'Message-ID'].map(name => ({ name, value: header(name) })), mimeType: 'text/html', body: { data: Buffer.from('Restart acceptance').toString('base64url') } } };
      result = { id: 'restart-draft', message };
    } else if (path === 'drafts/restart-draft') result = { message };
    else if (path === 'drafts/send') { sends++; message = { ...message, id: 'restart-sent', labelIds: ['SENT'] }; result = { id: message.id, threadId: message.threadId }; }
    else if (path === 'messages/restart-sent') result = message;
    else throw new Error('Unexpected simulated provider request');
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
  } catch { res.writeHead(500); res.end('{}'); }
});
provider.listen(0, '127.0.0.1'); await new Promise(done => provider.once('listening', done));
const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_restart_test?connection_limit=1&statement_cache_size=0`, ENCRYPTION_KEY: randomBytes(32).toString('hex'), JWT_SECRET: randomBytes(32).toString('hex'), MAILBOX_TEST_SHARED: resolve(root, 'backend/dist/shared/src/index.js'), MAILBOX_TEST_PROVIDER: `http://127.0.0.1:${provider.address().port}` };
const run = async seed => {
  await db.exec('DEALLOCATE ALL'); // PGlite shares its SQL session across socket clients.
  const code = `const Module = require('node:module'), original = Module._resolveFilename;
    Module._resolveFilename = function(name, ...args) { return name === '@leadcrm/shared' ? process.env.MAILBOX_TEST_SHARED : original.call(this, name, ...args); };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => { const url = String(input); if (!url.startsWith('https://gmail.googleapis.com/')) throw new Error('External provider blocked'); return originalFetch(url.replace('https://gmail.googleapis.com', process.env.MAILBOX_TEST_PROVIDER), init); };
    const prisma = require('./backend/dist/backend/src/config/database.config.js').default;
    const { runScheduledMailboxEmails, scheduleMailboxEmail } = require('./backend/dist/backend/src/integrations/gmail/scheduled-mailbox.service.js');
    (async () => {
      if (process.env.MAILBOX_TEST_SEED === 'true') {
        const { tenantContext } = require('./backend/dist/backend/src/core/tenant/tenant-context.js');
        const { encryptToken } = require('./backend/dist/backend/src/core/encryption/crypto.service.js');
        const tenant = await prisma.tenant.create({ data: { name: 'Restart acceptance', slug: 'restart-acceptance', onboardingStep: 3, onboardingCompletedAt: new Date() } });
        const user = await prisma.user.create({ data: { tenantId: tenant.id, email: 'restart@camxian.com', firstName: 'Restart', lastName: 'Test', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
        await prisma.emailAccount.create({ data: { tenantId: tenant.id, userId: user.id, email: user.email, accessToken: encryptToken('simulated'), tokenExpiresAt: new Date(Date.now()+3600000), scopes: ['https://www.googleapis.com/auth/gmail.modify'] } });
        await prisma.lead.create({ data: { tenantId: tenant.id, assignedUserId: user.id, email: 'customer@example.test', firstName: 'Customer', lastName: 'Test', productInterest: [] } });
        await tenantContext.run({ tenantId: tenant.id }, () => scheduleMailboxEmail(tenant.id, user.id, { to: 'customer@example.test', subject: 'Restart acceptance', body: 'Hello', scheduledAt: new Date(Date.now()+3600000).toISOString(), requestId: require('node:crypto').randomUUID() }));
      }
      await runScheduledMailboxEmails();
    })().then(() => prisma.$disconnect()).catch(async error => { console.error(error.message); await prisma.$disconnect(); process.exitCode = 1; });`;
  const child = spawn(process.execPath, ['-e', code], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...env, MAILBOX_TEST_SEED: String(seed) } });
  child.stderr.pipe(process.stderr);
  assert.equal(await new Promise((done, fail) => { child.once('error', fail); child.once('exit', done); }), 0);
};
try {
  await run(true); assert.equal(sends, 0);
  assert.equal((await db.query('SELECT status FROM "ScheduledMailboxEmail"')).rows[0].status, 'pending');
  await db.exec('UPDATE "ScheduledMailboxEmail" SET "scheduledAt" = TIMESTAMP \'2000-01-01 00:00:00\'');
  await run(false);
  assert.equal(sends, 1, JSON.stringify({ requests, jobs: (await db.query('SELECT status, "lastError", "attemptCount", "scheduledAt" FROM "ScheduledMailboxEmail"')).rows }));
  await run(false); assert.equal(sends, 1);
  assert.equal((await db.query('SELECT status FROM "ScheduledMailboxEmail"')).rows[0].status, 'sent');
  console.log(JSON.stringify({ passed: true, independentWorkerProcesses: 3, durableDatabase: true, sends, provider: 'Simulated; no real email sent' }));
} finally {
  provider.closeAllConnections(); await new Promise(done => provider.close(done)); await socket.stop(); await db.close();
}

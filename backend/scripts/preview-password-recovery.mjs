// Browser-only disposable preview. No application database, real mail, seeds, or workers.
// Run after npm run build. Stop with Ctrl+C; the isolated PostgreSQL server is stopped too.
import { notificationTestPostgres } from './notification-test-postgres.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const pg = await notificationTestPostgres();
let next, server, db, stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true;
  next?.kill(); server?.close(); await db?.$disconnect(); pg.stop(); process.exit(typeof code === 'number' ? code : 0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  const database = await pg.database('leadcrm_forms_test_3');
  Object.assign(process.env, {
    DATABASE_URL: database, DIRECT_URL: database, NODE_ENV: 'test', APP_URL: 'http://localhost:3210', ALLOWED_ORIGINS: 'http://localhost:3210',
    JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), PASSWORD_RESET_TTL_MINUTES: '25',
    BREVO_API_KEY: 'xkeysib-disposable-browser-provider', BREVO_FROM_EMAIL: 'sender@example.invalid', BREVO_SANDBOX_EMAILS: '',
    LEADCRM_TEST_AUTH_ENABLED: 'false', LEADCRM_PRODUCTION_AUTH_ENABLED: 'false',
  });
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : original.call(this, request, ...args);
  };
  let providerRequests = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.brevo.com/v3/smtp/email') return realFetch(url, options);
    providerRequests++;
    const to = JSON.parse(options.body).to[0].email;
    if (to === 'reject@camxian.com') return new Response('{}', { status: 401 });
    if (to === 'timeout@camxian.com') throw new DOMException('Simulated uncertain outcome', 'TimeoutError');
    return new Response('{"messageId":"disposable-browser-acceptance"}', { status: 201 });
  };
  db = require(resolve(root, 'backend/dist/backend/src/config/database.config.js')).default;
  const { hashPassword } = require(resolve(root, 'backend/dist/backend/src/shared/helpers/crypto.js'));
  const tenant = await db.tenant.create({ data: { name: 'Disposable recovery preview', slug: 'browser-recovery', status: 'ACTIVE' } });
  for (const email of ['browser@camxian.com', 'reject@camxian.com', 'timeout@camxian.com', 'inactive@camxian.com']) {
    await db.user.create({ data: { tenantId: tenant.id, email, firstName: 'Browser', lastName: 'Test', role: 'Sales',
      status: email.startsWith('inactive') ? 'INACTIVE' : 'ACTIVE', passwordHash: await hashPassword('Disposable1!'), mustChangePassword: false } });
  }
  const express = require('express'); const preview = express();
  preview.get('/__recovery_evidence', async (_req, res) => res.json({ providerRequests, resetTokens: await db.passwordResetToken.count() }));
  preview.use(require(resolve(root, 'backend/dist/backend/src/app.js')).default);
  server = preview.listen(4210, '127.0.0.1');
  next = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--port', '3210'], {
    cwd: resolve(root, 'frontend'), stdio: 'inherit', windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', API_URL: 'http://127.0.0.1:4210/api/v1', NEXT_PUBLIC_USE_MOCK_AUTH: 'false', NEXT_PUBLIC_USE_MOCK_DATA: 'false' },
  });
  next.on('exit', stop);
  console.log('Disposable recovery browser preview: http://localhost:3210/login (simulated provider; 25-minute links).');
} catch {
  console.error('Disposable recovery preview setup failed.');
  await stop(1);
}

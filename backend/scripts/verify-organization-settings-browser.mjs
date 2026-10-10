// Local production-build acceptance with disposable PostgreSQL; never opens the configured database.
// Run after npm run build. Pass an installed Playwright package path as the first argument if needed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'data/outputs/organization-settings-browser');
mkdirSync(output, { recursive: true });
const base = 'http://localhost:3023';
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_account_test_2?connection_limit=1`,
  JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base,
});
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options);
};
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
const checks = [], pageErrors = [], transportErrors = [];
let api, frontend, browser, closing = false;
const pass = label => { checks.push(label); console.log('PASS', label); };
try {
  const tenant = await prisma.tenant.create({ data: { name: 'Organization Acceptance', slug: randomUUID(), status: 'ACTIVE', industry: 'Technology', email: 'info@camxian.com', phone: '+63281233488', domain: 'camxian.com', website: 'https://separate.example', address: 'Manila', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const createUser = async (role, suffix) => {
    const user = await prisma.user.create({ data: { tenantId: tenant.id, firstName: suffix, lastName: 'Tester', email: `org-${suffix}@camxian.com`, role, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    if (role === 'Settings Reader') {
      const definition = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: role, permissions: { create: { module: 'settings', canView: true } } } });
      await prisma.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: definition.id } });
    }
    return (await issueAuthSession(user)).token;
  };
  const adminToken = await createUser('Client Admin', 'admin');
  const readerToken = await createUser('Settings Reader', 'reader');
  const deniedToken = await createUser('No Settings', 'denied');
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3023', '-H', '127.0.0.1'], {
    cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' },
  });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch {}
    if (frontend.exitCode !== null) throw new Error('Frontend exited before readiness');
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, 'Production frontend became ready');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function open(token) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => pageErrors.push(error.message));
    let failSave = false;
    // Match existing local acceptance scripts: redirect transport only; auth, RBAC, services and SQL are real.
    await page.route('**/api/proxy/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (failSave && request.method() === 'PATCH' && url.pathname.endsWith('/organization-settings')) {
        failSave = false; await route.fulfill({ status: 500, json: { error: 'Acceptance save failure' } }); return;
      }
      try {
        const response = await context.request.fetch(`http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`, {
          method: request.method(), headers: { ...request.headers(), authorization: `Bearer ${token}` },
          data: request.postDataBuffer() ?? undefined,
        });
        await route.fulfill({ response });
      } catch (error) {
        if (!closing) transportErrors.push(`${request.method()} ${url.pathname}: ${String(error).split('\n')[0]}`);
        await route.abort().catch(() => {});
      }
    });
    return { page, context, failNextSave: () => { failSave = true; } };
  }
  const admin = await open(adminToken), page = admin.page;
  await page.goto(base + '/settings?tab=account-details');
  await page.waitForURL('**/settings?tab=org-general');
  const system = page.getByRole('region', { name: 'System Information' });
  await system.waitFor();
  assert.equal(await system.getByText(tenant.id, { exact: true }).count(), 1);
  assert.equal(await system.getByText('Active', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Account Details', { exact: true }).count(), 0);
  assert.equal(await page.locator('optgroup[label="ACCOUNT"]').count(), 0);
  assert.equal(await page.getByLabel('Domain', { exact: true }).inputValue(), 'camxian.com');
  pass('Legacy tab normalizes to General; authoritative ID, status and domain; no Account navigation');
  await page.getByRole('button', { name: 'Copy Account ID' }).click();
  await page.getByText('Account ID copied', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), tenant.id);
  pass('Full Account ID copies to the real browser clipboard with confirmation');
  for (const width of [1440, 1024, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('form').evaluate(form => ({
      overflow: form.scrollWidth > form.clientWidth + 1,
      outside: [...form.querySelectorAll('input, select, textarea, button')].some(el => el.getClientRects().length && (el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1)),
    }));
    assert.deepEqual(layout, { overflow: false, outside: false }, `width ${width}`);
    await page.screenshot({ path: resolve(output, `general-${width}.png`), fullPage: true });
    await system.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `system-information-${width}.png`) });
    await page.getByRole('heading', { name: 'General', exact: true }).scrollIntoViewIfNeeded();
    pass(`General form and System Information fit at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = page.getByLabel('Organization Name', { exact: false });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await system.locator('input,select,textarea').count(), 0);
  await name.fill('Cancelled edit'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await name.inputValue(), tenant.name);
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); await name.fill('Saved Organization');
  await page.getByLabel('Domain', { exact: true }).fill('updated.example');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByText('Organization settings saved successfully', { exact: true }).waitFor();
  assert.equal(await name.inputValue(), 'Saved Organization');
  assert.equal(await name.getAttribute('readonly'), '');
  assert.ok(await page.locator('aside').getByText('Saved Organization', { exact: true }).count());
  assert.deepEqual(await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { name: true, domain: true, website: true, status: true } }), { name: 'Saved Organization', domain: 'updated.example', website: 'https://separate.example', status: 'ACTIVE' });
  pass('Edit, Cancel, persisted save, sidebar name synchronization and separate website preservation');
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); await name.fill('Failed unsaved name');
  admin.failNextSave(); await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByText('Acceptance save failure', { exact: true }).waitFor();
  assert.equal(await name.getAttribute('readonly'), null);
  assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).name, 'Saved Organization');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await name.inputValue(), 'Saved Organization');
  pass('Failed save leaves persisted data intact and Cancel restores the saved snapshot');
  await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'SANDBOX' } });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await system.getByText('Sandbox', { exact: true }).waitFor();
  pass('Window focus refreshes authoritative account status');
  await page.goto(base + '/settings/account'); await system.waitFor();
  assert.ok(page.url().endsWith('/settings?tab=org-general'));
  assert.equal(await page.getByLabel('Domain', { exact: true }).inputValue(), 'updated.example');
  pass('Legacy route redirects and navigation reloads persisted profile values');
  for (const [tab, heading] of [
    ['profile', 'Personal Information'], ['appearance', 'System Appearance'], ['users', 'Team Management'],
    ['roles', 'Roles & Permissions'], ['custom-fields', 'Custom Fields'], ['products', 'Products'],
    ['archived', 'Archived Data Recovery'], ['forms', 'Forms'],
  ]) {
    await page.goto(base + `/settings?tab=${tab}`);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'System Information' }).count(), 0);
    pass(`Existing ${tab} settings section renders without duplicate system information`);
  }
  const reader = await open(readerToken);
  await reader.page.goto(base + '/settings/account'); await reader.page.getByRole('region', { name: 'System Information' }).waitFor();
  assert.equal(await reader.page.getByRole('button', { name: 'Edit', exact: true }).count(), 0);
  pass('View-only custom role can read General via the legacy route without Edit');
  const denied = await open(deniedToken);
  for (const path of ['/settings/account', '/settings?tab=account-details', '/settings?tab=org-general']) {
    await denied.page.goto(base + path);
    await denied.page.getByRole('alert').filter({ hasText: 'You do not have permission' }).waitFor();
    assert.equal(await denied.page.getByRole('region', { name: 'System Information' }).count(), 0);
    assert.equal(await denied.page.getByLabel('Domain', { exact: true }).count(), 0);
  }
  pass('Custom role without View cannot render protected data through either legacy URL or General');
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors, boundary: 'Local production frontend; API transport redirected to disposable backend; deployed proxy and production database not tested' }, null, 2));
  console.log(`Completed ${checks.length} browser checks without page or transport errors.`);
} finally {
  closing = true;
  await browser?.close(); frontend?.kill();
  if (api) await new Promise(done => api.close(done));
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

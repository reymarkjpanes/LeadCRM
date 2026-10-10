// Browser acceptance against a disposable DB and locally built application.
// Usage: set PLAYWRIGHT_MODULE to an installed Playwright package, then run.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'data/outputs/lead-polish-browser');
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = 'http://localhost:3019';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_custom_fields_browser?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base });
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.ALLOWED_ORIGINS = base;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const { salesPipeline, salesTransaction } = require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
let api, frontend, browser, page, closing = false;
const checks = [], pageErrors = [], transportErrors = [];
try {
  const tenant = await prisma.tenant.create({ data: { name: 'Lead Polish Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Custom', lastName: 'Tester', email: 'custom-preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin);
  await prisma.productInterest.create({ data: { tenantId: tenant.id, name: 'CCTV Acceptance', dealValue: 25000 } });
  const scope = run => tenantContext.run({ tenantId: tenant.id }, run);
  await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  const account = await prisma.account.create({ data: { tenantId: tenant.id, name: 'QAAccount', internalNotes: 'Historical note', activeProducts: ['Historical product'] } });
  const lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'QALead', lastName: 'Tester', email: 'lead@example.test', companyName: ' McDonalds ' } });
  const contact = await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'QAContact', lastName: 'Tester', email: 'contact@example.test', company: 'McDonalds' } });
  const pipeline = await prisma.pipeline.findFirstOrThrow({ where: { tenantId: tenant.id }, include: { stages: true } });
  const deal = await prisma.deal.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id, title: 'QADeal', value: 100 } });
  const role = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Sales Agent' } });
  await prisma.rolePermission.createMany({ data: ['leads','contacts','accounts','deals'].map(module => ({ tenantId: tenant.id, roleId: role.id, module, canView: true, canEdit: true, canCreate: true })) });
  const agents = [];
  for (const firstName of ['Departure', 'Replacement']) {
    const agent = await prisma.user.create({ data: { tenantId: tenant.id, firstName, lastName: 'Agent', email: `${firstName.toLowerCase()}@camxian.com`, role: role.name, status: 'ACTIVE', mustChangePassword: false } });
    await prisma.userRole.create({ data: { tenantId: tenant.id, roleId: role.id, userId: agent.id } });
    agents.push(agent);
  }
  const [departing, replacement] = agents;
  for (const [kind, row] of [['lead',lead],['contact',contact],['account',account],['deal',deal]]) await prisma[kind].update({ where: { id: row.id }, data: { assignedUserId: departing.id } });
  for (const [key, record] of [['leadId', lead], ['contactId', contact], ['accountId', account], ['dealId', deal]]) {
    for (let i = 0; i < 16; i++) await prisma.activity.create({ data: { tenantId: tenant.id, [key]: record.id, type: 'note', title: `QA activity ${i}`, description: 'Timeline scrolling acceptance', createdById: admin.id } });
  }
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3019', '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => pageErrors.push(error.message));
  // Only the browser transport is redirected; authentication and all data use the real local API/SQL.
  await page.route('**/api/proxy/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    try {
      const response = await page.request.fetch(`http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`, { method: request.method(), headers: { ...request.headers(), authorization: `Bearer ${token}` }, data: request.postDataBuffer() ?? undefined, maxRetries: request.method() === 'GET' ? 2 : 0 });
      await route.fulfill({ response });
    } catch (error) {
      if (!closing) transportErrors.push(`${request.method()} ${url.pathname}: ${String(error).split('\n')[0]}`);
      await route.abort().catch(() => {});
    }
  });
  const navigate = path => page.goto(base + path);
  const record = label => { checks.push({ label }); console.log('PASS', label); };
  async function responsive(label, rootLocator) {
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(350);
      const dimensions = await rootLocator.evaluate(root => ({ width: innerWidth, overflow: root.scrollWidth > root.clientWidth + 1, outside: [...root.querySelectorAll('input, select, textarea, button')].filter(el => el.getClientRects().length && (el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1)).map(el => el.getAttribute('aria-label') || el.textContent) }));
      assert.equal(dimensions.overflow, false, JSON.stringify(dimensions)); assert.deepEqual(dimensions.outside, [], JSON.stringify(dimensions));
      if (label === 'task-picker') {
        const done = rootLocator.getByRole('button', { name: 'Done', exact: true });
        await done.scrollIntoViewIfNeeded();
        const bounds = await done.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900);
      }
      if (label.startsWith('audience-') && label !== 'audience-product-options') {
        const footer = rootLocator.getByRole('button', { name: 'Create Audience', exact: true });
        const bounds = await footer.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900);
      }
      await page.screenshot({ path: resolve(output, `${label}-${width}.png`) });
      checks.push({ label, ...dimensions });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await navigate('/crm/leads');
  await page.getByRole('button', { name: 'Create Lead', exact: true }).click();
  await page.getByText('Create New', { exact: true }).click();
  const form = page.locator('form').last();
  assert.equal(await form.getByLabel('Status', { exact: true }).inputValue(), 'Warm');
  assert.equal(await form.getByLabel('Description', { exact: true }).count(), 0);
  assert.equal(await form.getByLabel('Website', { exact: true }).count(), 0);
  const selector = form.getByLabel('Assigned Agent', { exact: true });
  const options = await selector.locator('option').evaluateAll(rows => rows.map(row => row.value));
  assert.deepEqual(new Set(options), new Set(['',departing.id,replacement.id]));
  await form.getByLabel('First Name *', { exact: true }).fill('Browser');
  await form.getByLabel('Last Name *', { exact: true }).fill('Acceptance');
  await form.getByLabel('Email *', { exact: true }).fill('browser-lead@example.test');
  await selector.selectOption(replacement.id);
  const phone = form.locator('input[type="tel"]');
  await phone.fill('912');
  await form.getByRole('button', { name: 'Create Lead', exact: true }).click();
  assert.equal(await prisma.lead.count({ where: { email: 'browser-lead@example.test' } }), 0);
  await phone.fill('9123456789');
  await form.getByLabel('Company Name', { exact: true }).fill('Browser Company');
  await form.getByLabel('Full Address', { exact: true }).fill('First line\nSecond line');
  await responsive('lead-create', form);
  await form.getByRole('button', { name: 'Create Lead', exact: true }).click();
  await page.getByText('Browser Acceptance', { exact: true }).first().waitFor();
  const saved = await prisma.lead.findFirstOrThrow({ where: { email: 'browser-lead@example.test' } });
  assert.equal(saved.phone, '+639123456789'); assert.equal(saved.address, 'First line\nSecond line');
  assert.equal(saved.assignedUserId, replacement.id); record('Lead form validation and SQL persistence');
  await navigate('/settings?tab=users');
  await page.getByRole('button', { name: 'Deactivate Departure Agent', exact: true }).click();
  const transfer = page.getByRole('alertdialog');
  await transfer.getByText('Reassign CRM Records', { exact: true }).waitFor();
  assert.equal(await transfer.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true);
  await transfer.getByLabel('Assigned Agent').selectOption(replacement.id);
  await responsive('deactivation-reassignment', transfer);
  await transfer.getByRole('button', { name: 'Continue', exact: true }).click();
  await transfer.getByText('Deactivate this user?', { exact: true }).waitFor();
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: departing.id } })).status, 'ACTIVE');
  await transfer.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).assignedUserId, departing.id); record('Cancel leaves user and CRM ownership unchanged');
  await page.getByRole('button', { name: 'Deactivate Departure Agent', exact: true }).click();
  await transfer.getByLabel('Assigned Agent').selectOption(replacement.id);
  await transfer.getByRole('button', { name: 'Continue', exact: true }).click();
  await responsive('deactivation-final-confirmation', transfer);
  await transfer.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await page.getByRole('button', { name: 'Activate Departure Agent', exact: true }).waitFor();
  for (const [kind, row] of [['lead',lead],['contact',contact],['account',account],['deal',deal]]) assert.equal((await prisma[kind].findUniqueOrThrow({ where: { id: row.id } })).assignedUserId, replacement.id);
  record('Final confirmation transfers all four modules and immediately renders Inactive');
  await navigate('/crm/leads');
  await page.getByRole('button', { name: 'Create Lead', exact: true }).click();
  await page.getByText('Create New', { exact: true }).click();
  assert.equal(await page.locator('form').last().getByLabel('Assigned Agent').locator(`option[value="${departing.id}"]`).count(), 0);
  record('Deactivated agent removed from Lead assignment options');
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors }, null, 2));
  console.log(`Browser acceptance passed: ${checks.length} checks.`);
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors, error: String(error) }, null, 2));
  throw error;
} finally {
  closing = true;
  await browser?.close(); frontend?.kill(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

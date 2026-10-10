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
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'data/outputs/ui-fixes-browser');
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = 'http://localhost:3017';
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
  const tenant = await prisma.tenant.create({ data: { name: 'UI Fix Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
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
  for (const [key, record] of [['leadId', lead], ['contactId', contact], ['accountId', account], ['dealId', deal]]) {
    for (let i = 0; i < 16; i++) await prisma.activity.create({ data: { tenantId: tenant.id, [key]: record.id, type: 'note', title: `QA activity ${i}`, description: 'Timeline scrolling acceptance', createdById: admin.id } });
  }
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3017', '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
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
  await navigate('/crm/contacts');
  await page.getByRole('button', { name: 'Create Contact', exact: true }).click();
  await page.getByText('Create New', { exact: true }).click();
  await page.getByLabel('Full Address', { exact: true }).fill('123 QA Street, Manila');
  await page.getByLabel('First Name', { exact: false }).fill('NewQA'); await page.getByLabel('Last Name', { exact: false }).fill('Contact'); await page.getByLabel('Email', { exact: false }).fill('newqa@example.test');
  await responsive('contact-create', page.locator('form').last());
  await page.locator('form button[type="submit"]').click();
  await page.getByText('NewQA', { exact: true }).first().waitFor();
  assert.equal((await prisma.contact.findFirstOrThrow({ where: { tenantId: tenant.id, email: 'newqa@example.test' } })).address, '123 QA Street, Manila'); record('Contact Full Address persists existing address');
  assert.ok(await page.getByText('Assigned Agent', { exact: true }).count());
  await navigate('/crm/leads'); await page.getByText('Assigned Agent', { exact: true }).first().waitFor(); record('Lead Assigned Agent column visible');
  await navigate('/crm/accounts'); await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  await page.getByText('Create New', { exact: true }).click();
  const accountForm = page.locator('form').last();
  assert.equal(await accountForm.getByLabel('Assigned Agent').locator('option:checked').innerText(), 'Assign automatically');
  assert.equal(await accountForm.getByText('Active Products', { exact: true }).count(), 0); assert.equal(await accountForm.getByText('Internal Notes', { exact: true }).count(), 0);
  await responsive('account-create', accountForm);
  await accountForm.getByLabel('Account Name *').fill('NewQA Account'); await accountForm.locator('button[type="submit"]').click();
  await page.getByText('NewQA Account', { exact: true }).first().waitFor();
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).internalNotes, 'Historical note'); record('Account creation and historical notes preserved');
  for (const [module, name] of [['leads', 'QALead'], ['contacts', 'QAContact'], ['accounts', 'QAAccount'], ['deals', 'QADeal']]) {
    await navigate(`/crm/${module}`); await page.getByText(module === 'leads' ? `${name} Tester` : name, { exact: true }).first().click();
    const scroll = page.locator('[data-record-scroll]'); await scroll.waitFor();
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const browserY = await page.evaluate(() => scrollY);
    await scroll.getByRole('button', { name: 'Log an activity' }).click();
    await page.waitForTimeout(600);
    assert.ok(await scroll.evaluate(el => el.scrollTop < 100)); assert.equal(await page.evaluate(() => scrollY), browserY);
    await scroll.getByPlaceholder('Write a note...').waitFor(); record(`${module} Quick Log scroll stays in panel`);
    assert.ok(await scroll.evaluate(el => el.contains(document.activeElement)));
    if (module === 'deals') {
      await page.getByRole('tab', { name: /Details/ }).click();
      const toggle = page.getByRole('button', { name: 'Closed Won Requirements', exact: true });
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click(); assert.equal(await toggle.getAttribute('aria-expanded'), 'true'); record('Closed Won collapse');
    }
  }
  await navigate('/operations/taskboard'); await page.getByRole('button', { name: /Create task/i }).first().click();
  const due = page.getByLabel('Due date and time *'); const previousDue = await due.textContent(); await due.click();
  await page.getByLabel('Due minute').selectOption('17'); await page.getByRole('group', { name: 'Choose due date and time' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await due.textContent(), previousDue); await due.click(); await page.getByLabel('Due minute').selectOption('23');
  await responsive('task-picker', page.getByRole('group', { name: 'Choose due date and time' }));
  await page.getByRole('button', { name: 'Done', exact: true }).click(); assert.match(await due.textContent(), /:23$/); record('Task Cancel and Done');
  await page.getByLabel('Title *').fill('QA task saved'); await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByText('QA task saved', { exact: true }).first().waitFor();
  assert.equal(await prisma.task.count({ where: { tenantId: tenant.id, title: 'QA task saved' } }), 1); record('Task creation persists');
  await navigate('/marketing/campaigns'); await page.getByRole('button', { name: 'Create Campaign', exact: true }).first().click();
  assert.equal(await page.getByRole('button', { name: 'Multi', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Email', exact: true }).waitFor(); await page.getByRole('button', { name: 'SMS', exact: true }).waitFor();
  await page.getByRole('button', { name: /New Audience|Create Audience|Add Audience|New$/ }).last().click();
  await page.getByRole('button', { name: '+ Add Condition', exact: true }).click();
  assert.equal(await page.getByText('Select a status.', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Create Audience', exact: true }).click(); await page.getByText('Select a status.', { exact: true }).waitFor();
  await page.getByLabel('Field', { exact: true }).selectOption('company');
  const company = page.getByLabel('Value *', { exact: true });
  await company.selectOption('McDonalds'); assert.equal(await company.locator('option', { hasText: 'McDonalds' }).count(), 1);
  const audienceRoot = page.getByText('Create Target Audience', { exact: true }).locator('xpath=../..').locator('..');
  await audienceRoot.getByText('2 eligible recipients', { exact: true }).waitFor(); record('Company audience preview returns matching CRM records');
  await responsive('audience-company', audienceRoot);
  await page.getByLabel('Field', { exact: true }).selectOption('createdAt'); await page.getByLabel('Operator', { exact: true }).selectOption('gte');
  await responsive('audience-date', audienceRoot);
  await page.getByLabel('Field', { exact: true }).selectOption('productInterest'); await responsive('audience-products', audienceRoot);
  await audienceRoot.getByRole('button', { name: 'Product Interest', exact: true }).click();
  const choices = page.getByRole('group', { name: 'Product interests', exact: true });
  await choices.getByRole('checkbox', { name: 'CCTV Acceptance' }).waitFor();
  await responsive('audience-product-options', choices);
  assert.equal(await page.getByText('Select a Product Interest.', { exact: true }).count(), 0);
  await choices.getByRole('checkbox', { name: 'CCTV Acceptance' }).check(); await choices.press('Escape');
  record('Product popup remains unvalidated while choosing and fits six widths');
  record('Audience validation, companies, and six responsive widths');
  await navigate('/settings?tab=custom-fields'); await page.getByRole('button', { name: 'Add New Field', exact: true }).click();
  const group = page.getByLabel('Group / Section', { exact: false }); assert.equal(await group.evaluate(el => el.tagName), 'SELECT');
  await group.selectOption('Organization'); await page.getByLabel(/^Module/).selectOption('deals'); assert.equal(await group.inputValue(), '');
  await group.selectOption('Closed Won Requirements'); record('Module-aware group dropdown');
  await context.clearCookies();
  await page.route('**/api/proxy/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Unauthenticated' }) }));
  const resetToken = randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({ data: { userId: admin.id, email: admin.email, token: resetToken, expires: new Date(Date.now() + 3600000) } });
  await navigate(`/reset-password?token=${resetToken}`);
  await page.getByLabel('New Password', { exact: true }).fill('StrongPassword2!'); await page.getByLabel('Confirm Password', { exact: true }).fill('Different3!');
  await page.getByText('Passwords do not match.', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Reset Password', exact: true }).isDisabled(), true);
  await page.getByLabel('Confirm Password', { exact: true }).fill('StrongPassword2!'); assert.equal(await page.getByRole('button', { name: 'Reset Password', exact: true }).isEnabled(), true);
  await page.getByRole('progressbar', { name: 'Password requirements met' }).waitFor(); await responsive('reset-password', page.locator('form')); record('Shared password strength and confirmation');
  await page.getByRole('button', { name: 'Reset Password', exact: true }).click(); await page.getByText('Password Updated', { exact: true }).waitFor();
  assert.equal(await prisma.passwordResetToken.count({ where: { token: resetToken } }), 0);
  assert.equal(await prisma.session.count({ where: { userId: admin.id } }), 0); record('Valid local reset token consumed and sessions revoked');
  const reset = value => page.request.post(`http://127.0.0.1:${api.address().port}/api/v1/auth/reset-password`, { data: { token: value, password: 'DifferentPassword3!' } });
  assert.equal((await reset(resetToken)).status(), 400);
  assert.equal((await reset(randomBytes(32).toString('hex'))).status(), 400);
  const expiredToken = randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({ data: { userId: admin.id, email: admin.email, token: expiredToken, expires: new Date(Date.now() - 60000) } });
  assert.equal((await reset(expiredToken)).status(), 400); record('Reused, invalid, and expired reset tokens rejected');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(transportErrors, []);
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

import { acceptancePort, responsiveMatrix, createAcceptanceContext } from './verify-browser-matrix.mjs';
// Real UI, authenticated local API and disposable SQL; no provider submissions.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = process.env.LEADCRM_BROWSER_OUTPUT || (process.env.CAMPAIGN_VARIABLES_OUTPUT || resolve(tmpdir(), 'leadcrm-campaign-variables'));
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = `http://localhost:${await acceptancePort()}`;
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_variables_browser?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base, BREVO_API_KEY: '', BREVO_FROM_NAME: 'Configured Preview Sender', BREVO_FROM_EMAIL: 'configured@example.test', TEXTBEE_API_KEY: '' });
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
let api, frontend, browser, page, closing = false;
const checks = [], pageErrors = [], transportErrors = [];
const record = label => { checks.push(label); console.log('PASS', label); };
try {
  const tenant = await prisma.tenant.create({ data: { name: 'Configured SMS Organization', email: 'organization@example.test', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Variable', lastName: 'Tester', email: 'variables-preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin);
  const ageIds = {};
  for (const module of ['leads', 'contacts', 'accounts', 'deals']) {
    const id = ageIds[module] = randomUUID();
    await prisma.closingFieldDefinition.create({ data: { tenantId: tenant.id, id, definition: { id, technicalAlias: 'age', name: 'Age', type: 'Number', module, group: 'Basic Information', active: true, required: false, visibleInForm: true, visibleInDetails: true, order: 100, description: '', options: [], version: 1 } } });
  }
  const saved = {};
  for (const entity of ['lead', 'contact']) saved[entity] = await tenantContext.run({ tenantId: tenant.id }, () => workflows.createWorkflow(tenant.id, admin.id, { name: `${entity} variables`, trigger: `${entity}.created`, isActive: false, actions: [{ type: 'create_task', config: { title: 'Follow up with ', description: 'Legacy {{first_name}}' } }] }));
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const apiBase = `http://127.0.0.1:${api.address().port}/api/v1`;
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', new URL(base).port, '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://build-verification.example.invalid/api/v1', NEXT_PUBLIC_USE_MOCK_AUTH: 'false', NEXT_PUBLIC_USE_MOCK_DATA: 'false' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { sandboxedFrames: true, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(120000); page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const localUrl = apiBase + url.pathname.replace('/api/proxy', '') + url.search;
    const headers = { ...request.headers(), authorization: `Bearer ${token}` };
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/record-events')) return route.continue({ url: localUrl, headers });
    try {
      const response = await page.request.fetch(localUrl, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined });
      await route.fulfill({ response });
    } catch (error) { if (!closing) transportErrors.push(String(error).split('\n')[0]); await route.abort().catch(() => {}); }
  });
  await page.goto(base + '/marketing/campaigns');
  await page.getByRole('button', { name: 'Create Campaign', exact: true }).and(page.getByTitle('Create Campaign', { exact: true })).click();
  await page.getByLabel('Target Audience', { exact: false }).selectOption('LEADS');
  const body = page.getByLabel('Body', { exact: false }), subject = page.getByLabel('Subject Line', { exact: false });
  await body.fill('Hi {{firstName}}, your age is {{customFieldValues.age}}. {{sender_name}} {{sender_email}} Existing deal value: {{value}}');
  await subject.fill('Welcome '); await subject.focus();
  await page.getByRole('button', { name: '{{firstName}}', exact: true }).click();
  assert.equal(await subject.inputValue(), 'Welcome {{firstName}}'); record('Quick fields insert current keys into the active subject');
  for await (const { theme, width } of responsiveMatrix(page)) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Insert Variable', exact: true }).click();
    const picker = page.locator('div').filter({ has: page.getByRole('textbox', { name: 'Search variables', exact: true }), hasText: 'Standard Fields' }).last();
    assert.deepEqual(await picker.locator('p').allTextContents(), ['Standard Fields', 'Custom Fields', 'Sender']);
    assert.equal(await picker.getByRole('button', { name: /Deal Value.*value/ }).count(), 0);
    assert.equal(await picker.getByRole('button', { name: /Age.*customFieldValues.age.*(?:Accounts|Deals)/ }).count(), 0);
    assert.equal(await picker.getByRole('button', { name: /First Name.*firstName/ }).isDisabled(), false);
    assert.ok((await body.inputValue()).includes('{{value}}'), 'Existing relationship variables must remain unchanged');
    assert.equal(await picker.getByRole('button', { name: /Age.*customFieldValues.age.*Leads/ }).isDisabled(), false);
    assert.equal(await picker.getByRole('button', { name: /Age.*customFieldValues.age.*Contacts/ }).isDisabled(), true);
    const bounds = await picker.boundingBox(); assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `Picker bounds at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Page overflow at ${width}`);
    await page.screenshot({ path: resolve(output, `campaign-picker-${theme}-${width}.png`) });
    await page.getByRole('textbox', { name: 'Search variables', exact: true }).press('Escape');
    record(`Three categories, disabled origins and bounded picker at ${width}`);
  }
  await body.fill('Thank you, customer.'); await body.focus();
  await body.evaluate(node => node.setSelectionRange(11, 19));
  await page.getByRole('button', { name: 'Insert Variable', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search variables', exact: true }).fill('Age');
  await page.getByRole('button', { name: /Age.*customFieldValues.age.*Leads/ }).click();
  assert.equal(await body.inputValue(), 'Thank you, {{customFieldValues.age}}.'); record('Custom alias replaces selected body text and closes picker');
  await body.fill('Hi {{firstName}} {{sender_name}} {{sender_email}}');
  await page.getByTitle('Email body preview').waitFor();
  const preview = await page.getByTitle('Email body preview').getAttribute('srcdoc');
  assert.ok(preview.includes('Hi John Configured Preview Sender configured@example.test')); record('Preview uses canonical recipient samples and actual configured email identity');
  await body.fill('Visit https://example.test/products?a=1&b=2.');
  const linkedPreview = await page.getByTitle('Email body preview').getAttribute('srcdoc');
  assert.ok(linkedPreview.includes('href="https://example.test/products?a=1&amp;b=2" style="color: #2563eb; text-decoration: underline;"'));
  record('Email preview renders an exact blue underlined URL without opening an external site');
  const field = await prisma.closingFieldDefinition.findUniqueOrThrow({ where: { tenantId_id: { tenantId: tenant.id, id: ageIds.leads } } });
  await prisma.closingFieldDefinition.update({ where: { tenantId_id: { tenantId: tenant.id, id: ageIds.leads } }, data: { definition: { ...field.definition, name: 'Customer Age' } } });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { name: 'Changed SMS Organization', email: 'changed@example.test' } });
  await page.getByRole('button', { name: 'Insert Variable', exact: true }).click();
  await page.getByRole('button', { name: /Customer Age.*customFieldValues.age.*Leads/ }).waitFor(); record('Reopening refreshes renamed label without changing the alias or canonical ID');
  await page.getByRole('textbox', { name: 'Search variables', exact: true }).press('Escape');
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  const defaultFooter = 'For inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.';
  assert.equal(await body.inputValue(), defaultFooter);
  await body.fill('My editable SMS');
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  assert.equal(await body.inputValue(), 'Visit https://example.test/products?a=1&b=2.');
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  assert.equal(await body.inputValue(), 'My editable SMS');
  await page.getByRole('button', { name: 'Insert default SMS footer', exact: true }).click();
  assert.equal(await body.inputValue(), `My editable SMS\n\n${defaultFooter}`);
  assert.equal(await page.getByRole('button', { name: 'Insert default SMS footer', exact: true }).isDisabled(), true);
  await body.fill('');
  assert.equal(await body.inputValue(), '');
  assert.equal(await page.getByText(/For inquiries regarding|This is a no-reply/).count(), 0);
  await page.getByText(/0 characters after personalization/).waitFor();
  record('Editable SMS footer is inserted once, survives channel changes, stays out of email and can be removed');
  await body.fill('{{sender_name}} {{sender_email}}');
  await page.getByText(/Changed SMS Organization changed@example.test/).waitFor();
  record('SMS preview uses current organization identity only when its variables are entered');
  for await (const { theme, width } of responsiveMatrix(page)) {
    await body.fill(`Hello {{firstName}}, visit https://example.test/products?a=1&b=2.\n\n${defaultFooter.replace('+63 (28) 462-3488', '+63 917 123 4567')}`);
    const openPreview = page.getByRole('button', { name: 'Show live preview', exact: true });
    if (await openPreview.isVisible()) await openPreview.click();
    const link = page.getByRole('link', { name: 'https://example.test/products?a=1&b=2', exact: true });
    await link.scrollIntoViewIfNeeded();
    assert.equal(await link.getAttribute('href'), 'https://example.test/products?a=1&b=2');
    assert.ok((await page.locator('#campaign-live-preview').textContent()).includes('+63 917 123 4567'));
    const linkBounds = await link.boundingBox();
    assert.ok(linkBounds && linkBounds.x >= -1 && linkBounds.x + linkBounds.width <= width + 1, `SMS link bounds at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `SMS page overflow at ${width}`);
    await page.screenshot({ path: resolve(output, `sms-link-${theme}-${width}.png`) });
    const closePreview = page.getByRole('button', { name: 'Close preview', exact: true });
    if (await closePreview.isVisible()) await closePreview.click();
    record(`Editable SMS footer, destination and message wrapping at ${width} in ${theme}`);
  }
  for (const entity of ['lead', 'contact']) {
    await page.goto(base + `/automation/workflows/${saved[entity].id}/edit`);
    await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
    const shortcuts = page.getByLabel('Personalize Task title', { exact: true });
    // The current catalog also offers configured fields and supported relationship/sender keys.
    for (const label of ['First Name', 'Last Name', 'Email', 'Company Name']) {
      assert.equal(await shortcuts.getByRole('button', { name: label, exact: true }).count(), 1, `${entity} shortcut: ${label}`);
    }
    await page.getByLabel('Task title', { exact: true }).fill('Follow up with ');
    await shortcuts.getByRole('button', { name: 'First Name', exact: true }).click();
    await shortcuts.getByRole('button', { name: 'Company Name', exact: true }).click();
    assert.equal(await page.getByLabel('Task title', { exact: true }).inputValue(), `Follow up with {{firstName}}{{companyName}}`);
    assert.equal(await page.getByLabel('Description', { exact: true }).inputValue(), 'Legacy {{first_name}}');
    for await (const { theme, width } of responsiveMatrix(page)) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Workflow overflow at ${width}`);
      await page.screenshot({ path: resolve(output, `workflow-${entity}-${theme}-${width}.png`) });
      record(`${entity} existing shortcuts and layout at ${width}`);
    }
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ checks, pageErrors, transportErrors, database: 'disposable', providerSends: 0 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ checks, pageErrors, transportErrors, failure: String(error) }, null, 2)); throw error;
} finally {
  closing = true; await browser?.close(); if (frontend) frontend.kill();
  if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

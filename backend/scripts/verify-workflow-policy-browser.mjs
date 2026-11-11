import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, createWriteStream, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { notificationTestPostgres } from './notification-test-postgres.mjs';
import { createAcceptanceContext, setAcceptanceTheme } from './verify-browser-matrix.mjs';
const root = resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url);
const { qaEnvironment } = require('../../scripts/qa-environment.cjs');
const { browserEvidence } = require('../../scripts/qa-browser-evidence.cjs');
const output = resolve(process.env.LEADCRM_BROWSER_OUTPUT || resolve(root, 'data/outputs/workflow-policy-tests/browser'));
const environment = qaEnvironment(root);
for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
Object.assign(process.env, environment);
require('../../scripts/qa-network-guard.cjs');
mkdirSync(output, { recursive: true });
let pg, prisma, api, frontend, browser, log, failure, currentPage, closing = false;
const checks = [], pageErrors = [], serverErrors = [];
const expectedChecks = 22;
const resultPath = resolve(output, 'results.json');
writeFileSync(resultPath, JSON.stringify({ status: 'RUNNING', success: false, cleanup: 'pending', checks, pageErrors }, null, 2));
const Module = require('node:module'), originalResolve = Module._resolveFilename;
try {
  const standalone = resolve(root, 'frontend/.next/standalone/frontend');
  assert.ok(existsSync(resolve(standalone, 'server.js')), 'Build the standalone frontend before running this harness.');
  // Match the deployment artifact: Next standalone excludes these static assets.
  cpSync(resolve(root, 'frontend/.next/static'), resolve(standalone, '.next/static'), { recursive: true });
  if (existsSync(resolve(root, 'frontend/public'))) cpSync(resolve(root, 'frontend/public'), resolve(standalone, 'public'), { recursive: true });
  pg = await notificationTestPostgres();
  process.env.DATABASE_URL = await pg.database('leadcrm_workflow_browser_8');
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const base = `http://127.0.0.1:${port}`;
  Object.assign(process.env, { APP_URL: base, ALLOWED_ORIGINS: base });
  Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
  prisma = require('../dist/backend/src/config/database.config.js').default;
  const app = require('../dist/backend/src/app.js').default;
  const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
  const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
  const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
  const { chromium } = require('playwright');
  const tenant = await prisma.tenant.create({ data: { name: 'Workflow policy preview', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Workflow', lastName: 'Preview', email: `${randomUUID()}@camxian.com`, role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date() } });
  const { token } = await issueAuthSession(admin);
  const scope = work => tenantContext.run({ tenantId: tenant.id }, work);
  const saved = {};
  for (const entity of ['lead', 'contact', 'deal', 'account']) {
    const actions = entity === 'account' ? [{ type: 'update_field', config: { field: 'website', value: 'https://example.test' } }]
      : [{ type: 'send_sms', config: { recipient: entity === 'deal' ? 'primary_contact' : 'record', message: 'Hello NAME!' } },
        { type: 'send_email', config: { ...(entity === 'deal' ? { recipient: 'primary_contact' } : {}), subject: 'Hello', body: '<p>Welcome</p>' } }];
    saved[entity] = await scope(() => workflows.createWorkflow(tenant.id, admin.id, { name: `${entity} preview`, trigger: entity === 'account' ? 'account.updated' : `${entity}.created`, actions, isActive: false }));
  }
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(standalone, 'server.js')], { cwd: standalone, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (frontend.exitCode !== null || frontend.signalCode !== null) throw new Error('Built frontend exited before becoming ready. See frontend.log.');
    try { if ((await fetch(base + '/login', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, 'Built frontend did not become ready. Build the frontend before running this harness.');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Manila' });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const local = `http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`;
    const headers = { ...request.headers(), authorization: `Bearer ${token}` }; delete headers.host;
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/record-events')) return route.continue({ url: local, headers });
    try { await route.fulfill({ response: await context.request.fetch(local, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined, maxRetries: request.method() === 'GET' ? 2 : 0 }) }); }
    catch (error) { if (!closing) { console.error(`Fixture proxy failed: ${request.method()} ${url.pathname}: ${String(error).split('\n')[0]}`); await route.abort().catch(() => {}); } }
  });
  for (const theme of ['Light', 'Dark']) for (const width of [320, 375, 768, 1440]) {
    const page = currentPage = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 500) serverErrors.push({ url: new URL(response.url()).pathname, status: response.status() }); });
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`${base}/automation/workflows/${saved.deal.id}/edit`);
    const sms = page.getByRole('button', { name: /Configure action: 1. Send SMS/ }); await sms.waitFor();
    await setAcceptanceTheme(page, theme);
    assert.equal(await page.getByLabel('Drag to reorder action').count(), width < 768 ? 0 : 2);
    if (width < 768) await page.getByText('Tap each step to configure it.', { exact: false }).waitFor();
    await sms.click();
    const input = page.getByLabel('SMS message', { exact: true });
    await input.evaluate(element => { element.focus(); element.setSelectionRange(6, 10); });
    await page.getByRole('button', { name: 'Insert Variable into SMS message' }).click();
    const picker = page.getByRole('group', { name: 'Variables for SMS message' });
    for (const category of ['Standard Fields', 'Custom Fields', 'Sender']) await picker.getByText(category, { exact: true }).waitFor();
    await picker.getByLabel('Search variables').fill('firstName');
    await picker.getByRole('button', { name: /^First Name/ }).click();
    assert.equal(await input.inputValue(), 'Hello {{firstName}}!');
    const done = page.getByRole('button', { name: 'Done', exact: true });
    assert.equal(await done.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(37, 99, 235)');
    await done.click();
    if (width < 1280) await page.getByRole('button', { name: 'Add steps', exact: true }).click();
    await page.getByRole('button', { name: 'Add Send Email', exact: true }).click();
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    const channels = await cancel.evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data];
    });
    assert.ok(channels[0] > channels[1] + 30 && channels[0] > channels[2] + 30, JSON.stringify(channels));
    await cancel.click();
    if (width < 1280) await page.getByRole('button', { name: 'Add steps', exact: true }).click();
    await page.getByRole('button', { name: 'Add Move Deal Stage', exact: true }).click();
    await page.getByRole('button', { name: 'Insert at position 1', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Include a loss reason', exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Loss reason', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: resolve(output, `stage-move-${theme}-${width}.png`) });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Back to workflows' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }); await dialog.waitFor();
    const geometry = await dialog.evaluate(element => {
      const footer = element.querySelector('footer'), buttons = [...footer.querySelectorAll('button')].map(button => { const box = button.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right }; });
      return { buttons, titleAlign: getComputedStyle(element.querySelector('h2')).textAlign, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.equal(geometry.titleAlign, 'center'); assert.equal(geometry.overflow, false);
    assert.equal(geometry.buttons.length, 2); assert.ok(Math.abs(geometry.buttons[0].y - geometry.buttons[1].y) < 1);
    assert.ok(geometry.buttons.every(button => button.x >= 0 && button.right <= width));
    await page.screenshot({ path: resolve(output, `confirmation-${theme}-${width}.png`) });
    checks.push(`${theme} ${width}px: tap/drag policy, SMS variables, stage move form, action controls and centered confirmation`);
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await page.close();
  }
  const page = currentPage = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => pageErrors.push(error.message));
  for (const entity of ['lead', 'contact', 'account']) {
    await page.goto(`${base}/automation/workflows/${saved[entity].id}/edit`);
    await page.getByRole('region', { name: 'Builder library' }).waitFor().catch(() => page.getByRole('heading', { name: 'Builder library' }).waitFor());
    assert.equal(await page.getByRole('button', { name: 'Add Create Task', exact: true }).count(), 0);
    for (const name of ['Send SMS', 'Send Email']) assert.equal(await page.getByRole('button', { name: `Add ${name}`, exact: true }).count(), entity === 'account' ? 0 : 1);
    if (entity === 'account') assert.equal(await page.getByRole('button', { name: 'Add Update Fields', exact: true }).count(), 1);
    checks.push(`${entity}: persisted action availability matches policy`);
  }
  await page.goto(`${base}/automation/workflows`);
  for (const theme of ['Light', 'Dark']) for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await setAcceptanceTheme(page, theme);
    await page.getByRole('button', { name: 'Create Workflow', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Create workflow', exact: true });
    await chooser.locator('[data-template-id="new-deal-created"]').waitFor();
    assert.equal(await chooser.locator('[data-template-id]').count(), 14);
    assert.equal(await chooser.locator('[data-template-id^="stage:"]').count(), 0);
    await chooser.getByLabel('Search templates', { exact: true }).fill('Deal Assignment');
    await chooser.getByRole('button', { name: 'Preview Deal Assigned', exact: true }).click();
    await chooser.getByRole('region', { name: 'Template setup requirements' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const use = await chooser.getByRole('button', { name: 'Use this template', exact: true }).boundingBox();
    assert.ok(use && use.x >= 0 && use.x + use.width <= width + 1 && use.y + use.height <= 960);
    await page.screenshot({ path: resolve(output, `template-${theme}-${width}.png`) });
    await chooser.getByRole('button', { name: 'Close create workflow', exact: true }).click();
    checks.push(`${theme} ${width}px: 14 starters, assignment preview and visible template action`);
  }
  const { applyTextBeeEvidence } = require('../dist/backend/src/modules/marketing/campaigns/textbee-webhook.js');
  for (const status of ['sent', 'delivered', 'failed']) {
    const batch = randomUUID().replaceAll('-', '').slice(0, 24), device = '664a9b8cd0e1f2a3b4c5d6e7';
    const campaign = await scope(() => prisma.campaign.create({ data: {
      tenantId: tenant.id, name: `SMS ${status} evidence`, type: 'SMS', status: 'SENDING', createdById: admin.id,
      submittedById: admin.id, recipientCount: 1, submissionStartedAt: new Date(), submissionFinishedAt: new Date(), smsDeviceId: device,
    } }));
    await scope(() => prisma.campaignContact.create({ data: { tenantId: tenant.id, campaignId: campaign.id,
      phone: '+639171234567', messageId: batch, status: 'submitted', submittedAt: new Date() } }));
    await applyTextBeeEvidence({ smsId: `fixture-${batch}`, smsBatchId: batch, deviceId: device, recipient: '+639171234567', status });
    await page.goto(`${base}/marketing/campaigns`);
    await page.getByText(campaign.name, { exact: true }).first().click();
    await page.getByRole('heading', { name: `${campaign.name} Report`, exact: true }).waitFor();
    await page.getByRole('row').filter({ hasText: '+639171234567' }).getByText(status[0].toUpperCase() + status.slice(1), { exact: true }).waitFor();
    const recipient = await scope(() => prisma.campaignContact.findUniqueOrThrow({ where: { messageId: batch } }));
    assert.equal(recipient.sentAt, null); assert.equal(recipient.deliveredAt, null);
    await page.screenshot({ path: resolve(output, `campaign-${status}.png`) });
    checks.push(`Campaign report: verified ${status} evidence appears without fabricated event dates`);
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(serverErrors, []);
  assert.equal(checks.length, expectedChecks);
} catch (error) {
  failure = error;
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  closing = true;
  const cleanupErrors = [];
  for (const close of [
    () => browser?.close(),
    async () => {
      if (!frontend || frontend.exitCode !== null || frontend.signalCode !== null) return;
      let timer;
      const exited = new Promise(done => frontend.once('exit', done)); frontend.kill();
      try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Frontend shutdown timed out')), 10000); })]); }
      finally { clearTimeout(timer); }
    },
    async () => { if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); } },
    () => prisma?.$disconnect(),
    () => pg?.stop(),
  ]) { try { await close(); } catch (error) { cleanupErrors.push(String(error)); } }
  log?.end(); Module._resolveFilename = originalResolve;
  const success = !failure && !cleanupErrors.length && checks.length === expectedChecks && !pageErrors.length;
  const report = { status: success ? 'PASS' : 'FAIL', success, cleanup: cleanupErrors.length ? 'failed' : 'complete', checks, pageErrors, serverErrors,
    ...(failure ? { error: String(failure) } : {}), ...(cleanupErrors.length ? { cleanupErrors } : {}) };
  writeFileSync(resultPath, JSON.stringify(report, null, 2));
  if (cleanupErrors.length) throw new Error(`Browser harness cleanup failed: ${cleanupErrors.join('; ')}`);
  if (success) { assert.ok(browserEvidence(report, 0).complete); console.log(`${checks.length} browser journeys passed; cleanup complete`); }
}

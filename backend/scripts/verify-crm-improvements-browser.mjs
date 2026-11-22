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
const output = resolve(process.env.LEADCRM_BROWSER_OUTPUT || resolve(root, 'data/outputs/crm-improvements-tests/browser'));
const suppliedDatabase = process.env.LEADCRM_QA_RUN === '1' ? process.env.DATABASE_URL : undefined;
const environment = qaEnvironment(root, suppliedDatabase ? { DATABASE_URL: suppliedDatabase, DIRECT_URL: suppliedDatabase } : {});
for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
Object.assign(process.env, environment);
require('../../scripts/qa-network-guard.cjs');
mkdirSync(output, { recursive: true });
let pg, prisma, api, frontend, browser, log, failure, currentPage, closing = false;
const checks = [], pageErrors = [], serverErrors = [];
const expectedChecks = 7;
const resultPath = resolve(output, 'results.json');
writeFileSync(resultPath, JSON.stringify({ status: 'RUNNING', success: false, cleanup: 'pending', checks, pageErrors }, null, 2));
const Module = require('node:module'), originalResolve = Module._resolveFilename;
try {
  const standalone = resolve(root, 'frontend/.next/standalone/frontend');
  assert.ok(existsSync(resolve(standalone, 'server.js')), 'Build the standalone frontend before running this harness.');
  // Match the deployment artifact: Next standalone excludes these static assets.
  cpSync(resolve(root, 'frontend/.next/static'), resolve(standalone, '.next/static'), { recursive: true });
  if (existsSync(resolve(root, 'frontend/public'))) cpSync(resolve(root, 'frontend/public'), resolve(standalone, 'public'), { recursive: true });
  if (!suppliedDatabase) {
    pg = await notificationTestPostgres();
    process.env.DATABASE_URL = await pg.database('leadcrm_classification_browser_1');
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
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
  const agent = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Sales', lastName: 'Agent', email: `${randomUUID()}@camxian.com`, role: 'Sales', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const salesRole = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Sales' } });
  await prisma.rolePermission.createMany({ data: ['leads', 'contacts', 'deals', 'tasks', 'accounts', 'products'].map(module => ({ tenantId: tenant.id, roleId: salesRole.id, module, canView: true, canCreate: true, canEdit: true, canAssign: true })) });
  await prisma.userRole.create({ data: { tenantId: tenant.id, userId: agent.id, roleId: salesRole.id } });
  const { token } = await issueAuthSession(admin);
  const scope = work => tenantContext.run({ tenantId: tenant.id }, work);
  const workflow = await scope(() => workflows.createWorkflow(tenant.id, admin.id, {
    name: 'Published classification follow-up', trigger: 'lead.updated', isActive: true,
    actions: [{ type: 'update_field', config: { field: 'source', value: 'Referral' } }],
  }));
  const account = await prisma.account.create({ data: { tenantId: tenant.id, name: 'Fixture Company' } });
  const product = await prisma.productInterest.create({ data: { tenantId: tenant.id, name: 'Fixture Camera', category: 'Security', dealValue: 900 } });
  const pipeline = await prisma.pipeline.create({ data: { tenantId: tenant.id, name: 'Fixture pipeline' } });
  const stage = await prisma.stage.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
  await prisma.deal.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ tenantId: tenant.id, title: `Security deal ${String(i).padStart(2, '0')}`, accountId: account.id, productInterestId: product.id,
    pipelineId: pipeline.id, stageId: stage.id, assignedUserId: agent.id, value: 900, productsNormalized: true })) });
  const inquiry = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'Untouched', lastName: 'Inquiry', email: `${randomUUID()}@example.test`, assignedUserId: admin.id } });
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
  const page = currentPage = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${base}/crm/leads?tab=work_queue`);
  assert.equal(await page.getByRole('button', { name: /^Work queue/i }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'All Leads', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: /^Active Leads/ }).click();
  await page.getByText('Untouched Inquiry', { exact: true }).first().waitFor();
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: inquiry.id } })).status, 'Inquiry');
  checks.push('Active Leads shows an untouched Inquiry and retired tab links fall back safely');
  await page.screenshot({ path: resolve(output, 'inquiry-active-leads.png') });

  await page.getByRole('button', { name: 'Create Lead', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create New', exact: true }).click();
  const leadDialog = page.getByRole('dialog', { name: 'New Lead', exact: true });
  const leadEmail = `${randomUUID()}@example.test`;
  await leadDialog.getByLabel('First Name', { exact: false }).fill('Address');
  await leadDialog.getByLabel('Last Name', { exact: false }).fill('Fixture');
  await leadDialog.getByLabel('Email', { exact: false }).fill(leadEmail);
  await leadDialog.getByRole('combobox', { name: 'Company', exact: true }).click();
  await leadDialog.getByRole('combobox', { name: 'Company', exact: true }).fill('Separate address company');
  await page.getByRole('option', { name: /Add company.*Separate address company/ }).click();
  await leadDialog.getByLabel('Lead Address', { exact: true }).fill('Personal street\nPasig');
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(await leadDialog.getByRole('combobox', { name: 'Company', exact: true }).isVisible());
    assert.ok(await leadDialog.getByLabel('Lead Address', { exact: true }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.screenshot({ path: resolve(output, 'lead-company-and-address.png') });
  await leadDialog.getByRole('button', { name: 'Create Lead', exact: true }).click();
  await leadDialog.waitFor({ state: 'hidden' });
  const addressLead = await prisma.lead.findFirstOrThrow({ where: { tenantId: tenant.id, email: leadEmail } });
  assert.equal(addressLead.address, 'Personal street\nPasig');
  assert.equal(addressLead.companyName, 'Separate address company');
  assert.equal(addressLead.accountId, null);
  assert.equal(await prisma.account.count({ where: { tenantId: tenant.id, name: 'Separate address company' } }), 0);
  checks.push('Lead company and Lead Address save together without creating an Account at responsive widths');

  await page.goto(`${base}/automation/workflows/${workflow.id}/edit`);
  await page.getByRole('button', { name: 'Workflow details', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill('Saved draft follow-up');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved. The published version remains active.', { exact: true }).waitFor();
  let saved = await scope(() => prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } }));
  assert.equal(saved.isActive, true); assert.equal(saved.name, workflow.name); assert.equal(saved.draftDefinition.name, 'Saved draft follow-up');
  checks.push('Saving an active workflow persists only the draft and keeps its published version running');
  await page.screenshot({ path: resolve(output, 'active-workflow-draft.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Workflow details', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Workflow name', exact: true }).inputValue(), 'Saved draft follow-up');
  checks.push('Reloading the editor restores the persisted shared draft');
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByText(`Version ${workflow.version}`, { exact: true }).waitFor();
  await page.getByText('View definition', { exact: true }).click();
  await page.screenshot({ path: resolve(output, 'workflow-version-history.png') });
  checks.push('Published revision history includes an inspectable original definition');
  await page.getByRole('button', { name: 'Close drawer', exact: true }).click();

  await page.goto(`${base}/operations/taskboard`);
  await page.getByRole('button', { name: 'Create Task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create task', exact: true });
  await dialog.getByRole('textbox', { name: /Title/ }).fill('One task for all matching deals');
  await dialog.getByRole('button', { name: 'Assigned Agent *', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Sales Agent', exact: true }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.getByRole('button', { name: 'Associate task to deal *', exact: true }).click();
  await dialog.getByLabel('Filter deals by category').selectOption('Security');
  await dialog.getByLabel('Filter deals by product').selectOption(product.id);
  await dialog.getByRole('button', { name: 'Select all matching deals', exact: true }).click();
  await dialog.getByText(/50 selected.*50 matching deals/).waitFor();
  await page.screenshot({ path: resolve(output, 'filtered-deal-selection.png') });
  checks.push('Category and product filtering selects all 50 matches across pages');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const tasks = await prisma.task.findMany({ where: { tenantId: tenant.id, title: 'One task for all matching deals' }, include: { dealLinks: true } });
  assert.equal(tasks.length, 1); assert.equal(tasks[0].dealLinks.length, 50);
  checks.push('Browser save creates one task with exactly 50 persisted deal associations');
  assert.deepEqual(pageErrors, []); assert.deepEqual(serverErrors, []); assert.equal(checks.length, expectedChecks);
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

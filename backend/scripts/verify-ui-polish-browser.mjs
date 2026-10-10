// Real local API + disposable SQL acceptance. Requires built workspaces and PLAYWRIGHT_MODULE.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.UI_POLISH_OUTPUT || resolve(tmpdir(), 'leadcrm-ui-polish'));
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = 'http://localhost:3025';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_ui_polish?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base, BREVO_API_KEY: '', BREVO_SMS_SENDER: '' });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const shared = require('@leadcrm/shared');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const { salesPipeline, salesTransaction } = require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
const { fireWorkflowTrigger } = require('../dist/backend/src/modules/automation/workflows/workflow.engine.js');
let api, frontend, browser, page, closing = false, contactsGate, optionsGate, failContacts = false, failOptions = false;
let contactRequests = 0;
const checks = [], pageErrors = [], transportErrors = [];
const record = label => { checks.push(label); console.log('PASS', label); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

try {
  const tenant = await prisma.tenant.create({ data: { name: 'UI Polish Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Polish', lastName: 'Tester', email: 'polish-preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin), scope = run => tenantContext.run({ tenantId: tenant.id }, run);
  const pipeline = await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  const stage = await prisma.stage.findFirstOrThrow({ where: { tenantId: tenant.id, pipelineId: pipeline.pipeline.id } });
  const instant = new Date('2026-10-10T10:39:48Z');
  const lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'Fixture', lastName: 'Lead', assignedUserId: admin.id } });
  const deal = await prisma.deal.create({ data: { tenantId: tenant.id, title: 'Polish Deal', pipelineId: stage.pipelineId, stageId: stage.id, assignedUserId: admin.id, createdAt: new Date('2026-10-08T23:35:37.695Z') } });
  for (let i = 1; i <= 30; i++) await prisma.contact.create({ data: { tenantId: tenant.id, firstName: `Polish ${String(i).padStart(2, '0')}`, lastName: 'Contact', status: 'WARM', assignedUserId: admin.id } });
  for (const [name, createdAt] of [['Polish Task', instant], ['Polish Older Task', new Date('2026-01-01T00:00:00Z')]]) await prisma.task.create({ data: { tenantId: tenant.id, title: name, assignedUserId: admin.id, dueDate: new Date('2027-01-01T00:00:00Z'), createdAt } });
  for (const [name, createdAt] of [['Polish Campaign', instant], ['Polish Older Campaign', new Date('2026-01-01T00:00:00Z')]]) await prisma.campaign.create({ data: { tenantId: tenant.id, name, type: 'EMAIL', status: 'DRAFT', createdAt } });
  const draft = { name: 'Polish Active', trigger: 'lead.updated', isActive: true, conditions: { operator: 'OR', conditions: ['Fixture', 'Middle', 'Last'].map(value => ({ field: 'lead.firstName', operator: 'equals', value })) }, actions: [{ type: 'create_task', config: { title: 'History task', assignedUserId: admin.id } }] };
  const active = await scope(() => workflows.createWorkflow(tenant.id, admin.id, draft));
  await scope(() => fireWorkflowTrigger({ tenantId: tenant.id, actorId: admin.id, eventId: randomUUID(), entityType: 'lead', entityId: lead.id, triggerType: 'lead.updated', context: { 'event.changedFields': ['address'] } }));
  const execution = await prisma.workflowExecutionRun.findFirstOrThrow({ where: { workflowId: active.id } });
  assert.equal(execution.status, 'completed');
  await prisma.workflowExecutionRun.update({ where: { id: execution.id }, data: { startedAt: new Date('2026-10-08T13:50:48Z'), completedAt: new Date('2026-10-08T13:50:49Z') } });
  const paused = await scope(() => workflows.createWorkflow(tenant.id, admin.id, { ...draft, name: 'Polish Paused' }));
  await scope(() => workflows.toggleWorkflow(paused.id, tenant.id, admin.id, false));
  await scope(() => workflows.createWorkflow(tenant.id, admin.id, { ...draft, name: 'Polish Draft', isActive: false }));

  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const apiBase = `http://127.0.0.1:${api.address().port}/api/v1`;
  const prefs = await fetch(apiBase + '/preferences/columns/tasks', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ columns: shared.TASK_COLUMN_DEFINITIONS.map(column => ({ id: column.id, visible: column.defaultVisible || column.id === 'createdAt', order: column.defaultOrder })) }) });
  assert.equal(prefs.status, 200);
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3025', '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/proxy', '');
    const localUrl = apiBase + path + url.search, headers = { ...request.headers(), authorization: `Bearer ${token}` };
    if (path === '/auth/events' || path === '/crm/pipelines/events') return route.continue({ url: localUrl, headers });
    if (path === '/crm/contacts' && request.method() === 'GET') {
      contactRequests++;
      if (contactsGate) await contactsGate.promise;
      if (failContacts) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Acceptance: contacts unavailable' } }) });
    }
    if (path === '/automation/workflow-options') {
      if (optionsGate) await optionsGate.promise;
      if (failOptions) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Acceptance: options unavailable' } }) });
    }
    try { const response = await page.request.fetch(localUrl, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined, maxRetries: request.method() === 'GET' ? 2 : 0 }); await route.fulfill({ response }); }
    catch (error) { if (!closing) transportErrors.push(`${request.method()} ${path}: ${String(error).split('\n')[0]}`); await route.abort().catch(() => {}); }
  });
  async function responsive(label, target = page.locator('body')) {
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250); // Wait for responsive layout/transition, never production loading.
      const dimensions = await target.evaluate(root => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, controlsOutside: [...root.querySelectorAll('input,select,textarea')].filter(el => el.getClientRects().length && (el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1)).map(el => el.getAttribute('aria-label')) }));
      assert.equal(dimensions.pageOverflow, false, JSON.stringify(dimensions)); assert.deepEqual(dimensions.controlsOutside, [], JSON.stringify(dimensions));
      await page.screenshot({ path: resolve(output, `${label}-${width}.png`) }); record(`${label} ${width}px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  async function theme(mode) {
    await page.evaluate(mode => {
      localStorage.setItem('app_theme', mode);
      window.dispatchEvent(new CustomEvent('themechange', { detail: { mode, theme: mode === 'Dark' ? 'dark' : 'light' } }));
    }, mode);
  }

  await page.goto(base + '/crm/pipeline');
  await page.getByText('Polish Deal', { exact: true }).first().click();
  const panel = page.locator('[data-record-scroll]'); await panel.waitFor();
  await page.getByRole('tab', { name: /Details/ }).click();
  await panel.getByText('Oct 9, 2026 07:35 AM', { exact: true }).waitFor();
  assert.equal(await panel.getByText('2026-10-08T23:35:37.695Z', { exact: true }).count(), 0);
  record('Pipeline Deal Created uses Manila Format A and stays read-only');
  await responsive('deal-details', panel);

  await page.goto(base + '/operations/taskboard');
  await page.getByPlaceholder('Search tasks...').fill('Polish');
  const tasksGrid = page.getByRole('grid');
  await tasksGrid.getByText('Oct 10, 2026 06:39:48 PM', { exact: true }).waitFor();
  await tasksGrid.getByRole('columnheader', { name: 'Task title', exact: true }).getByText('Task title', { exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/operations/tasks') && response.url().includes('sortBy=createdAt') && response.url().includes('sortOrder=asc') && response.ok()),
    tasksGrid.getByRole('columnheader', { name: 'Created', exact: true }).getByText('Created', { exact: true }).click(),
  ]);
  await tasksGrid.locator('tbody tr').first().filter({ hasText: 'Polish Older Task' }).waitFor();
  record('Tasks Created uses Manila Format B in a New York browser');
  await responsive('tasks');
  await page.goto(base + '/marketing/campaigns');
  const campaignsGrid = page.getByRole('grid');
  await campaignsGrid.getByText('Oct 10, 2026 06:39 PM', { exact: true }).waitFor();
  await campaignsGrid.getByRole('columnheader', { name: 'Campaign', exact: true }).getByText('Campaign', { exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/marketing/campaigns') && new URL(response.url()).searchParams.get('sort') === 'createdAt:asc' && response.ok()),
    campaignsGrid.getByRole('columnheader', { name: 'Created', exact: true }).getByText('Created', { exact: true }).click(),
  ]);
  await campaignsGrid.getByText('Jan 1, 2026 08:00 AM', { exact: true }).waitFor();
  await campaignsGrid.locator('tbody tr').first().filter({ hasText: 'Polish Older Campaign' }).waitFor();
  record('Campaign Created formatting retains server timestamp sorting');
  await responsive('campaigns');

  await page.goto(base + '/automation/workflows');
  const workflowsGrid = page.getByRole('grid');
  await workflowsGrid.getByText('Oct 8, 2026 09:50:48 PM', { exact: true }).waitFor();
  const activeRow = workflowsGrid.getByRole('row').filter({ hasText: 'Polish Active' });
  const pausedRow = workflowsGrid.getByRole('row').filter({ hasText: 'Polish Paused' });
  assert.ok(await activeRow.getByText('Active', { exact: true }).locator('span').evaluate(el => el.classList.contains('bg-emerald-500')));
  assert.ok(await pausedRow.getByText('Paused', { exact: true }).locator('span').evaluate(el => el.classList.contains('bg-amber-500')));
  await activeRow.getByRole('button', { name: 'Pause workflow' }).click();
  await activeRow.getByText('Paused', { exact: true }).waitFor();
  await activeRow.getByRole('button', { name: 'Resume workflow' }).click();
  await activeRow.getByText('Active', { exact: true }).waitFor();
  record('Workflow status dots and pause/resume follow persisted state');
  await responsive('workflows');
  await theme('Dark');
  await responsive('workflows-dark');
  await theme('Light');
  await page.getByRole('button', { name: 'Filter Workflows', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Filter by Active', exact: true }).check();
  await workflowsGrid.locator('tbody tr').filter({ hasText: 'Polish Active' }).waitFor();
  assert.equal(await workflowsGrid.locator('tbody tr').count(), 1);
  await page.getByRole('checkbox', { name: 'Filter by Active', exact: true }).uncheck();
  await pausedRow.waitFor();
  await page.getByRole('button', { name: 'Close filters', exact: true }).click();
  record('Workflow status filtering retains its existing Active/Paused values');
  await activeRow.getByRole('button', { name: 'View runs' }).click();
  const runsPanel = page.getByRole('dialog', { name: 'Workflow details — Polish Active' });
  await runsPanel.getByText(/Oct 8, 2026 09:50:48 PM/).waitFor();
  await runsPanel.locator('summary').first().click();
  await runsPanel.getByText(/Finished: Oct 8, 2026 09:50:49 PM/).waitFor();
  record('Execution completed/finished presentation retains real history');
  await responsive('workflow-history', runsPanel);
  await runsPanel.getByRole('button', { name: 'Close workflow details' }).click();

  optionsGate = deferred();
  await page.getByRole('button', { name: 'Create Workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  const skeleton = page.getByRole('status', { name: 'Loading workflow builder' }); await skeleton.waitFor();
  assert.equal(await skeleton.locator('.animate-spin').count(), 0);
  await responsive('workflow-skeleton', skeleton);
  optionsGate.resolve(); optionsGate = undefined;
  await page.getByLabel('Workflow name', { exact: true }).waitFor();
  assert.equal(await skeleton.count(), 0);
  assert.equal(await page.getByLabel('Workflow name', { exact: true }).getAttribute('aria-required'), 'true');
  assert.equal(await page.getByLabel('Workflow name', { exact: true }).locator('..').locator('.text-red-500').textContent(), '*');
  record('Scratch navigation shows structured skeleton then required name without duplicate loading');
  await page.getByRole('button', { name: 'Save and activate', exact: true }).click();
  await page.getByText('Workflow name is required.', { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel('Workflow name', { exact: true }).getAttribute('aria-invalid'), 'true');
  record('Empty name keeps associated inline error and prevents activation');

  await page.goto(base + `/automation/workflows/${paused.id}/edit`);
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  const remove = page.getByRole('button', { name: 'Remove condition 2' });
  assert.equal(await remove.locator('..').innerText(), 'Condition 2');
  assert.equal(await remove.evaluate(el => el.classList.contains('text-destructive')), true);
  assert.equal(await page.getByRole('button', { name: 'Add condition', exact: true }).evaluate(el => el.style.backgroundColor), 'var(--primary)');
  assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).evaluate(el => el.style.backgroundColor), 'var(--primary)');
  await remove.click();
  assert.equal(await page.getByLabel('Condition 2 value', { exact: true }).inputValue(), 'Last');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  assert.equal(await page.getByLabel('Condition 2 value', { exact: true }).inputValue(), 'Middle');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  assert.equal(await page.getByLabel('Condition 2 value', { exact: true }).inputValue(), 'Last');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('is_empty');
  assert.equal(await page.getByLabel('Condition 1 value', { exact: true }).count(), 0);
  await responsive('workflow-conditions');
  record('Condition deletion, numbering, canvas history, blue Add and operator-specific required controls');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: /Configure trigger:/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).evaluate(el => el.style.backgroundColor), 'var(--primary)');
  const library = page.getByRole('region', { name: 'Builder library', exact: true });
  let originalCardStyle;
  for (const [category, label] of [['Triggers', 'Lead Updated'], ['Conditions', 'First Name'], ['Actions', 'Create Task']]) {
    await library.getByRole('button', { name: category, exact: true }).click();
    const cardStyle = await library.getByRole('button', { name: `Add ${label}`, exact: true }).evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      cardBackground: getComputedStyle(el.parentElement).backgroundColor,
      text: getComputedStyle(el).color,
      borderRadius: getComputedStyle(el.parentElement).borderRadius,
    }));
    assert.equal(cardStyle.background, 'rgba(0, 0, 0, 0)');
    if (!originalCardStyle) originalCardStyle = cardStyle;
    else assert.deepEqual(cardStyle, originalCardStyle);
    assert.equal(await library.getByRole('button', { name: `Drag ${label}`, exact: true }).count(), 1);
  }
  await library.getByRole('button', { name: 'Triggers', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'workflow-trigger-1440.png') });
  await theme('Dark');
  await page.screenshot({ path: resolve(output, 'workflow-trigger-dark-1440.png') });
  await theme('Light');
  record('Trigger cards retain the original Conditions/Actions style; Trigger and Conditions Done remain primary');

  await page.getByRole('button', { name: /Configure condition:/ }).click();
  await page.getByLabel('Condition 1 value', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Changes saved. This workflow is paused.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Save and activate', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Condition 1: Enter a value or choose an empty-value operator.' }).waitFor();
  assert.equal(await page.getByLabel('Condition 1 value', { exact: true }).inputValue(), '');
  assert.equal((await prisma.workflow.findUniqueOrThrow({ where: { id: paused.id } })).isActive, false);
  record('Saving and reloading a paused blank condition preserves the draft and prevents activation');

  failOptions = true;
  await page.goto(base + '/automation/workflows/new');
  await page.getByRole('alert').filter({ hasText: 'Acceptance: options unavailable' }).waitFor();
  assert.equal(await page.getByRole('status', { name: 'Loading workflow builder' }).count(), 0);
  failOptions = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByLabel('Workflow name', { exact: true }).waitFor();
  record('Initialization failure ends skeleton and retries without changing the requested draft');

  await page.goto(base + '/crm/contacts');
  const contactsGrid = page.getByRole('grid', { includeHidden: true }); await contactsGrid.waitFor();
  const contactsArea = page.locator('[aria-label="Contacts table area"]');
  await page.getByRole('button', { name: 'My Contacts', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('tab') === 'my');
  await page.getByPlaceholder('Search contacts...').fill('Polish');
  await page.waitForURL(url => url.searchParams.get('search') === 'Polish');
  await contactsGrid.getByRole('columnheader', { name: 'First Name', exact: true }).getByText('First Name', { exact: true }).click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('Page 2 of 2', { exact: true }).waitFor();
  let original = await contactsGrid.textContent();
  for (const failure of [false, true]) {
    const beforeRequests = contactRequests;
    contactsGate = deferred(); failContacts = failure;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Loading contacts...', { exact: true }).waitFor();
    assert.equal(await contactsGrid.textContent(), original);
    assert.equal(await contactsGrid.isVisible(), false);
    assert.equal(await contactsArea.getByRole('status').count(), 1);
    const loaderBounds = await contactsArea.getByRole('status').boundingBox(), tableBounds = await contactsArea.boundingBox();
    assert.ok(Math.abs(loaderBounds.width - tableBounds.width) < 1);
    assert.equal(await page.getByPlaceholder('Search contacts...').inputValue(), 'Polish');
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'my');
    assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(), true);
    await responsive(failure ? 'contacts-refresh-failure' : 'contacts-refresh', contactsArea);
    assert.equal(contactRequests, beforeRequests + 1);
    if (!failure) await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'Polish Refreshed', lastName: 'Contact', status: 'WARM', assignedUserId: admin.id } });
    contactsGate.resolve(); contactsGate = undefined;
    await page.getByText('Loading contacts...', { exact: true }).waitFor({ state: 'hidden' });
    await contactsGrid.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
    if (failure) assert.equal(await contactsGrid.textContent(), original);
    else {
      assert.notEqual(await contactsGrid.textContent(), original);
      assert.equal(await contactsGrid.getByRole('row').count(), 7); // Header plus six rows on page two.
      await page.getByText('31 total records', { exact: true }).waitFor();
      original = await contactsGrid.textContent();
    }
    await page.getByText('Page 2 of 2', { exact: true }).waitFor();
    record(`Contacts manual refresh ${failure ? 'failure' : 'success'} retains rows/search/page and releases its spinner`);
  }
  failContacts = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Loading contacts...', { exact: true }).waitFor({ state: 'hidden' });
  record('Contacts retry succeeds after a failed manual refresh');
  await theme('Dark');
  contactsGate = deferred();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Loading contacts...', { exact: true }).waitFor();
  await responsive('contacts-dark', contactsArea);
  contactsGate.resolve(); contactsGate = undefined;
  await page.getByText('Loading contacts...', { exact: true }).waitFor({ state: 'hidden' });
  await contactsGrid.waitFor({ state: 'visible' });

  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).createdAt.toISOString(), '2026-10-08T23:35:37.695Z');
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors }, null, 2));
  console.log(`Browser acceptance passed: ${checks.length} checks. Output: ${output}`);
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors, error: String(error) }, null, 2)); throw error;
} finally {
  closing = true; contactsGate?.resolve(); optionsGate?.resolve();
  await browser?.close(); frontend?.kill(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

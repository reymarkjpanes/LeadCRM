// Real local API + disposable SQL acceptance. Requires built workspaces and PLAYWRIGHT_MODULE.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { acceptancePort, responsiveMatrix, createAcceptanceContext } from './verify-browser-matrix.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = process.env.LEADCRM_BROWSER_OUTPUT || (resolve(process.env.UI_POLISH_OUTPUT || resolve(tmpdir(), 'leadcrm-ui-polish')));
mkdirSync(output, { recursive: true });
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.pathname, '/leadcrm_forms_test_2');
const base = `http://localhost:${await acceptancePort()}`;
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base, BREVO_API_KEY: '', BREVO_SMS_SENDER: '' });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
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
let heldContactRequests = 0;
const checks = [], pageErrors = [], transportErrors = [];
const record = label => { checks.push(label); console.log('PASS', label); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

try {
  const tenant = await prisma.tenant.create({ data: { name: 'UI Polish Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Polish', lastName: 'Tester', email: 'polish-preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin), scope = run => tenantContext.run({ tenantId: tenant.id }, run);
  const taskRole = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Polish task agents', permissions: { create: { module: 'tasks', canView: true } } } });
  const taskAgent = await prisma.user.create({
    data: {
      tenantId: tenant.id, firstName: 'Polish', lastName: 'Agent', email: 'polish-agent@camxian.com', role: taskRole.name,
      userRoles: { create: { roleId: taskRole.id } }
    }
  });
  const pipeline = await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  const stage = await prisma.stage.findFirstOrThrow({ where: { tenantId: tenant.id, pipelineId: pipeline.pipeline.id } });
  const instant = new Date('2026-10-10T10:39:48Z');
  const lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'Fixture', lastName: 'Lead', assignedUserId: admin.id } });
  const deal = await prisma.deal.create({ data: { tenantId: tenant.id, title: 'Polish Deal', pipelineId: stage.pipelineId, stageId: stage.id, assignedUserId: admin.id, createdAt: new Date('2026-10-08T23:35:37.695Z') } });
  await prisma.leadDeal.create({ data: { tenantId: tenant.id, leadId: lead.id, dealId: deal.id } });
  for (let i = 1; i <= 30; i++) await prisma.contact.create({ data: { tenantId: tenant.id, firstName: `Polish ${String(i).padStart(2, '0')}`, lastName: 'Contact', status: 'WARM', assignedUserId: admin.id } });
  for (const [name, createdAt] of [['Polish Task', instant], ['Polish Older Task', new Date('2026-01-01T00:00:00Z')]]) await prisma.task.create({ data: { tenantId: tenant.id, title: name, assignedUserId: admin.id, dueDate: new Date('2027-01-01T00:00:00Z'), createdAt } });
  for (const [name, createdAt] of [['Polish Campaign', instant], ['Polish Older Campaign', new Date('2026-01-01T00:00:00Z')]]) await prisma.campaign.create({ data: { tenantId: tenant.id, name, type: 'EMAIL', status: 'DRAFT', createdAt } });
  const draft = { name: 'Polish Active', trigger: 'deal.updated', isActive: true, conditions: { operator: 'OR', conditions: ['Polish Deal', 'Middle', 'Last'].map(value => ({ field: 'deal.title', operator: 'equals', value })) }, actions: [{ type: 'create_task', config: { title: 'History task', assignedUserId: taskAgent.id } }] };
  const active = await scope(() => workflows.createWorkflow(tenant.id, admin.id, draft));
  await scope(() => fireWorkflowTrigger({ tenantId: tenant.id, actorId: admin.id, eventId: randomUUID(), entityType: 'deal', entityId: deal.id, triggerType: 'deal.updated', context: { 'event.changedFields': ['address'] } }));
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
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', new URL(base).port, '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch { } await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(120000); page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/proxy', '');
    const localUrl = apiBase + path + url.search, headers = { ...request.headers(), authorization: `Bearer ${token}` };
    if (path.endsWith('/events') || path === '/crm/record-events') return route.continue({ url: localUrl, headers });
    if (path === '/crm/contacts' && request.method() === 'GET' && url.searchParams.get('search') === 'Polish') {
      // SSE/polling may start between the ready check and the click. Only hold
      // a response once the page has entered its actual manual-refresh state;
      // background reads must finish so they cannot disable the pending click.
      const gate = contactsGate;
      if (gate && await page.evaluate(() => document.querySelector('[aria-label="Contacts table area"]')?.getAttribute('aria-busy') === 'true')) {
        heldContactRequests++;
        const failResponse = failContacts;
        await gate.promise;
        if (failResponse) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Acceptance: contacts unavailable' } }) });
      }
    }
    if (path === '/automation/workflow-options') {
      if (optionsGate) await optionsGate.promise;
      if (failOptions) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Acceptance: options unavailable' } }) });
    }
    try { const response = await page.request.fetch(localUrl, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined, maxRetries: request.method() === 'GET' ? 2 : 0 }); await route.fulfill({ response }); }
    catch (error) { if (!closing) transportErrors.push(`${request.method()} ${path}: ${String(error).split('\n')[0]}`); await route.abort().catch(() => { }); }
  });
  async function responsive(label, target = page.locator('body')) {
    for await (const { theme, width } of responsiveMatrix(page)) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250); // Wait for responsive layout/transition, never production loading.
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} document overflow at ${width}px`);
      for (const control of await target.locator('input,select,textarea').all()) {
        const geometry = await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const outside = element.getClientRects().length && (rect.left < -1 || rect.right > innerWidth + 1);
          let scroll;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const bounds = parent.getBoundingClientRect();
            if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth && bounds.left >= -1 && bounds.right <= innerWidth + 1) {
              scroll = { left: parent.scrollLeft, top: parent.scrollTop }; break;
            }
          }
          return { outside: Boolean(outside), scroll, label: element.getAttribute('aria-label') };
        });
        if (!geometry.outside) continue;
        // Wide CRM tables clip controls inside their own horizontal viewport.
        // Prove those controls are reachable; out-of-page form controls still fail.
        assert.ok(geometry.scroll, JSON.stringify(geometry));
        await control.scrollIntoViewIfNeeded();
        assert.ok(await control.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }), JSON.stringify(geometry));
        await control.evaluate((element, original) => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) {
              parent.scrollLeft = original.left; parent.scrollTop = original.top; break;
            }
          }
        }, geometry.scroll);
      }
      await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}.png`) }); record(`${label} ${theme} ${width}px`);
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
  await Promise.all([
    page.waitForResponse(response => { const url = new URL(response.url()); return response.request().method() === 'GET' && url.pathname === '/api/proxy/operations/tasks' && url.searchParams.get('search') === 'Polish' && response.ok(); }),
    page.getByPlaceholder('Search tasks...').fill('Polish'),
  ]);
  await page.waitForFunction(() => { const refresh = document.querySelector('button[aria-label="Refresh tasks"]'); return refresh && !refresh.disabled; });
  const tasksGrid = page.getByRole('grid');
  await tasksGrid.getByText('Oct 10, 2026 06:39:48 PM', { exact: true }).waitFor();
  await tasksGrid.getByRole('button', { name: 'Column options for Created', exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/operations/tasks') && response.url().includes('sortBy=createdAt') && response.url().includes('sortOrder=asc') && response.ok()),
    page.getByRole('menuitemradio', { name: /Oldest/ }).click(),
  ]);
  await tasksGrid.locator('tbody tr').first().filter({ hasText: 'Polish Older Task' }).waitFor();
  record('Tasks Created uses Manila Format B in a New York browser');
  await responsive('tasks');
  await page.goto(base + '/marketing/campaigns');
  const campaignsGrid = page.getByRole('grid');
  await campaignsGrid.getByText('Oct 10, 2026 06:39 PM', { exact: true }).waitFor();
  await campaignsGrid.getByRole('button', { name: 'Column options for Created', exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/marketing/campaigns') && new URL(response.url()).searchParams.get('sort') === 'createdAt:asc' && response.ok()),
    page.getByRole('menuitemradio', { name: /Oldest/ }).click(),
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
  const pauseDialog = page.getByRole('alertdialog', { name: 'Pause workflow?' });
  await pauseDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await activeRow.getByText('Active', { exact: true }).waitFor();
  await activeRow.getByRole('button', { name: 'Pause workflow' }).click();
  await pauseDialog.getByRole('button', { name: 'Pause workflow', exact: true }).click();
  await activeRow.getByText('Paused', { exact: true }).waitFor();
  await activeRow.getByRole('button', { name: 'Resume workflow' }).click();
  await page.getByRole('alertdialog', { name: 'Activate workflow?' }).getByRole('button', { name: 'Activate workflow', exact: true }).click();
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
  for (const [category, label] of [['Triggers', 'Deal Updated'], ['Conditions', 'Title'], ['Actions', 'Create Task']]) {
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
  const contactsRegion = contactsArea.getByRole('region', { name: 'Contacts data grid', exact: true });
  const contactsSpinner = contactsRegion.getByRole('status', { name: 'Refreshing data...', exact: true });
  assert.equal(await page.getByRole('button', { name: 'My Contacts', exact: true }).count(), 0, 'Client Admin does not have a personal assignment view');
  await page.getByRole('button', { name: 'All Contacts', exact: true }).click();
  await page.getByPlaceholder('Search contacts...').fill('Polish');
  await page.waitForURL(url => url.searchParams.get('search') === 'Polish');
  await contactsGrid.getByRole('button', { name: 'Column options for First Name', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Sort A–Z', exact: true }).click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('Page 2 of 2', { exact: true }).waitFor();
  let original = await contactsGrid.textContent();
  for (const failure of [false, true]) {
    // Background reconciliation stays live. Its reads are never held by the
    // manual-response gate, including a read that races this ready check.
    await page.waitForFunction(() => { const button = document.querySelector('button[aria-label="Refresh"]'); return button && !button.disabled; });
    const beforeRequests = heldContactRequests;
    contactsGate = deferred(); failContacts = failure;
    if (failure) {
      // Reproduce the CI race deterministically: reserve the manual response,
      // then trigger a real background reconciliation before clicking Refresh.
      const backgroundResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/proxy/crm/contacts' && url.searchParams.get('search') === 'Polish' && response.request().method() === 'GET';
      });
      await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'Background', lastName: 'Reconciliation', status: 'WARM', assignedUserId: admin.id } });
      assert.equal((await backgroundResponse).status(), 200);
      await page.waitForFunction(() => { const button = document.querySelector('button[aria-label="Refresh"]'); return button && !button.disabled; });
      assert.equal(heldContactRequests, beforeRequests);
      record('Contacts background reconciliation completes while a manual response is reserved');
    }
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await contactsSpinner.waitFor();
    assert.equal(await contactsGrid.textContent(), original);
    assert.equal(await contactsGrid.isVisible(), true);
    assert.equal(await page.getByRole('status', { name: 'Refreshing data...', exact: true }).count(), 1);
    assert.equal(await contactsArea.getAttribute('aria-busy'), 'true');
    const dimensions = await contactsRegion.evaluate(area => {
      const loader = area.querySelector('[role="status"][aria-label="Refreshing data..."]');
      return { loader: loader?.getBoundingClientRect().toJSON(), table: area.getBoundingClientRect().toJSON() };
    });
    const { loader, table } = dimensions;
    assert.ok(loader && loader.width > 0 && loader.height > 0 && loader.left >= table.left - 1 && loader.right <= table.right + 1 && loader.top >= table.top - 1 && loader.bottom <= table.bottom + 1, JSON.stringify(dimensions));
    assert.ok(Math.abs(loader.left + loader.width / 2 - table.left - table.width / 2) < 1.5 && Math.abs(loader.top + loader.height / 2 - table.top - table.height / 2) < 1.5, JSON.stringify(dimensions));
    assert.equal(await page.getByPlaceholder('Search contacts...').inputValue(), 'Polish');
    assert.ok([null, 'all'].includes(new URL(page.url()).searchParams.get('tab')));
    assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Refresh', exact: true }).evaluate(button => { button.click(); button.click(); });
    assert.equal(heldContactRequests, beforeRequests + 1);
    // Later SSE invalidations are independently governed reconciliation, not
    // duplicate manual clicks. Cross-session behavior has its own record suite.
    await responsive(failure ? 'contacts-refresh-failure' : 'contacts-refresh', contactsArea);
    if (!failure) await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'Polish Refreshed', lastName: 'Contact', status: 'WARM', assignedUserId: admin.id } });
    contactsGate.resolve(); contactsGate = undefined;
    await contactsSpinner.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => { const button = document.querySelector('button[aria-label="Refresh"]'); return button && !button.disabled; });
    assert.equal(await contactsArea.getAttribute('aria-busy'), 'false');
    await contactsGrid.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
    if (failure) {
      assert.equal(await contactsGrid.textContent(), original);
      await page.getByText('Acceptance: contacts unavailable', { exact: true }).waitFor();
    }
    else {
      // Completion of the refresh promise can precede React's data render,
      // especially when the Contact write also invalidates the active request.
      await page.getByText('31 total records', { exact: true }).waitFor();
      assert.notEqual(await contactsGrid.textContent(), original);
      assert.equal(await contactsGrid.getByRole('row').count(), 7); // Header plus six rows on page two.
      original = await contactsGrid.textContent();
    }
    await page.getByText('Page 2 of 2', { exact: true }).waitFor();
    record(`Contacts manual refresh ${failure ? 'failure' : 'success'} retains rows/search/page and releases its spinner`);
  }
  failContacts = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await contactsSpinner.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => { const button = document.querySelector('button[aria-label="Refresh"]'); return button && !button.disabled; });
  record('Contacts retry succeeds after a failed manual refresh');
  await theme('Dark');
  contactsGate = deferred();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await contactsSpinner.waitFor();
  await responsive('contacts-dark', contactsArea);
  contactsGate.resolve(); contactsGate = undefined;
  await contactsSpinner.waitFor({ state: 'hidden' });
  await contactsGrid.waitFor({ state: 'visible' });

  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).createdAt.toISOString(), '2026-10-08T23:35:37.695Z');
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ status: 'PASS', checks, pageErrors, transportErrors }, null, 2));
  console.log(`Browser acceptance passed: ${checks.length} checks. Output: ${output}`);
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => { }); writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ status: 'FAIL', checks, pageErrors, transportErrors, error: String(error) }, null, 2)); throw error;
} finally {
  closing = true; contactsGate?.resolve(); optionsGate?.resolve();
  await browser?.close(); frontend?.kill(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect();
}

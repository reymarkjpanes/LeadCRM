// Workflow-only acceptance using the existing native PostgreSQL and browser fixtures.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, createWriteStream, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { notificationTestPostgres } from './notification-test-postgres.mjs';
import { acceptancePort, createAcceptanceContext, setAcceptanceTheme } from './verify-browser-matrix.mjs';

const root = resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url);
const { qaEnvironment } = require('../../scripts/qa-environment.cjs');
const environment = qaEnvironment(root);
for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
Object.assign(process.env, environment);
require('../../scripts/qa-network-guard.cjs');
const output = resolve(process.env.LEADCRM_BROWSER_OUTPUT || resolve(root, 'data/outputs/workflow-polish-browser'));
mkdirSync(output, { recursive: true });
const checks = [], pageErrors = [], mutations = [];
writeFileSync(resolve(output, 'results.json'), JSON.stringify({ status: 'RUNNING', success: false, checks }, null, 2));
let pg, prisma, api, frontend, browser, page, log, failure, closing = false;
const Module = require('node:module'), originalResolve = Module._resolveFilename;
const check = message => { checks.push(message); console.log(message); };
try {
  const standalone = resolve(root, 'frontend/.next/standalone/frontend');
  assert.ok(existsSync(resolve(standalone, 'server.js')), 'Build the frontend before browser acceptance.');
  cpSync(resolve(root, 'frontend/.next/static'), resolve(standalone, '.next/static'), { recursive: true });
  cpSync(resolve(root, 'frontend/public'), resolve(standalone, 'public'), { recursive: true });
  pg = await notificationTestPostgres();
  process.env.DATABASE_URL = await pg.database('leadcrm_workflow_polish_1');
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  const port = await acceptancePort(), base = `http://127.0.0.1:${port}`;
  Object.assign(process.env, { APP_URL: base, ALLOWED_ORIGINS: base });
  Module._resolveFilename = function(request, parent, isMain, options) {
    return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options);
  };
  prisma = require('../dist/backend/src/config/database.config.js').default;
  const app = require('../dist/backend/src/app.js').default;
  const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
  const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
  const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
  const { fireWorkflowTrigger } = require('../dist/backend/src/modules/automation/workflows/workflow.engine.js');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const tenant = await prisma.tenant.create({ data: { name: 'Workflow polish acceptance', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const person = (role, firstName) => prisma.user.create({ data: { tenantId: tenant.id, firstName, lastName: 'Tester', email: `${randomUUID()}@camxian.com`, role, status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date() } });
  const admin = await person('Client Admin', 'Admin'), staff = await person('Support', 'Support');
  const scope = work => tenantContext.run({ tenantId: tenant.id }, work);
  const adminRole = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Client Admin', isSystemRole: true } });
  const role = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Support' } });
  await prisma.rolePermission.createMany({ data: ['tasks', 'deals', 'leads'].map(module => ({ tenantId: tenant.id, roleId: role.id, module, canView: true, canEdit: true })) });
  await prisma.userRole.create({ data: { tenantId: tenant.id, userId: staff.id, roleId: role.id } });
  const pipeline = await prisma.pipeline.create({ data: { tenantId: tenant.id, name: 'Sales Pipeline' } });
  const stage = await prisma.stage.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Lead', order: 0 } });
  const deal = await prisma.deal.create({ data: { tenantId: tenant.id, title: 'Polish acceptance Deal', pipelineId: pipeline.id, stageId: stage.id, assignedUserId: staff.id } });
  const target = id => ({ type: 'role', id, strategy: 'round_robin' });
  const saved = await scope(() => workflows.createWorkflow(tenant.id, admin.id, { name: 'Role assignment acceptance', trigger: 'deal.created', isActive: false, actions: [{ type: 'create_task', config: { title: 'Acceptance follow-up', assignmentTarget: target(role.id) } }] }));
  const legacy = await prisma.workflow.create({ data: { tenantId: tenant.id, createdById: admin.id, name: 'Legacy protected assignment', trigger: 'deal.created', actions: [{ type: 'assign_owner', config: { assignmentTarget: target(adminRole.id) } }], status: 'PAUSED', isActive: false } });
  const { token } = await issueAuthSession(admin);
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(standalone, 'server.js')], { cwd: standalone, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (frontend.exitCode !== null) throw Error('Frontend exited before becoming ready.');
    try { if ((await fetch(base + '/login', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, 'Frontend did not become ready.');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Manila' });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const local = `http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`;
    const headers = { ...request.headers(), authorization: `Bearer ${token}` }; delete headers.host;
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/record-events')) return route.continue({ url: local, headers });
    try {
      const response = await context.request.fetch(local, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined });
      if (request.method() !== 'GET' && url.pathname.includes('/automation/workflows')) mutations.push({ path: url.pathname, method: request.method(), status: response.status() });
      await route.fulfill({ response });
    } catch (error) { if (!closing) throw error; }
  });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(90000);
  page.on('pageerror', error => pageErrors.push(error.message));
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const clearToasts = () => page.evaluate(() => { window.__workflowToasts = []; });
  await page.addInitScript(() => {
    window.__workflowToasts = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
        for (const title of [...(node.matches('[data-title]') ? [node] : []), ...node.querySelectorAll('[data-title]')]) {
          if (title.closest('[data-sonner-toast]')) window.__workflowToasts.push(title.textContent);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const oneToast = async expected => {
    await page.locator('[data-sonner-toast] [data-title]').filter({ hasText: expected }).first().waitFor();
    assert.deepEqual(await page.evaluate(() => window.__workflowToasts), [expected]);
  };
  await page.goto(`${base}/automation/workflows/new`);
  await page.getByLabel('Workflow name', { exact: true }).fill('Scratch acceptance');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Configure trigger: Choose a trigger', exact: true }).click();
  await page.getByLabel(/^Start when/).selectOption('deal.created');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('button', { name: 'Add Create Task', exact: true }).click();
  await page.getByRole('button', { name: 'Insert at position 1', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Scratch task');
  await page.getByLabel('Assign to', { exact: true }).selectOption('role');
  await page.getByLabel('Assignment role', { exact: true }).selectOption(role.id);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await clearToasts(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await oneToast('Draft saved.');
  await page.waitForURL(/\/automation\/workflows\/[a-f0-9-]+\/edit$/);
  const scratch = await prisma.workflow.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'Scratch acceptance' } });
  assert.equal(scratch.isActive, false);
  assert.equal(mutations.filter(row => row.path.endsWith('/automation/workflows') && row.method === 'POST').length, 1);
  check('Scratch creation persists one inactive workflow and displays one notification');
  for (const theme of ['Light', 'Dark']) for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`${base}/automation/workflows/${saved.id}/edit`);
    await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).waitFor();
    await setAcceptanceTheme(page, theme);
    const accent = theme === 'Dark' ? 'teal' : 'blue';
    await page.evaluate(accent => { localStorage.setItem('app_accent_color', accent); window.dispatchEvent(new StorageEvent('storage', { key: 'app_accent_color' })); }, accent);
    await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
    const roles = page.getByLabel('Assignment role', { exact: true });
    assert.deepEqual(await roles.locator('option').allTextContents(), ['Choose role', 'Support']);
    assert.equal(await roles.inputValue(), role.id);
    assert.equal(await overflow(), false);
    await page.waitForTimeout(350); // Capture the settled configuration-panel animation.
    await page.screenshot({ path: resolve(output, `assignment-${theme}-${width}.png`) });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.goto(`${base}/automation/workflows`);
    await page.getByRole('button', { name: 'Create Workflow', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Create workflow', exact: true });
    await chooser.getByRole('button', { name: 'Preview New Deal Created', exact: true }).click();
    assert.equal(await chooser.getByText('Execution details', { exact: true }).evaluate(element => element.closest('details').open), false);
    await chooser.getByRole('region', { name: 'Template setup requirements' }).waitFor();
    await chooser.getByText('Execution details', { exact: true }).click();
    await chooser.getByText('Repeat policy:', { exact: true }).waitFor();
    assert.equal(await overflow(), false);
    await page.screenshot({ path: resolve(output, `template-${theme}-${width}.png`) });
    await chooser.getByRole('button', { name: 'Close create workflow', exact: true }).click();
    check(`${theme} ${accent} ${width}px: role choices, configuration panel and expandable template notes`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/automation/workflows/${saved.id}/edit`);
  await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Unsaved refresh check');
  await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Additional role' } });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByLabel('Assignment role', { exact: true }).getByRole('option', { name: 'Additional role', exact: true }).waitFor({ state: 'attached' });
  assert.equal(await page.getByLabel('Task title', { exact: true }).inputValue(), 'Unsaved refresh check');
  assert.equal(await page.getByLabel('Assignment role', { exact: true }).inputValue(), role.id);
  await page.getByLabel('Task title', { exact: true }).fill('Acceptance follow-up');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  check('Role choices refresh on focus without losing unsaved edits or the selected target');
  await page.goto(`${base}/automation/workflows/${legacy.id}/edit`);
  await page.getByRole('button', { name: /Configure action: 1. Assign Agent/ }).click();
  assert.equal(await page.getByLabel('Assignment role', { exact: true }).inputValue(), adminRole.id);
  await page.getByText('This assignment target is unavailable.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('option', { name: 'Client Admin', exact: true }).count(), 0);
  await page.getByLabel('Assignment role', { exact: true }).selectOption(role.id);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await clearToasts(); await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await oneToast('Workflow saved and paused.');
  check('Legacy protected role remains readable and can be replaced with Support');

  await page.goto(`${base}/automation/workflows/${saved.id}/edit`);
  await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Updated acceptance follow-up');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await clearToasts(); await page.getByRole('button', { name: 'Save draft', exact: true }).dblclick();
  await oneToast('Draft saved.');
  assert.equal(mutations.filter(row => row.path.endsWith(`/${saved.id}/draft`)).length, 1);
  await clearToasts(); await page.getByRole('button', { name: 'Publish workflow', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Activate workflow', exact: true }).click();
  await oneToast('Workflow published.');
  const beforeTasks = await prisma.task.count({ where: { tenantId: tenant.id } });
  await scope(() => fireWorkflowTrigger({ tenantId: tenant.id, actorId: admin.id, eventId: randomUUID(), entityType: 'deal', entityId: deal.id, triggerType: 'deal.created', context: {} }));
  const task = await prisma.task.findFirstOrThrow({ where: { tenantId: tenant.id, title: 'Updated acceptance follow-up' } });
  assert.equal(task.assignedUserId, staff.id);
  assert.equal(await prisma.task.count({ where: { tenantId: tenant.id } }), beforeTasks + 1);
  await page.getByRole('button', { name: 'Test draft', exact: true }).click();
  await page.getByLabel(/^Sample record/).selectOption(deal.id);
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await page.getByRole('heading', { name: 'Configuration is valid', exact: true }).waitFor();
  assert.equal(await prisma.task.count({ where: { tenantId: tenant.id } }), beforeTasks + 1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.locator('section[aria-label="Workflow activity"] details > summary').first().click();
  await page.getByRole('link', { name: 'Open Task', exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'activity-task-link.png') });
  check('Draft save, publication, role-assigned Task execution, dry-run and activity connection');
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await clearToasts(); await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Pause workflow?' }).getByRole('button', { name: 'Pause workflow', exact: true }).click();
  await oneToast('Workflow paused.');
  check('Pause displays one notification');
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await page.getByRole('button', { name: 'Restore into draft', exact: true }).first().click();
  await clearToasts();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore draft', exact: true }).click();
  await oneToast('Version restored to draft.');
  assert.equal((await prisma.workflow.findUniqueOrThrow({ where: { id: saved.id } })).isActive, false);
  check('Version restoration creates a draft without reactivating the paused workflow');
  await page.goto(`${base}/automation/workflows`);
  await page.getByText(saved.name, { exact: true }).click();
  await page.getByRole('button', { name: 'Workflow actions', exact: true }).click();
  const beforeCopies = await prisma.workflow.count({ where: { tenantId: tenant.id } });
  await clearToasts(); await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await oneToast('Workflow duplicated as a draft.');
  assert.equal(await prisma.workflow.count({ where: { tenantId: tenant.id } }), beforeCopies + 1);
  await page.getByRole('button', { name: 'Workflow actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await clearToasts(); await page.getByRole('alertdialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await oneToast('Workflow archived.');
  assert.equal((await prisma.workflow.findUniqueOrThrow({ where: { id: saved.id } })).isArchived, true);
  check('Details actions duplicate and archive with one notification each');
  const forbidden = await context.request.put(`http://127.0.0.1:${api.address().port}/api/v1/automation/workflows/${scratch.id}/draft`, {
    headers: { authorization: `Bearer ${token}` }, data: { expectedDraftRevision: scratch.draftRevision, expectedVersion: scratch.version,
      draft: { name: scratch.name, trigger: scratch.trigger, isActive: false, actions: [{ type: 'create_task', config: { title: 'Forged target', assignmentTarget: target(adminRole.id) } }] } },
  });
  assert.equal(forbidden.status(), 400);
  assert.equal(JSON.stringify(await forbidden.json()).includes('Client Admin'), true);
  assert.equal(await prisma.roleDefinition.count({ where: { id: adminRole.id, name: 'Client Admin', isSystemRole: true, isArchived: false } }), 1);
  check('Direct draft API rejects Client Admin while preserving the actual system role');
  const { SMS_DEFAULT_FOOTER } = require(resolve(root, 'backend/dist/shared/src/index.js'));
  const savedSms = `Saved SMS text\n\n${SMS_DEFAULT_FOOTER}`;
  const nextStage = await prisma.stage.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Contacted', order: 1 } });
  const panelWorkflow = await scope(() => workflows.createWorkflow(tenant.id, admin.id, {
    name: 'Step description acceptance', trigger: 'deal.created', isActive: false,
    actions: [
      { type: 'send_email', config: { recipient: 'primary_contact', subject: '', body: '' } },
      { type: 'send_sms', config: { recipient: 'primary_contact', message: savedSms } },
      { type: 'assign_owner', config: { assignmentTarget: { ...target(role.id), availability: {
        timeZone: 'Asia/Manila', schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }, members: [],
      } } } },
      { type: 'update_field', config: { field: 'priority', value: 'HIGH' } },
      { type: 'move_deal_stage', config: { stageId: nextStage.id } },
    ],
  }));
  for (const theme of ['Light', 'Dark']) for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`${base}/automation/workflows/${panelWorkflow.id}/edit`);
    await page.getByRole('button', { name: /Configure action: 1. Send Email/ }).waitFor();
    await setAcceptanceTheme(page, theme);
    const shot = async name => {
      assert.equal(await page.getByText('Save a draft to keep your edits. Publish to apply them.', { exact: true }).count(), 0);
      assert.equal(await overflow(), false);
      await page.waitForTimeout(350);
      await page.screenshot({ path: resolve(output, `step-${name}-${theme}-${width}.png`) });
    };
    const done = () => page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Configure trigger: Deal Created', exact: true }).click();
    assert.equal(await page.getByLabel(/^Start when/).inputValue(), 'deal.created');
    assert.equal(await page.getByText('This event starts the workflow, even when the editor is closed.', { exact: true }).count(), 0);
    await shot('trigger'); await done();
    await page.getByRole('button', { name: 'Configure condition: All matching records', exact: true }).click();
    const match = page.getByLabel(/^Match conditions/);
    await match.selectOption('OR'); assert.equal(await match.inputValue(), 'OR'); await match.selectOption('AND');
    await shot('conditions'); await done();
    await page.getByRole('button', { name: /Configure action: 1. Send Email/ }).click();
    assert.equal(await page.getByText('Sends through the record agent’s Gmail.', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Send a template through the assigned agent’s connected Gmail account.', { exact: true }).count(), 0);
    const subject = page.getByLabel('Subject (overrides template)', { exact: true });
    assert.equal(await subject.getAttribute('aria-describedby'), null);
    assert.equal(await page.getByText('Leave empty to use the template subject.', { exact: true }).count(), 0);
    await subject.fill('{{unavailable}}');
    await page.getByRole('alert').filter({ hasText: '{{unavailable}}' }).waitFor();
    const errorId = await subject.getAttribute('aria-describedby');
    assert.ok(errorId && await page.locator(`[id="${errorId}"]`).textContent());
    await subject.fill('');
    await shot('email'); await done();
    await page.getByRole('button', { name: /Configure action: 2. Send SMS/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Insert default SMS footer', exact: true }).count(), 0);
    assert.equal(await page.getByText('Edit or remove the footer directly in the message.', { exact: false }).count(), 0);
    const sms = page.getByLabel('SMS message', { exact: true });
    assert.equal(await sms.inputValue(), savedSms);
    await sms.fill(`Hello NAME!\n\n${SMS_DEFAULT_FOOTER}`);
    await sms.evaluate(element => { element.focus(); element.setSelectionRange(6, 10); });
    await page.getByRole('button', { name: 'Insert Variable into SMS message', exact: true }).click();
    const picker = page.getByRole('group', { name: 'Variables for SMS message', exact: true });
    await picker.getByLabel('Search variables').fill('firstName');
    await picker.getByRole('button', { name: /^First Name/ }).click();
    assert.equal(await sms.inputValue(), `Hello {{firstName}}!\n\n${SMS_DEFAULT_FOOTER}`);
    await sms.fill(savedSms);
    const smsInspector = page.getByRole('heading', { name: 'Send SMS', exact: true }).locator('..').locator('..');
    await smsInspector.getByText(/SMS is not configured/).waitFor();
    assert.equal(await smsInspector.getByText(/SMS is not configured/).count(), 1);
    await shot('sms'); await done();
    await page.getByRole('button', { name: /Configure action: 3. Assign Agent/ }).click();
    assert.equal(await page.getByLabel('Use availability schedule', { exact: true }).isChecked(), true);
    await page.getByLabel('Assignment timezone', { exact: true }).fill('UTC');
    await page.getByLabel('Assignment timezone', { exact: true }).fill('Asia/Manila');
    await page.getByText('Uses this timezone. Set member exceptions below.', { exact: true }).waitFor();
    await shot('assignment'); await done();
    await page.getByRole('button', { name: /Configure action: 4. Update Fields/ }).click();
    assert.equal(await page.getByLabel('Field', { exact: true }).inputValue(), 'priority');
    assert.equal(await page.getByLabel('New value', { exact: true }).inputValue(), 'HIGH');
    await shot('update-field'); await done();
    await page.getByRole('button', { name: /Configure action: 5. Move Deal Stage/ }).click();
    await page.getByText('The Deal must meet this stage’s entry requirements.', { exact: true }).waitFor();
    await shot('stage'); await done();
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    // Wait for the actual save response before comparing all action data.
    await page.getByText('Draft saved. This workflow is inactive.', { exact: true }).waitFor();
    const latest = await prisma.workflow.findUniqueOrThrow({ where: { id: panelWorkflow.id } });
    assert.deepEqual(latest.draftDefinition.actions, panelWorkflow.actions);
    check(`${theme} ${width}px: trigger, condition, email, SMS, assignment, field and stage panels; saved action data preserved`);
  }

  assert.deepEqual(pageErrors, []);
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  closing = true;
  const cleanupErrors = [];
  for (const close of [() => browser?.close(), async () => {
    if (!frontend || frontend.exitCode !== null || frontend.signalCode !== null) return;
    const exit = new Promise(done => frontend.once('exit', done)); frontend.kill();
    await exit;
  }, async () => { if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); } }, () => prisma?.$disconnect(), () => pg?.stop()]) {
    try { await close(); } catch (error) { cleanupErrors.push(String(error)); }
  }
  log?.end(); Module._resolveFilename = originalResolve;
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ success: !failure && !cleanupErrors.length && checks.length === 18, checks, pageErrors, mutations, cleanupErrors, error: failure?.stack }, null, 2));
  if (cleanupErrors.length) throw Error(cleanupErrors.join('\n'));
}

// Production browser acceptance. Only disposable loopback services are used.
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
import { acceptancePort, createAcceptanceContext, setAcceptanceTheme } from './verify-browser-matrix.mjs';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { qaEnvironment } = require('../../scripts/qa-environment.cjs');
const output = process.env.LEADCRM_BROWSER_OUTPUT || resolve(root, 'data/outputs/system-audit/crm-polish-browser');
mkdirSync(output, { recursive: true });
const apiLog = createWriteStream(resolve(output, 'api.log'));
const originalLog = console.log.bind(console);
console.log = (...args) => { const line = args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '); if (/^\[\d{4}-/.test(line)) apiLog.write(line + '\n'); else originalLog(...args); };
const db = await PGlite.create();
let socket, prisma, api, frontend, browser, page;
const checks = [], errors = [];
let failure;
const pass = label => { checks.push({ label, passed: true }); console.log(`PASS ${label}`); };
try {
  await replayCrmMigrations(db);
  socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
  const database = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_crm_polish_browser?connection_limit=1&statement_cache_size=0`;
  const base = `http://localhost:${await acceptancePort()}`;
  const environment = qaEnvironment(root, { DATABASE_URL: database, DIRECT_URL: database, NODE_ENV: 'test', APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base });
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
  require('../../scripts/qa-network-guard.cjs');
  const Module = require('node:module'), originalResolve = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
  prisma = require('../dist/backend/src/config/database.config.js').default;
  const app = require('../dist/backend/src/app.js').default;
  const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const tenant = await prisma.tenant.create({ data: { name: 'CRM Polish Browser', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const tenantId = tenant.id;
  const admin = await prisma.user.create({ data: { tenantId, firstName: 'Polish', lastName: 'Admin', email: 'polish-browser@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date() } });
  const { token } = await issueAuthSession(admin);
  const account = await prisma.account.create({ data: { tenantId, name: 'Polish Company', industry: 'Technology', size: '11-50', website: 'https://company.test' } });
  const lead = await prisma.lead.create({ data: { tenantId, firstName: 'Polish', lastName: 'Lead', email: 'polish-lead@example.test', accountId: account.id, companyName: 'Old company text' } });
  const contact = await prisma.contact.create({ data: { tenantId, firstName: 'Polish', lastName: 'Contact', email: 'polish-contact@example.test', accountId: account.id, companyName: 'Old company text' } });
  const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Polish Pipeline' } });
  const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Lead', order: 0, isDefault: true, requiredFields: [] } });
  const product = await prisma.productInterest.create({ data: { tenantId, name: 'Polish Product', dealValue: 2500 } });
  const deal = await prisma.deal.create({ data: { tenantId, title: 'Polish Deal', pipelineId: pipeline.id, stageId: stage.id, accountId: account.id, productInterestId: product.id, productInterestIds: [product.id], productInterests: [product.name], productsNormalized: true, value: 2500 } });
  await prisma.leadDeal.create({ data: { tenantId, leadId: lead.id, dealId: deal.id, addedById: admin.id } });
  await prisma.contactDeal.create({ data: { tenantId, contactId: contact.id, dealId: deal.id } });
  await prisma.activity.create({ data: { tenantId, accountId: account.id, type: 'note', title: 'Legacy Internal Notes', description: 'Preserved historical company note', metadata: { legacyAccountNote: 'v1', sourceField: 'internalNotes', originalAuthorUnknown: true } } });
  const workflow = await prisma.workflow.create({ data: { tenantId, name: 'Polish Workflow', trigger: 'lead.created', version: 4, status: 'PAUSED', actions: [{ type: 'create_task', config: { title: 'Current different task' } }] } });
  const trigger = await prisma.workflowTriggerRecord.create({ data: { tenantId, workflowId: workflow.id, triggerType: 'lead.created', entityType: 'lead', entityId: lead.id, payload: { recordName: 'Polish Lead' } } });
  await prisma.workflowExecutionRun.create({ data: { tenantId, workflowId: workflow.id, triggerId: trigger.id, entityType: 'lead', entityId: lead.id, workflowVersion: 2, status: 'completed', completedAt: new Date(),
    definitionSnapshot: { name: 'Historical workflow definition', trigger: 'lead.created', isActive: true, conditions: { operator: 'AND', conditions: [{ field: 'lead.status', operator: 'equals', value: 'Warm' }] }, actions: [{ type: 'create_task', enabled: false, config: { title: 'Historical task', description: 'Saved task description', assignmentTarget: { type: 'group', id: randomUUID(), strategy: 'sticky' }, dueDaysFromNow: 3 } }] },
    steps: { create: { stepIndex: 0, actionType: 'create_task', status: 'skipped', output: { reason: 'Action disabled in saved definition.' } } } } });
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const apiBase = `http://127.0.0.1:${api.address().port}/api/v1`;
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', new URL(base).port, '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) { try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch {} await new Promise(done => setTimeout(done, 500)); }
  assert.ok(ready, 'Built frontend did not start');
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => existsSync(path));
  assert.ok(executablePath, 'A local Chromium browser is required');
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', sandboxedFrames: true });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); await page.bringToFront(); page.setDefaultTimeout(25000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/proxy', '');
    const local = apiBase + path + url.search, headers = { ...request.headers(), authorization: `Bearer ${token}` };
    if (path.endsWith('/events') || path === '/crm/record-events') return route.continue({ url: local, headers });
    try {
      const response = await page.request.fetch(local, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined,
        maxRetries: request.method() === 'GET' ? 2 : 0 });
      if (response.status() >= 500) errors.push(`${request.method()} ${path} ${response.status()}`);
      await route.fulfill({ response });
    } catch (error) {
      if (!page.isClosed()) errors.push(`${request.method()} ${path}: ${error.message.split('\n')[0]}`);
      await route.abort().catch(() => {});
    }
  });
  async function layout(label, focus) {
    for (const theme of ['Light', 'Dark']) {
      await setAcceptanceTheme(page, theme);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        if (focus) await focus.scrollIntoViewIfNeeded();
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
          outside: [...document.querySelectorAll('input,select,textarea')].filter(element => element.getClientRects().length && (element.getBoundingClientRect().left < -1 || element.getBoundingClientRect().right > innerWidth + 1)).length }));
        assert.ok(dimensions.scroll <= width + 1 && !dimensions.outside, `${label}: ${JSON.stringify(dimensions)}`);
        await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}.png`) }); pass(`${label} ${theme} ${width}px`);
      }
    }
  }
  const records = { leads: lead, contacts: contact, accounts: account, deals: deal };
  const titles = { leads: 'Polish Lead', contacts: 'Polish Contact', accounts: 'Polish Company', deals: 'Polish Deal' };
  for (const module of ['leads', 'contacts', 'accounts', 'deals']) {
    for (const surface of ['page', 'panel']) {
      await page.goto(base + (surface === 'page' ? `/crm/${module}/${records[module].id}` : `/crm/${module}?highlight=${records[module].id}`));
      if (surface === 'panel') {
        if (module === 'contacts') await page.getByRole('row').filter({ hasText: contact.email }).getByText('Polish', { exact: true }).click();
        else if (module === 'deals') await page.getByRole('heading', { name: titles[module], exact: true, level: 4 }).click();
        else await page.getByText(titles[module], { exact: true }).first().click();
      }
      await page.getByRole('heading', { name: titles[module], level: 1, exact: true }).waitFor();
      await page.getByRole('tab', { name: /Details/ }).click();
      let focus;
      if (module === 'leads' || module === 'contacts') {
        const group = page.getByRole('button', { name: 'Organization', exact: true }).locator('xpath=ancestor::section[1]'); focus = group;
        await group.locator(`a[href="/crm/accounts/${account.id}"]`).waitFor();
        assert.equal(await group.locator(`a[href="/crm/accounts/${account.id}"]`).count(), 1);
        assert.ok((await group.innerText()).includes('11-50'));
        assert.equal(await group.getByText('Technology', { exact: true }).count(), 1);
        assert.equal(await page.getByRole('button', { name: /Company \/ Organization|Account \/ Company/ }).count(), 0);
      } else if (module === 'deals') {
        const group = page.getByRole('button', { name: 'Relationships', exact: true }).locator('xpath=ancestor::section[1]'); focus = group;
        for (const [kind, id] of [['leads', lead.id], ['contacts', contact.id], ['accounts', account.id]]) {
          await group.locator(`a[href="/crm/${kind}/${id}"]`).waitFor();
          assert.equal(await group.locator(`a[href="/crm/${kind}/${id}"]`).count(), 1);
        }
        assert.equal(await page.getByRole('button', { name: 'Lead/Contact', exact: true }).count(), 0);
      } else {
        assert.equal(await page.getByRole('button', { name: 'Notes', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Edit Internal Notes' }).count(), 0);
        await page.getByRole('tab', { name: /Activity/ }).click();
        await page.getByText('Preserved historical company note', { exact: true }).first().waitFor();
        await page.getByText('Legacy import · original author unavailable', { exact: true }).first().waitFor();
        await page.getByRole('tab', { name: /Details/ }).click();
      }
      pass(`${module} ${surface} content`);
      if (surface === 'panel') await layout(`${module}-${surface}`, focus);
    }
  }
  for (const module of ['leads', 'contacts']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/crm/${module}`);
    await page.getByRole('button', { name: module === 'leads' ? /Create Lead/ : /Create Contact/, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Create New', exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByLabel('First Name *') });
    const modes = form.getByRole('group', { name: 'Account options' });
    assert.deepEqual(await modes.getByRole('button').allTextContents(), ['Link existing account', 'Create new account']);
    assert.equal(await modes.getByRole('button', { name: 'Link existing account' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await form.getByLabel('Company Name *').count(), 0);
    await form.getByRole('button', { name: 'Create new account', exact: true }).click();
    const companyName = `Created from ${module}`;
    await form.getByLabel('First Name *').fill('Created'); await form.getByLabel('Last Name *').fill(module);
    await form.getByLabel('Email *').fill(`created-${module}@example.test`);
    await form.getByLabel('Company Name *').fill(companyName); await form.getByLabel(/^Industry/).selectOption('Technology');
    await form.getByLabel('Company Size', { exact: true }).selectOption('51-200'); await form.getByLabel('Website', { exact: true }).fill('https://created.test');
    const accountAddress = form.locator('textarea[name="newAccount.address"]');
    await accountAddress.fill('24 Company Avenue\nManila');
    await form.getByRole('button', { name: 'Link existing account', exact: true }).click();
    assert.equal(await form.getByLabel('Company Name *').count(), 0);
    assert.equal(await form.getByLabel('Website', { exact: true }).count(), 0);
    await form.getByRole('button', { name: 'Create new account', exact: true }).click();
    assert.equal(await form.getByLabel('Company Name *').inputValue(), companyName);
    assert.equal(await accountAddress.inputValue(), '24 Company Avenue\nManila');
    assert.ok((await form.getByLabel('Company Name *').locator('xpath=ancestor::section[1]').innerText()).includes('Organization'));
    await layout(`${module}-form`, form.getByRole('heading', { name: 'Organization', exact: true }));
    const positions = await form.evaluate(element => Object.fromEntries(['Company Name *', 'Industry', 'Company Size', 'Website'].map(label => {
      const field = [...element.querySelectorAll('label')].find(item => item.textContent.trim().startsWith(label));
      const input = field?.htmlFor ? document.getElementById(field.htmlFor) : null; const box = input?.getBoundingClientRect(); return [label, box ? { x: box.x, y: box.y } : null];
    })));
    assert.ok(Math.abs(positions['Company Name *'].y - positions.Industry.y) < 2 && Math.abs(positions['Company Size'].y - positions.Website.y) < 2);
    await form.getByRole('button', { name: module === 'leads' ? 'Create Lead' : 'Create Contact', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
    const created = await prisma.account.findFirst({ where: { tenantId, name: companyName } }); assert.ok(created); assert.equal(created.size, '51-200'); assert.equal(created.address, '24 Company Avenue\nManila');
    const person = await prisma[module === 'leads' ? 'lead' : 'contact'].findFirst({ where: { tenantId, email: `created-${module}@example.test` } });
    assert.equal(person.accountId, created.id); assert.notEqual(person.address, created.address);
    await page.reload(); assert.equal(await prisma.account.count({ where: { tenantId, name: companyName } }), 1);
    pass(`${module} form creates linked Account`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/crm/accounts`);
  await page.getByRole('button', { name: 'Add Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Create New', exact: true }).click();
  const accountForm = page.locator('form').filter({ has: page.getByLabel('Account Name *') });
  await accountForm.getByLabel('Account Name *').fill('Responsive Account');
  const address = accountForm.getByLabel('Full Address', { exact: true });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await address.scrollIntoViewIfNeeded();
    const box = await address.boundingBox();
    const grid = await address.locator('xpath=ancestor::div[contains(@class,"grid")][1]').boundingBox();
    assert.ok(Math.abs(box.width - grid.width) < 3, `Full Address must span the form grid at ${width}px`);
  }
  await layout('account-form-address', address);
  await accountForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  pass('Account Full Address spans both desktop columns and remains responsive');
  await page.goto(`${base}/automation/workflows`); await page.getByRole('button', { name: 'View runs', exact: true }).first().click();
  const panel = page.getByRole('dialog', { name: 'Workflow details — Polish Workflow' });
  await panel.locator('details > summary').first().click(); await panel.getByText('Definition used in this run · v2', { exact: true }).click();
  await panel.getByText('Historical workflow definition', { exact: true }).waitFor(); await panel.getByText('Historical task', { exact: true }).waitFor();
  await panel.getByText('Assignment settings', { exact: true }).click(); await panel.getByText('Previous assignee / Sticky assignment', { exact: true }).waitFor();
  assert.equal(await panel.locator('pre').count(), 0); assert.equal(await panel.getByText('Current different task', { exact: true }).count(), 0);
  pass('Workflow displays executed snapshot and historical strategy'); await layout('workflow-panel');
  // Exercise the changed editor and read-only previews through the real API.
  const workerRole = await prisma.roleDefinition.create({ data: { tenantId, name: 'Workflow Browser Agent', permissions: { create: { module: 'tasks', canView: true } } } });
  const worker = await prisma.user.create({ data: { tenantId, firstName: 'Task', lastName: 'Agent', email: 'workflow-task-agent@example.test', role: workerRole.name, status: 'ACTIVE', userRoles: { create: { roleId: workerRole.id } } } });
  await prisma.lead.update({ where: { id: lead.id }, data: { assignedUserId: admin.id } });
  await prisma.emailAccount.create({ data: { tenantId, userId: admin.id, email: admin.email, accessToken: 'disposable-preview-only', scopes: ['gmail.send'] } });
  for (let index = 2; index <= 3; index++) await prisma.deal.create({ data: { tenantId, pipelineId: pipeline.id, stageId: stage.id, title: `Preview Deal ${index}`, leadDeals: { create: { leadId: lead.id } } } });
  const draft = { name: 'Workflow email preview', trigger: 'lead.created', isActive: false, actions: [
    { type: 'send_email', config: { subject: 'Hello NAME!', body: '<p>Hello {{firstName}}</p>' } },
  ] };
  const draftResponse = await page.request.post(`${apiBase}/automation/workflows`, { headers: { authorization: `Bearer ${token}` }, data: draft });
  assert.equal(draftResponse.status(), 201, await draftResponse.text());
  const previewWorkflow = (await draftResponse.json()).data;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/automation/workflows/${previewWorkflow.id}/edit`);
  await page.getByRole('button', { name: 'Configure action: 1. Send Email', exact: true }).click();
  assert.equal(await page.getByLabel('Connected Gmail sender', { exact: true }).count(), 0);
  const subject = page.getByLabel('Subject (overrides template)', { exact: true });
  await subject.focus(); await subject.evaluate(element => element.setSelectionRange(6, 10));
  const insert = page.getByRole('button', { name: 'Insert Variable into Subject (overrides template)', exact: true });
  await insert.click();
  const variables = page.getByRole('group', { name: 'Variables for Subject (overrides template)', exact: true });
  await variables.getByRole('textbox', { name: 'Search variables', exact: true }).fill('First Name');
  await variables.getByRole('button', { name: /^First Name/ }).click();
  assert.equal(await subject.inputValue(), 'Hello {{firstName}}!');
  assert.equal(await subject.evaluate(element => new Promise(done => requestAnimationFrame(() => done(document.activeElement === element && element.selectionStart === 19)))), true);
  await insert.focus(); await page.keyboard.press('Enter');
  const search = variables.getByRole('textbox', { name: 'Search variables', exact: true });
  await search.waitFor(); await search.fill(''); await search.focus(); await page.keyboard.press('Tab');
  assert.equal(await variables.evaluate(element => element.contains(document.activeElement)), true);
  assert.equal(await variables.getByText('Sender', { exact: true }).count(), 0);
  assert.equal(await variables.getByText('Account Name', { exact: true }).count(), 0);
  await page.keyboard.press('Escape'); assert.equal(await insert.evaluate(element => document.activeElement === element), true);
  pass('Workflow Insert Variable replaces selection, restores cursor and supports keyboard focus');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('button', { name: 'Test', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Step configuration', exact: true }).count(), 0);
  await page.getByLabel('Sample record', { exact: false }).selectOption(lead.id);
  const countsBefore = await Promise.all([prisma.task.count({ where: { tenantId } }), prisma.emailDeliveryLog.count({ where: { tenantId } }), prisma.workflowExecutionRun.count({ where: { tenantId } })]);
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await page.getByText(/Subject:.*Hello Polish!/).waitFor();
  assert.equal(await page.getByTitle('Email message preview 1').getAttribute('sandbox'), '');
  assert.deepEqual(await Promise.all([prisma.task.count({ where: { tenantId } }), prisma.emailDeliveryLog.count({ where: { tenantId } }), prisma.workflowExecutionRun.count({ where: { tenantId } })]), countsBefore);
  await layout('workflow-email-preview');
  await page.reload();
  await page.getByRole('button', { name: 'Configure action: 1. Send Email', exact: true }).click();
  assert.equal(await page.getByLabel('Subject (overrides template)', { exact: true }).inputValue(), 'Hello {{firstName}}!');
  pass('Lead email draft retains personalization after refresh and previews without sending');
  const taskResponse = await page.request.post(`${apiBase}/automation/workflows`, { headers: { authorization: `Bearer ${token}` }, data: {
    name: 'Workflow Deal task preview', trigger: 'deal.created', isActive: false,
    actions: [{ type: 'create_task', config: { title: 'Triggering Deal follow-up', assignmentTarget: { type: 'user', id: worker.id } } }],
  } });
  assert.equal(taskResponse.status(), 201, await taskResponse.text());
  const taskWorkflow = (await taskResponse.json()).data;
  await page.goto(`${base}/automation/workflows/${taskWorkflow.id}/edit`);
  await page.getByRole('button', { name: 'Configure action: 1. Create Task', exact: true }).click();
  assert.equal(await page.getByLabel('Associate task with', { exact: true }).inputValue(), 'triggering_deal');
  assert.equal(await page.getByRole('button', { name: 'Pipeline filter', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await page.getByLabel('Sample record', { exact: false }).selectOption(deal.id);
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await page.getByText('Creates 1 task linked to 1 deal.', { exact: true }).waitFor();
  assert.deepEqual(await Promise.all([prisma.task.count({ where: { tenantId } }), prisma.emailDeliveryLog.count({ where: { tenantId } }), prisma.workflowExecutionRun.count({ where: { tenantId } })]), countsBefore);
  await layout('workflow-deal-task-preview');
  pass('Supported Deal task preview uses the triggering Deal and performs no writes');
  assert.deepEqual(errors, []); pass('No page or API 5xx errors');
} catch (error) {
  failure = error; console.error(error);
  await page?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', checks, pageErrors: errors, failure: failure?.message }, null, 2));
  await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  await browser?.close(); frontend?.kill();
  if (api) await new Promise(done => api.close(done));
  await prisma?.$disconnect(); await socket?.stop(); await new Promise(done => setImmediate(done)); await db.close(); console.log = originalLog; apiLog.end();
}

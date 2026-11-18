// Browser acceptance against a disposable DB and locally built application.
// Usage: set PLAYWRIGHT_MODULE (or pass argv[2]) to an installed Playwright package.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
import { acceptancePort, responsiveMatrix, createAcceptanceContext } from './verify-browser-matrix.mjs';
const root = resolve(import.meta.dirname, '../..'), output = process.env.LEADCRM_BROWSER_OUTPUT || (resolve(root, 'data/outputs/workflow-browser'));
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = `http://localhost:${await acceptancePort()}`;
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_workflow_browser?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base });
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
let failWorkflowRead = false;

const { saveField } = require('../dist/backend/src/modules/crm/closing-requirements/closing-requirements.service.js');
const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
async function readDraft(id) {
  const saved = await prisma.workflow.findUniqueOrThrow({ where: { id } });
  return { ...saved, ...(saved.draftDefinition || {}) };
}
try {
  const tenant = await prisma.tenant.create({ data: { name: 'Workflow Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Workflow', lastName: 'Tester', email: 'workflow-preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin);
  const scope = run => tenantContext.run({ tenantId: tenant.id }, run);
  const publishDraft = async id => {
    const saved = await readDraft(id);
    const { name, description, trigger, conditions, actions } = saved;
    return scope(() => workflows.publishWorkflowDraft(id, tenant.id, admin.id, { draft: { name, ...(typeof description === 'string' ? { description } : {}), trigger, conditions, actions }, expectedVersion: saved.version, expectedDraftRevision: saved.draftRevision }));
  };
  const pipeline = await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  const records = {};
  records.lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'Workflow', lastName: 'Lead', email: 'lead@example.test', assignedUserId: admin.id } });
  records.contact = await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'Workflow', lastName: 'Contact', email: 'contact@example.test', assignedUserId: admin.id } });
  records.account = await prisma.account.create({ data: { tenantId: tenant.id, name: 'Workflow Account',  } });
  const stage = await prisma.stage.findFirstOrThrow({ where: { tenantId: tenant.id, pipelineId: pipeline.pipeline.id } });
  records.deal = await prisma.deal.create({ data: { tenantId: tenant.id, title: 'Workflow Deal', pipelineId: stage.pipelineId, stageId: stage.id, assignedUserId: admin.id } });
  await prisma.leadDeal.create({ data: { tenantId: tenant.id, leadId: records.lead.id, dealId: records.deal.id } });
  const definitions = {}, saved = {};
  for (const [entity, module] of Object.entries({ lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' })) {
    definitions[entity] = await scope(() => saveField(tenant.id, admin.id, { module, group: entity === 'deal' ? 'Additional Details' : 'Additional Information', name: 'Site Access', type: 'Dropdown', required: false, options: ['Standard', 'Restricted'] }));
    saved[entity] = await scope(() => workflows.createWorkflow(tenant.id, admin.id, { name: entity + ' acceptance', trigger: entity + '.updated', isActive: entity === 'lead', conditions: { operator: 'AND', conditions: [{ field: entity + '.customFieldValues.' + definitions[entity].id, operator: 'is_empty', value: null }] }, actions: [{ type: 'update_field', config: { field: 'customFieldValues.' + definitions[entity].id, value: 'Standard' } }] }));
    if (entity === 'lead') await scope(() => workflows.toggleWorkflow(saved[entity].id, tenant.id, admin.id, false));
  }
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', new URL(base).port, '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(120000); page.on('pageerror', error => pageErrors.push(error.message));
  // Only the browser transport is redirected; authentication and all data use the real local API/SQL.
  await page.route('**/api/proxy/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const localUrl = `http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`;
    const headers = { ...request.headers(), authorization: `Bearer ${token}` };
    // Keep real event streams open; APIRequestContext buffers response bodies.
    if (['/api/proxy/auth/events', '/api/proxy/crm/record-events', '/api/proxy/crm/pipelines/events'].includes(url.pathname)) return route.continue({ url: localUrl, headers });
    if (failWorkflowRead && request.method() === 'GET' && url.pathname.endsWith('/automation/workflows/' + saved.lead.id)) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Acceptance: Workflow temporarily unavailable' } }) });
    }
    try {
      const response = await page.request.fetch(localUrl, { method: request.method(), headers, data: request.postDataBuffer() ?? undefined, maxRetries: request.method() === 'GET' ? 2 : 0 });
      await route.fulfill({ response });
    } catch (error) {
      if (!closing) transportErrors.push(`${request.method()} ${url.pathname}: ${String(error).split('\n')[0]}`);
      await route.abort().catch(() => {});
    }
  });

  const record = label => { checks.push({ label }); console.log('PASS', label); };
  async function responsive(label) {
    for await (const { theme, width } of responsiveMatrix(page, { themes: ['Classic', 'Light', 'Dark', 'System'] })) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, outside: [...document.querySelectorAll('input, select, textarea')].filter(el => el.getClientRects().length && (el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1)).map(el => el.getAttribute('aria-label')) }));
      assert.equal(dimensions.overflow, false, JSON.stringify(dimensions)); assert.deepEqual(dimensions.outside, [], JSON.stringify(dimensions));
      await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}.png`) }); record(`${label} ${theme} ${width}px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  for (const entity of ['lead', 'contact', 'account', 'deal']) {
    await page.goto(base + '/automation/workflows/' + saved[entity].id + '/edit');
    const condition = page.getByRole('button', { name: /Configure condition:/ });
    await condition.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Condition 1 field', { exact: true }).inputValue(), entity + '.customFieldValues.' + definitions[entity].id);
    assert.equal(await page.getByLabel('Condition 1 operator', { exact: true }).inputValue(), 'is_empty');
    await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('equals');
    assert.deepEqual(await page.getByLabel('Condition 1 value', { exact: true }).locator('option').allTextContents(), ['Select site access', 'Standard', 'Restricted']);
    await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('is_empty');
    record(entity + ' custom condition uses typed options and keyboard activation');
    await page.getByRole('button', { name: /Configure action: 1. Update Fields/ }).click();
    await page.getByLabel('Field group', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Field group', { exact: true }).inputValue(), 'custom');
    assert.equal(await page.getByLabel('New value', { exact: true }).inputValue(), 'Standard');
    assert.deepEqual(await page.getByLabel('New value', { exact: true }).locator('option').allTextContents(), ['Select site access', 'Standard', 'Restricted']);
    await responsive(entity + '-custom-update');
    await page.getByLabel('New value', { exact: true }).selectOption('Restricted');
    await page.getByText('Testing uses the last saved draft', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Test draft', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Test draft')?.disabled);
    const persisted = await readDraft(saved[entity].id);
    assert.equal(persisted.status, entity === 'lead' ? 'PAUSED' : 'DRAFT'); assert.equal(persisted.isActive, false);
    assert.equal(persisted.actions[0].config.value, 'Restricted'); record(entity + ' save persisted correct lifecycle');
    await page.reload();
    await page.getByRole('button', { name: /Configure action: 1. Update Fields/ }).click();
    assert.equal(await page.getByLabel('New value', { exact: true }).inputValue(), 'Restricted');
    await page.getByRole('button', { name: 'Test draft', exact: true }).click();
    await page.getByLabel('Sample record', { exact: false }).selectOption(records[entity].id);
    const before = await prisma.customFieldValue.count({ where: { tenantId: tenant.id } });
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.getByText('Configuration and references valid. No changes made.', { exact: false }).waitFor();
    assert.equal(await prisma.customFieldValue.count({ where: { tenantId: tenant.id } }), before);
    assert.equal(await prisma.workflowExecutionRun.count({ where: { tenantId: tenant.id } }), 0); record(entity + ' dry-run is read-only');
  }
  await page.goto(base + '/automation/workflows');
  await page.getByRole('grid').waitFor();
  await page.getByLabel('Resume workflow', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Resume workflow', { exact: true }).count(), 1);
  assert.equal(await page.getByLabel('Activate workflow', { exact: true }).count(), 3); record('List distinguishes Draft activation from Paused resume');
  await page.getByRole('button', { name: 'Create Workflow', exact: true }).click();
  await page.getByRole('dialog', { name: 'Create workflow', exact: true }).waitFor();
  assert.equal(await page.locator('[data-template-index]').count(), 14);
  const configuredStages = await prisma.stage.findMany({ where: { tenantId: tenant.id, pipelineId: pipeline.pipeline.id } });
  assert.ok(configuredStages.length > 0);
  assert.equal(await page.locator('[data-template-index]').count(), 14);
  assert.equal(await page.locator('[data-template-id^="stage:"]').count(), 0);
  await page.getByRole('button', { name: 'Preview Deal Entered a Specific Stage', exact: true }).waitFor();
  await page.getByLabel('Search templates', { exact: true }).fill('Move Related Deal');
  assert.equal(await page.locator('[data-template-index]').count(), 0);
  await page.getByLabel('Search templates', { exact: true }).fill('Automatic Deal Stage Update');
  assert.equal(await page.locator('[data-template-index]').count(), 1);
  await page.getByRole('button', { name: 'Preview Automatic Deal Stage Update', exact: true }).click();
  await page.getByRole('region', { name: 'Template setup requirements' }).waitFor();
  await page.getByRole('button', { name: 'Close create workflow', exact: true }).click();
  record('The chooser offers 14 searchable starters, excludes retired related-status routing, and explains stage-update prerequisites');
  await page.goto(base + '/automation/workflows/new');
  await page.getByLabel('Workflow name', { exact: true }).waitFor(); record('Blank builder loads without creating a database record');
  assert.equal(await prisma.workflow.count({ where: { tenantId: tenant.id } }), 4);
  failWorkflowRead = true;
  await page.goto(base + '/automation/workflows/' + saved.lead.id + '/edit');
  await page.getByText('Acceptance: Workflow temporarily unavailable', { exact: false }).waitFor();
  failWorkflowRead = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: /Configure action: 1. Update Fields/ }).waitFor();
  record('Failed Workflow load shows an error and Retry recovers the saved builder');

  const score = await scope(() => saveField(tenant.id, admin.id, { module: 'leads', group: 'Additional Information', name: 'Acceptance Score', type: 'Number', required: false }));
  await page.goto(base + '/automation/workflows/' + saved.lead.id + '/edit');
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  await page.getByLabel('Condition 1 field', { exact: true }).selectOption('lead.customFieldValues.' + score.id);
  const numericInput = page.getByLabel('Condition 1 value', { exact: true });
  assert.equal(await numericInput.getAttribute('type'), 'number');
  assert.equal(await numericInput.inputValue(), '');
  assert.deepEqual(await page.getByLabel('Condition 1 operator', { exact: true }).locator('option').allTextContents(), ['Equals', 'Not equals', 'Greater than', 'Greater than or equal', 'Less than', 'Less than or equal']);
  const priorCondition = (await readDraft(saved.lead.id)).conditions;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  assert.deepEqual((await readDraft(saved.lead.id)).conditions, priorCondition);
  await numericInput.fill('0');
  await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('greater_than_or_equal');
  await scope(() => saveField(tenant.id, admin.id, { name: 'Current Acceptance Score' }, score.id));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('option', { name: 'Current Acceptance Score', exact: true }).waitFor({ state: 'attached' });
  assert.equal(await numericInput.inputValue(), '0');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('button', { name: 'Test draft', exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Test draft')?.disabled);
  const numericDraft = await readDraft(saved.lead.id);
  assert.deepEqual(numericDraft.conditions.conditions, [{ field: 'lead.customFieldValues.' + score.id, operator: 'greater_than_or_equal', value: 0 }]);
  assert.equal(numericDraft.isActive, false);
  await page.reload();
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  assert.equal(await page.getByLabel('Condition 1 value', { exact: true }).inputValue(), '0');
  assert.equal(await page.getByLabel('Condition 1 operator', { exact: true }).inputValue(), 'greater_than_or_equal');
  record('Number operators, explicit zero, metadata refresh preserving edits, save and reload use the real API and SQL');
  await responsive('number-condition');

  await page.getByLabel('Match conditions', { exact: true }).selectOption('OR');
  await page.getByRole('button', { name: 'Add condition', exact: true }).click();
  await page.getByLabel('Condition 2 field', { exact: true }).selectOption('event.changedFields');
  const changedFieldValue = page.getByLabel('Condition 2 value', { exact: true });
  assert.equal(await changedFieldValue.evaluate(element => element.tagName), 'SELECT');
  assert.ok((await changedFieldValue.locator('option').evaluateAll(options => options.map(option => option.value))).includes('customFieldValues.' + score.id));
  await changedFieldValue.selectOption('address');
  await page.getByRole('button', { name: 'Add condition', exact: true }).click();
  await page.getByLabel('Condition 3 field', { exact: true }).selectOption('lead.firstName');
  await page.getByLabel('Condition 3 operator', { exact: true }).selectOption('starts_with');
  await page.getByLabel('Condition 3 value', { exact: true }).fill('workflow');
  const savedOr = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/automation/workflows/' + saved.lead.id + '/draft') && response.ok());
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await savedOr;
  const orDraft = await readDraft(saved.lead.id);
  assert.equal(orDraft.conditions.operator, 'OR'); assert.equal(orDraft.conditions.conditions.length, 3);
  assert.deepEqual(orDraft.conditions.conditions[1], { field: 'event.changedFields', operator: 'contains', value: 'address' });
  await page.reload(); await page.getByRole('button', { name: /Configure condition:/ }).click();
  assert.equal(await page.getByLabel('Match conditions', { exact: true }).inputValue(), 'OR');
  assert.equal(await page.getByLabel('Condition 2 value', { exact: true }).inputValue(), 'address');
  assert.equal(await page.getByLabel('Condition 3 value', { exact: true }).inputValue(), 'workflow');
  await page.getByRole('button', { name: 'Remove condition 2', exact: true }).click();
  assert.equal(await page.getByLabel('Condition 2 field', { exact: true }).inputValue(), 'lead.firstName');
  assert.equal(await page.getByLabel('Condition 3 field', { exact: true }).count(), 0);
  await page.getByLabel('Match conditions', { exact: true }).selectOption('AND');
  const savedAnd = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/automation/workflows/' + saved.lead.id + '/draft') && response.ok());
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await savedAnd;
  assert.equal((await readDraft(saved.lead.id)).conditions.operator, 'AND');
  record('Multiple OR conditions, Changed fields picker, save/reload, deletion/renumbering and AND mode persist through the real API');

  await page.goto(base + '/automation/workflows/new?template=17');
  await page.getByRole('button', { name: /Configure action: 1. Move Deal Stage/ }).click();
  const routingStages = await prisma.stage.findMany({ where: { tenantId: tenant.id, pipelineId: pipeline.pipeline.id, isWon: false, isLost: false }, orderBy: { order: 'asc' } });
  assert.ok(routingStages.length >= 2);
  await page.getByLabel('Template source stage', { exact: true }).selectOption(routingStages[0].id);
  await page.getByLabel('Template target stage', { exact: true }).selectOption(routingStages[1].id);
  await page.getByRole('button', { name: /Configure condition:/ }).click();
  assert.equal(await page.getByLabel('Template source stage', { exact: true }).inputValue(), routingStages[0].id);
  assert.equal(await page.getByLabel('Template target stage', { exact: true }).inputValue(), routingStages[1].id);
  await responsive('linked-stage-template');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.waitForURL(/\/automation\/workflows\/[^/]+\/edit$/);
  const routingDraft = await readDraft(page.url().split('/').at(-2));
  assert.equal(routingDraft.isActive, false);
  assert.equal(routingDraft.actions[0].config.stageId, routingStages[1].id);
  assert.deepEqual(routingDraft.conditions.conditions, [{ field: 'deal.pipelineId', operator: 'equals', value: pipeline.pipeline.id }, { field: 'deal.stageId', operator: 'equals', value: routingStages[0].id }]);
  record('Linked template setup persists matching pipeline/source conditions and target action as an inactive draft');

  const taskRole = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Workflow task specialists', permissions: { create: { module: 'tasks', canView: true } } } });
  const specialist = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Ana', lastName: 'Specialist', email: 'workflow-specialist@camxian.com', role: taskRole.name,
    userRoles: { create: { roleId: taskRole.id } } } });
  const pool = await prisma.tenantGroup.create({ data: { tenantId: tenant.id, name: 'Customer Follow-up and Technical Support Team', members: { create: [{ userId: specialist.id }, { userId: admin.id }] } } });
  const assignment = await scope(() => workflows.createWorkflow(tenant.id, admin.id, { name: 'Assignment browser acceptance', trigger: 'deal.created', isActive: false,
    actions: [{ type: 'create_task', config: { title: 'Follow up with lead' } }] }));
  await page.goto(base + '/automation/workflows/' + assignment.id + '/edit');
  await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
  const assignTo = page.getByLabel('Assign to', { exact: true });
  await assignTo.focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await assignTo.inputValue(), 'group');
  const groupControl = page.getByLabel('Assignment group', { exact: true });
  await groupControl.focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await groupControl.inputValue(), pool.id);
  await page.getByText('2 members · 1 eligible', { exact: true }).waitFor();
  assert.deepEqual(await page.getByLabel('Assignment method', { exact: true }).locator('option').allTextContents(), ['Round-robin']);
  await page.getByText('Assigns each eligible member in turn.', { exact: true }).waitFor();
  record('Keyboard-only group selection shows eligibility and excludes Client Admin from the pool');
  await responsive('assignment-group');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved. This workflow is inactive.', { exact: true }).waitFor();
  const assignedDraft = await readDraft(assignment.id);
  assert.deepEqual(assignedDraft.actions[0].config.assignmentTarget, { type: 'group', id: pool.id, strategy: 'round_robin' });
  assert.equal(assignedDraft.version, 1); assert.equal(assignedDraft.draftRevision, 1);
  await page.getByRole('button', { name: 'Test draft', exact: true }).click();
  await page.getByLabel('Sample record', { exact: false }).selectOption(records.deal.id);
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await page.getByText('Would assign Ana Specialist (1 eligible).', { exact: false }).waitFor();
  assert.equal(await prisma.tenantPreference.count({ where: { tenantId: tenant.id, module: 'workflow-assignment' } }), 0);
  assert.equal(await prisma.task.count({ where: { tenantId: tenant.id } }), 0);
  record('Group dry-run previews a Task specialist without writing Tasks or assignment rotation');

  const publishedAssignment = await publishDraft(assignment.id);
  const { fireWorkflowTrigger } = require('../dist/backend/src/modules/automation/workflows/workflow.engine.js');
  await scope(() => fireWorkflowTrigger({ tenantId: tenant.id, actorId: admin.id, eventId: randomUUID(), entityType: 'deal', entityId: records.deal.id, triggerType: 'deal.created', context: {} }));
  await scope(() => workflows.updateWorkflow(assignment.id, tenant.id, admin.id, { actions: [{ type: 'create_task', config: { title: 'Revised follow-up', assignmentTarget: { type: 'group', id: pool.id, strategy: 'round_robin' } } }] }));
  await page.goto(base + '/automation/workflows/' + assignment.id + '/edit');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const historyVersionLabel = 'Definition used in this run · v' + publishedAssignment.version;
  await page.getByText(historyVersionLabel, { exact: true }).waitFor({ state: 'attached' });
  await page.locator('details').first().locator('summary').first().click();
  await page.getByText('Assigned to Ana Specialist', { exact: false }).waitFor();
  await page.getByText(historyVersionLabel, { exact: true }).click();
  const savedDefinition = page.getByText(historyVersionLabel, { exact: true }).locator('..');
  await savedDefinition.getByText('Follow up with lead', { exact: true }).waitFor();
  assert.match(await savedDefinition.innerText(), /Follow up with lead/);
  assert.doesNotMatch(await savedDefinition.innerText(), /Revised follow-up/);
  await responsive('assignment-history');
  record('Run history retains the executed version, definition and concrete assignee after edits');
  await scope(() => workflows.toggleWorkflow(assignment.id, tenant.id, admin.id, false));
  for (const filter of ['none', 'availability', 'capacity']) {
    await scope(() => workflows.updateWorkflow(assignment.id, tenant.id, admin.id, { actions: [{ type: 'create_task', config: { title: 'Round-robin follow-up', assignmentTarget: { type: 'group', id: pool.id, strategy: 'round_robin' } } }] }));
    await page.goto(base + '/automation/workflows/' + assignment.id + '/edit');
    await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
    assert.deepEqual(await page.getByLabel('Assignment method', { exact: true }).locator('option').allTextContents(), ['Round-robin']);
    if (filter === 'availability') {
      await page.getByLabel('Use availability schedule', { exact: true }).check();
      await page.getByLabel('Assignment timezone', { exact: true }).fill('UTC');
      const hour = new Date().getUTCHours();
      await page.getByLabel('Default shift start', { exact: true }).fill(`${String((hour + 23) % 24).padStart(2, '0')}:00`);
      await page.getByLabel('Default shift end', { exact: true }).fill(`${String((hour + 1) % 24).padStart(2, '0')}:00`);
      for (const day of ['Sat', 'Sun']) await page.getByLabel('Default shift ' + day, { exact: true }).check();
      await page.getByText('Member settings (1)', { exact: true }).click();
      await page.getByLabel('Ana Specialist custom shift', { exact: true }).check();
    }
    if (filter === 'capacity') {
      await page.getByLabel('Enforce capacity limit', { exact: true }).check();
      await page.getByLabel('Default capacity limit', { exact: true }).fill('100');
      await page.getByText('Member settings (1)', { exact: true }).click();
      await page.getByLabel('Ana Specialist capacity limit', { exact: true }).fill('50');
    }
    if (filter !== 'none') await responsive('assignment-' + filter);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Changes saved. This workflow is paused.', { exact: true }).waitFor();
    const definition = await readDraft(assignment.id);
    assert.equal(definition.actions[0].config.assignmentTarget.strategy, 'round_robin');
    await page.reload();
    await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
    assert.equal(await page.getByLabel('Assignment method', { exact: true }).inputValue(), 'round_robin');
    await page.getByRole('button', { name: 'Test draft', exact: true }).click();
    await page.getByLabel('Sample record', { exact: false }).selectOption(records.deal.id);
    await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await page.getByText('Would assign Ana Specialist (1 eligible).', { exact: false }).waitFor();
    await publishDraft(assignment.id);
    await scope(() => fireWorkflowTrigger({ tenantId: tenant.id, actorId: admin.id, eventId: randomUUID(), entityType: 'deal', entityId: records.deal.id, triggerType: 'deal.created', context: {} }));
    const history = await scope(() => workflows.getWorkflowExecutions(assignment.id, tenant.id));
    assert.equal(history[0].status, 'completed');
    assert.equal(history[0].steps[0].output.strategy, 'round_robin');
    await scope(() => workflows.toggleWorkflow(assignment.id, tenant.id, admin.id, false));
    record('Round-robin with ' + filter + ' filter saves, reloads, previews and executes through real domain services');
  }
  // Assignment actions above can transfer CRM ownership. Preserve the normal
  // deactivation guard while testing an inactive member of this assignment pool.
  for (const model of [prisma.lead, prisma.contact, prisma.deal]) {
    await model.updateMany({ where: { tenantId: tenant.id, assignedUserId: specialist.id }, data: { assignedUserId: admin.id } });
  }
  await prisma.user.update({ where: { id: specialist.id }, data: { status: 'INACTIVE' } });
  await page.goto(base + '/automation/workflows/' + assignment.id + '/edit');
  await page.getByRole('button', { name: /Configure action: 1. Create Task/ }).click();
  await page.getByText('2 members · 0 eligible', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Test draft', exact: true }).click();
  await page.getByLabel('Sample record', { exact: false }).selectOption(records.deal.id);
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await page.getByText('no active members eligible', { exact: false }).waitFor();
  await assert.rejects(scope(() => workflows.toggleWorkflow(assignment.id, tenant.id, admin.id, true)), /no active members/);
  record('Inactive users disappear from eligibility and empty active pools fail preview and activation');
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors }, null, 2));
  console.log('Browser acceptance passed: ' + checks.length + ' checks.');
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors, error: String(error) }, null, 2));
  throw error;
} finally {
  closing = true;
  await browser?.close(); frontend?.kill(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

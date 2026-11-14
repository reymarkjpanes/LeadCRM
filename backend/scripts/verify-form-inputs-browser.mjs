// Isolated browser/proxy/API/database acceptance. No configured database or providers.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream, cpSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
import { acceptancePort, createAcceptanceContext, isolateBrowserContext, setAcceptanceTheme } from './verify-browser-matrix.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.LEADCRM_BROWSER_OUTPUT || resolve(root, 'data/outputs/system-audit/form-inputs/browser'));
mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const { qaEnvironment } = require('../../scripts/qa-environment.cjs');
const text = `ñ é 中文 日本語 한글 مرحبا 😊 & ' " < > ∑ ₱ e\u0301`;
const notes = `${text}\n<tag>literal text</tag>`;
const base = `http://localhost:${await acceptancePort()}`;
const checks = [], pageErrors = [];
let db, socket, prisma, api, frontend, browser, page;
const record = label => { checks.push(label); console.log('PASS', label); };

try {
  console.log('Preparing disposable UTF-8 browser fixture');
  db = await PGlite.create(); await replayCrmMigrations(db);
  socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
  const databaseUrl = `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_form_inputs_browser?connection_limit=1&statement_cache_size=0`;
  Object.assign(process.env, qaEnvironment(root, { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, APP_URL: base, ALLOWED_ORIGINS: base }));
  const Module = require('node:module'), originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options);
  };
  prisma = require('../dist/backend/src/config/database.config.js').default;
  const app = require('../dist/backend/src/app.js').default;
  const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
  const tenant = await prisma.tenant.create({ data: { name: 'Form input acceptance', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Input', lastName: 'Tester', email: 'input-tester@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, emailVerified: new Date(), onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin);
  const staff = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Task', lastName: 'Agent', email: 'input-agent@camxian.com', role: 'Task staff', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const taskRole = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Task staff', permissions: { create: { module: 'tasks', canView: true } } } });
  await prisma.userRole.create({ data: { tenantId: tenant.id, userId: staff.id, roleId: taskRole.id } });
  const pipeline = await prisma.pipeline.create({ data: { tenantId: tenant.id, name: 'Input acceptance', isDefault: true } });
  const stage = await prisma.stage.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, name: 'New', order: 0, isDefault: true } });
  const deal = await prisma.deal.create({ data: { tenantId: tenant.id, title: 'Input acceptance Deal', pipelineId: pipeline.id, stageId: stage.id, assignedUserId: admin.id } });
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const apiUrl = `http://127.0.0.1:${api.address().port}/api/v1`;
  // Use an owned source copy so another local preview can keep its .next-dev cache.
  const frontendSource = resolve(root, 'frontend');
  const preview = resolve(root, '.tmp/form-inputs-preview/frontend');
  cpSync(frontendSource, preview, { recursive: true, filter: source => {
    const relative = source.slice(frontendSource.length).replaceAll('\\', '/');
    return !relative.split('/').some(part => ['node_modules', '.next', '.next-dev', '.turbo'].includes(part) || part.startsWith('.env'));
  } });
  const previewConfig = resolve(preview, 'next.config.ts');
  writeFileSync(previewConfig, readFileSync(previewConfig, 'utf8').replace("output: 'standalone',", "output: 'standalone',\n    webpack(config) { config.cache = false; return config; },"));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', new URL(base).port, '-H', '127.0.0.1'], {
    cwd: preview, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development', LEADCRM_QA_BUILD_ASSETS: '1', API_URL: apiUrl },
  });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (frontend.exitCode !== null) throw Error('Frontend exited; see frontend.log');
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch { /* Wait for the owned local server. */ }
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(ready, 'Local frontend becomes ready');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 900 } });
  await isolateBrowserContext(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base + '/login');
  async function call(path, method = 'GET', body) {
    return page.evaluate(async ({ path, method, body }) => {
      const response = await fetch('/api/proxy' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const payload = await response.json();
      if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
      return payload;
    }, { path, method, body });
  }
  const encoding = await prisma.$queryRaw`SELECT current_setting('server_encoding') AS server, current_setting('client_encoding') AS client`;
  assert.deepEqual(encoding, [{ server: 'UTF8', client: 'UTF8' }]);
  record('PostgreSQL and Prisma use UTF8');

  async function visual(label, controls) {
    for (const theme of ['Light', 'Dark']) {
      await setAcceptanceTheme(page, theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        // The responsive inspector focuses its first field when it switches layout.
        await page.waitForTimeout(250);
        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForFunction(({ first, second, theme }) => {
          const a = getComputedStyle(first), b = getComputedStyle(second);
          return ![...first.getAnimations(), ...second.getAnimations()].some(animation => animation.playState === 'running')
            && a.backgroundColor === b.backgroundColor && a.borderColor === b.borderColor
            && (theme !== 'Light' || a.backgroundColor === 'rgb(255, 255, 255)');
        }, { first: await controls[0].elementHandle(), second: await controls[1].elementHandle(), theme });
        const styles = [];
        for (const control of controls) styles.push(await control.evaluate(el => {
          const css = getComputedStyle(el), box = el.getBoundingClientRect();
          return { background: css.backgroundColor, border: css.borderColor, width: box.width, outside: box.left < -1 || box.right > innerWidth + 1, placeholder: el.placeholder };
        }));
        assert.ok(styles.every(style => style.width > 0 && !style.outside && style.placeholder), JSON.stringify(styles));
        assert.equal(styles[0].background, styles[1].background);
        assert.equal(styles[0].border, styles[1].border);
        if (theme === 'Light') assert.equal(styles[0].background, 'rgb(255, 255, 255)');
        await page.screenshot({ path: resolve(output, `${label}-${theme.toLowerCase()}-${width}.png`) });
      }
    }
    await setAcceptanceTheme(page, 'Light'); await page.setViewportSize({ width: 1440, height: 900 });
    record(`${label}: matching field surfaces and borders at desktop/mobile widths in Light/Dark`);
  }

  async function verifyPastedLimit(input, text, message) {
    await input.fill('');
    await input.focus();
    await page.evaluate(value => navigator.clipboard.writeText(value), text);
    await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await page.waitForFunction(({ field, value }) => field.value === value && field.getAttribute('aria-invalid') === 'true',
      { field: await input.elementHandle(), value: text });
    const errorId = await input.getAttribute('aria-describedby');
    assert.equal(await page.evaluate(id => document.getElementById(id)?.textContent, errorId), message);
    await input.fill(text.slice(1));
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
  }

  await call('/administration/product-interests/categories', 'PATCH', { action: 'add', name: 'Unicode' });
  await page.goto(base + '/settings?tab=products');
  await page.getByRole('button', { name: 'Add Product', exact: true }).click();
  const productName = page.getByPlaceholder('Enter product name...'), productDescription = page.getByPlaceholder('Describe this product...');
  await productName.fill(text); await productDescription.fill(notes);
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('Unicode');
  await page.getByRole('textbox', { name: 'Deal Value (PHP)', exact: true }).fill('123');
  for (const [theme, width] of [['Light', 1440], ['Dark', 390]]) {
    await setAcceptanceTheme(page, theme);
    await page.setViewportSize({ width, height: 900 });
    await verifyPastedLimit(productName, 'P'.repeat(201), 'Product name must not exceed 200 characters.');
    await verifyPastedLimit(productDescription, 'D'.repeat(1001), 'Product description must not exceed 1000 characters.');
  }
  record('Products: pasting over-limit values preserves the draft and shows inline errors on desktop light and mobile dark');
  await productName.fill(text); await productDescription.fill(notes);
  await visual('product', [productName, productDescription]);
  await page.getByRole('button', { name: 'Save Product', exact: true }).click();
  await page.getByRole('button', { name: 'Edit product', exact: true }).first().click();
  assert.equal(await productName.inputValue(), text); assert.equal(await productDescription.inputValue(), notes);
  await productDescription.fill(notes + '\nEdited');
  await page.getByRole('button', { name: 'Save Product', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Edit product', exact: true }).first().click();
  assert.equal(await productDescription.inputValue(), notes + '\nEdited');
  assert.equal((await call('/administration/product-interests')).data[0].description, notes + '\nEdited');
  record('Products: UI create/edit/reload preserves literal Unicode through the real proxy/API/database');

  const workflow = (await call('/automation/workflows', 'POST', { name: 'Input workflow', trigger: 'deal.created', actions: [], isActive: false })).data;
  await page.goto(base + `/automation/workflows/${workflow.id}/edit`);
  await page.getByRole('button', { name: 'Workflow details', exact: true }).click();
  const workflowName = page.getByPlaceholder('Enter workflow name...'), workflowDescription = page.getByPlaceholder('Describe what this workflow does...');
  await workflowName.fill(text); await workflowDescription.fill(notes);
  await verifyPastedLimit(workflowDescription, 'W'.repeat(1001), 'Workflow description must not exceed 1000 characters.');
  record('Workflow Description: pasting 1001 characters shows an error that clears at 1000');
  await workflowDescription.fill(notes);
  await visual('workflow-details', [workflowName, workflowDescription]);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Draft saved.', { exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Workflow details', exact: true }).click();
  assert.equal(await workflowName.inputValue(), text); assert.equal(await workflowDescription.inputValue(), notes);
  record('Workflow Details: save/reload preserves Unicode, punctuation and multiline text');

  const task = (await call('/operations/tasks', 'POST', { title: 'Input acceptance Task', description: notes, assignedUserId: staff.id, dealIds: [deal.id], dueDate: '2027-01-01T00:00:00Z' })).data;
  await page.goto(base + '/operations/taskboard');
  await page.getByText('Input acceptance Task', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit Notes', exact: true }).click();
  await page.getByPlaceholder('Add task notes...').fill('  ' + notes + '\nEdited  ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await call('/operations/tasks/' + task.id)).data.description, '  ' + notes + '\nEdited  ');
  await page.reload(); await page.getByText('Input acceptance Task', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit Notes', exact: true }).click();
  assert.equal(await page.getByPlaceholder('Add task notes...').inputValue(), '  ' + notes + '\nEdited  ');
  record('Tasks: inline edit/reload preserves exact Unicode note whitespace');

  await page.goto(base + '/marketing/campaigns');
  await page.getByRole('button', { name: 'Create Campaign', exact: true }).first().click();
  await page.getByRole('button', { name: 'SMS', exact: true }).click();
  await page.getByRole('button', { name: 'Create New', exact: true }).click();
  await page.getByPlaceholder('Enter audience name...').fill(text);
  await page.getByRole('button', { name: 'Create Audience', exact: true }).last().click();
  await page.getByRole('button', { name: 'Edit saved audience', exact: true }).click();
  assert.equal(await page.getByPlaceholder('Enter audience name...').inputValue(), text);
  await page.getByPlaceholder('Enter audience name...').fill(text + ' edited');
  await page.getByRole('button', { name: 'Save Audience', exact: true }).click();
  await page.getByPlaceholder('Enter audience name...').waitFor({ state: 'hidden' });
  await page.getByLabel('Campaign Name').fill(text);
  await page.locator('#builder-body').fill(notes);
  assert.equal(await page.getByLabel('Campaign Name').inputValue(), text);
  assert.ok((await page.locator('#builder-body').inputValue()).includes(notes));
  const campaignSaved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/marketing/campaigns'));
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  assert.equal((await campaignSaved).status(), 201);
  const campaigns = (await call('/marketing/campaigns')).data;
  assert.ok(campaigns.some(campaign => campaign.name === text && campaign.body.includes(notes)));
  assert.ok((await call('/marketing/audiences')).data.some(audience => audience.name === text + ' edited'));
  record('Campaigns and Target Audiences: UI fields preserve Unicode through create/edit/save');

  assert.equal(await page.locator('tag').count(), 0);
  assert.deepEqual(pageErrors, []);
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, encoding, pageErrors }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ status: 'FAIL', checks, pageErrors, error: error.stack || String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (frontend && frontend.exitCode === null) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(frontend.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* The owned server may already have exited. */ } }
    else frontend.kill('SIGTERM');
  }
  if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma?.$disconnect(); await socket?.stop(); await db?.close();
}

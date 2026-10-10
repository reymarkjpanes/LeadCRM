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
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'data/outputs/custom-fields-browser');
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = 'http://localhost:3016';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_custom_fields_browser?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const { salesPipeline, salesTransaction } = require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
const { saveField } = require('../dist/backend/src/modules/crm/closing-requirements/closing-requirements.service.js');
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
let api, frontend, browser, page;
const checks = [], pageErrors = [];
try {
  const tenant = await prisma.tenant.create({ data: { name: 'Custom Field Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Custom', lastName: 'Tester', email: 'custom-preview@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin);
  await prisma.productInterest.create({ data: { tenantId: tenant.id, name: 'CCTV Acceptance', dealValue: 25000 } });
  const scope = run => tenantContext.run({ tenantId: tenant.id }, run);
  await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  const fields = {};
  for (const module of ['leads', 'contacts', 'accounts', 'deals']) {
    fields[module] = await scope(() => saveField(tenant.id, admin.id, { module, group: module === 'accounts' ? 'Basic Information' : module === 'deals' ? 'Additional Details' : 'Additional Information', name: 'Project Budget', type: 'Number', required: true }));
    await scope(() => saveField(tenant.id, admin.id, { module, group: 'Technical Requirements', name: 'Installation Notes', type: 'Long Text', required: false }));
  }
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3016', '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: `http://127.0.0.1:${api.address().port}/api/v1` } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => pageErrors.push(error.message));
  const navigate = path => page.goto(base + path);
  async function responsive(label) {
    for (const width of [1440, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      // Account sheets use a CSS transition; let it and drawer springs settle.
      await page.waitForTimeout(500);
      const customNotes = page.locator('textarea[name^="customFieldValues."]').first();
      if (await customNotes.isVisible()) await customNotes.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('#sliding-drawer-container')].every(el => el.getBoundingClientRect().right <= innerWidth + 1));
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('input,textarea,select,form')].filter(el => el.getClientRects().length && (el.getBoundingClientRect().left < -1 || el.getBoundingClientRect().right > innerWidth + 1)).map(el => ({ tag: el.tagName, name: el.getAttribute('name'), width: el.getBoundingClientRect().width })) }));
      assert.ok(dimensions.scroll <= width + 1 && !dimensions.overflowing.length, `${label}: ${JSON.stringify(dimensions)}`);
      checks.push({ label, ...dimensions });
      await page.screenshot({ path: resolve(output, `${label}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await navigate('/settings?tab=custom-fields'); await page.getByRole('button', { name: 'Add New Field', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Project Budget', exact: true }).first().waitFor();
  await responsive('settings');
  await page.getByRole('button', { name: 'Add New Field', exact: true }).click();
  await page.getByLabel('Field Name', { exact: false }).fill('Preferred Installation Date');
  await page.getByLabel('Field Type', { exact: false }).selectOption('Date');
  await page.getByLabel('Group / Section', { exact: false }).fill('Additional Information');
  await responsive('new-field');
  const definitionResponse = page.waitForResponse(r => r.url().endsWith('/administration/closing-requirements') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Field', exact: true }).click(); assert.equal((await definitionResponse).status(), 200);
  await page.getByRole('button', { name: 'Manage Preferred Installation Date', exact: true }).click();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).waitFor(); await responsive('edit-field');
  await page.getByLabel('Description / Help Text', { exact: true }).fill('Preferred date for scheduling the installation.');
  const definitionUpdate = page.waitForResponse(r => r.url().includes('/administration/closing-requirements/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click(); assert.equal((await definitionUpdate).status(), 200);

  const records = {};
  for (const [module, create] of [['leads', 'Create Lead'], ['contacts', 'Create Contact'], ['accounts', 'Add Account'], ['deals', 'New Deal']]) {
    await navigate(`/crm/${module}`);
    await page.getByRole('button', { name: new RegExp(`^${create}$`) }).click();
    if (await page.getByText('Create New', { exact: true }).isVisible()) await page.getByText('Create New', { exact: true }).click();
    await page.getByLabel('Project Budget', { exact: false }).waitFor();
    await page.getByLabel('Installation Notes', { exact: false }).fill('Keep the configured custom group and record values.');
    await responsive(`${module}-create`);
    if (module === 'accounts') await page.getByLabel('Account Name', { exact: false }).fill('Custom Acceptance Account');
    else if (module === 'deals') {
      await page.getByLabel('Title', { exact: false }).fill('Custom Acceptance Deal');
      await page.getByRole('button', { name: 'Product Interest', exact: true }).click();
      await page.getByRole('checkbox', { name: 'CCTV Acceptance', exact: true }).check(); await page.getByRole('button', { name: 'Product Interest', exact: true }).click();
    } else {
      await page.getByLabel('First Name', { exact: false }).fill('Acceptance'); await page.getByLabel('Last Name', { exact: false }).fill(module);
      await page.getByLabel('Email', { exact: false }).fill(`${module}@example.test`);
    }
    const submit = page.locator('form button[type="submit"]');
    await submit.click(); await page.getByRole('alert').filter({ hasText: 'Project Budget is required' }).waitFor();
    await page.getByLabel('Project Budget', { exact: false }).fill('25000');
    const result = page.waitForResponse(r => r.url().includes(`/crm/${module}`) && r.request().method() === 'POST' && (r.url().endsWith(`/crm/${module}`) || r.url().endsWith('/deals/batch')));
    await submit.click(); const response = await result, body = await response.json(); assert.equal(response.status(), 201, JSON.stringify(body));
    records[module] = module === 'deals' ? body.data.deals[0].id : body.data.id;
    assert.equal((await prisma.customFieldValue.findFirstOrThrow({ where: { tenantId: tenant.id, fieldId: fields[module].id, [module === 'accounts' ? 'accountId' : module === 'contacts' ? 'contactId' : module === 'leads' ? 'leadId' : 'dealId']: records[module] } })).value, 25000);
    await navigate(`/crm/${module}`);
    if (module === 'deals') {
      await page.getByText('Custom Acceptance Deal', { exact: true }).first().click();
      await page.getByRole('button', { name: 'Record actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Edit deal', exact: true }).click();
      await page.getByRole('button', { name: 'Edit custom fields', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Row actions', exact: true }).first().click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    }
    await page.getByLabel('Project Budget', { exact: false }).waitFor();
    assert.equal(await page.getByLabel('Project Budget', { exact: false }).inputValue(), '25000');
    await responsive(`${module}-edit`);
    await page.getByLabel('Project Budget', { exact: false }).fill('30000');
    const updated = page.waitForResponse(r => r.url().endsWith(`/crm/${module}/${records[module]}`) && r.request().method() === 'PUT');
    await page.locator('form button[type="submit"]').click(); assert.equal((await updated).status(), 200);
    assert.equal((await prisma.customFieldValue.findFirstOrThrow({ where: { tenantId: tenant.id, fieldId: fields[module].id, [module === 'accounts' ? 'accountId' : module === 'contacts' ? 'contactId' : module === 'leads' ? 'leadId' : 'dealId']: records[module] } })).value, 30000);
    checks.push({ label: `${module}-create-edit-persistence`, passed: true });
  }
  for (const visible of [false, true]) {
    await navigate('/settings?tab=custom-fields');
    await page.getByLabel('Filter by module', { exact: true }).selectOption('leads');
    await page.getByRole('button', { name: 'Project Budget actions', exact: true }).click();
    const visibilityUpdate = page.waitForResponse(r => r.url().endsWith(`/closing-requirements/${fields.leads.id}`) && r.request().method() === 'PATCH');
    await page.getByRole('menuitem', { name: visible ? 'Show in Form' : 'Hide in Form', exact: true }).click();
    assert.equal((await visibilityUpdate).status(), 200);
    await navigate('/crm/leads');
    await page.getByRole('button', { name: 'Row actions', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Installation Notes', { exact: false }).waitFor();
    const budget = page.getByLabel('Project Budget', { exact: false });
    if (visible) { await budget.waitFor(); assert.equal(await budget.inputValue(), '30000'); }
    else assert.equal(await budget.count(), 0);
    assert.equal((await prisma.customFieldValue.findFirstOrThrow({ where: { tenantId: tenant.id, fieldId: fields.leads.id, leadId: records.leads } })).value, 30000);
    checks.push({ label: `lead-${visible ? 'show' : 'hide'}-retains-value`, passed: true });
  }
  assert.deepEqual(pageErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors }, null, 2));
  console.log(`Browser acceptance passed: ${checks.length} responsive/persistence checks.`);
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close(); frontend?.kill(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

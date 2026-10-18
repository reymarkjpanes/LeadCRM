import { acceptancePort, responsiveMatrix, createAcceptanceContext } from './verify-browser-matrix.mjs';
// Real UI/API acceptance in a disposable database; no production data or email sends.
// Pass an installed Playwright module path as the first argument.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';

const root = resolve(import.meta.dirname, '../..'), output = process.env.LEADCRM_BROWSER_OUTPUT || (resolve(root, 'data/outputs/product-share-browser'));
mkdirSync(output, { recursive: true });
const db = await PGlite.create(); await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 }); await socket.start();
const base = `http://localhost:${await acceptancePort()}`;
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_product_share_browser?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const { salesPipeline, salesTransaction } = require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
const forms = require('../dist/backend/src/modules/marketing/forms/forms.service.js');
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
let api, frontend, browser, page, closing = false, delayPath = '', delayMs = 0;
const checks = [], pageErrors = [], requests = [], transportErrors = [];
const record = label => { checks.push(label); console.log('PASS', label); };
try {
  const tenant = await prisma.tenant.create({ data: { name: 'Product Share Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Julie Ann', lastName: 'Tester', email: 'product-share@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const { token } = await issueAuthSession(admin);
  const scope = run => tenantContext.run({ tenantId: tenant.id }, run);
  const products = [];
  for (const [name, dealValue] of [['Electric Fence', 12000], ['Laptop/Server/Data Cabinets', 45000], ['Archived Product', 8000]]) products.push(await prisma.productInterest.create({ data: { tenantId: tenant.id, name, dealValue, active: name !== 'Archived Product' } }));
  const cctv = await prisma.productInterest.create({ data: { tenantId: tenant.id, name: 'CCTV Surveillance System', dealValue: 5000 } });
  const { pipeline, initial } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  const won = await prisma.stage.findFirstOrThrow({ where: { pipelineId: pipeline.id, isWon: true } });
  const account = await prisma.account.create({ data: { tenantId: tenant.id, name: 'Customer Company' } });
  const lead = await prisma.lead.create({ data: { tenantId: tenant.id, firstName: 'Lead', lastName: 'Customer', email: 'lead@example.test' } });
  const contact = await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'Contact', lastName: 'Customer', email: 'contact+sales@example.test', companyName: account.name } });
  const cctvDeal = await prisma.deal.create({ data: { tenantId: tenant.id, title: 'Historical CCTV price', pipelineId: pipeline.id, stageId: won.id, productInterestId: cctv.id, productsNormalized: true, value: 3210.75, currency: 'PHP', accountId: account.id, assignedUserId: admin.id, leadDeals: { create: { leadId: lead.id, position: 0 } }, contactDeals: { create: { contactId: contact.id, position: 0 } } } });
  for (let index = 0; index < 26; index++) await prisma.deal.create({ data: { tenantId: tenant.id, title: `Historical Laptop Deal ${index + 1}`, pipelineId: pipeline.id, stageId: won.id, productInterestId: products[1].id, productsNormalized: true, value: 41000.75, currency: 'PHP', accountId: account.id, assignedUserId: admin.id, closedAt: new Date('2026-10-06T10:00:00Z'), contactDeals: { create: { contactId: contact.id, position: 0 } } } });
  const deals = [];
  for (const [index, product] of products.slice(0, 2).entries()) deals.push(await prisma.deal.create({ data: { tenantId: tenant.id, title: `Email Acceptance ${index + 1}`, pipelineId: pipeline.id, stageId: initial.id, assignedUserId: admin.id, productInterestId: product.id, productsNormalized: true, value: product.dealValue.toNumber(), leadDeals: { create: { leadId: lead.id, position: 0 } }, ...(index === 0 ? { contactDeals: { create: { contactId: contact.id, position: 0 } } } : {}) } }));
  const form = await scope(async () => forms.publishForm((await forms.createForm(tenant.id, admin.id, { name: 'Share Acceptance' })).id, tenant.id, admin.id));
  const submittedValues = { firstName: 'Actual Visitor', lastName: 'Customer', email: 'visitor@example.test', productInterest: [products[0].id, products[2].id], address: 'Long historical value '.repeat(15) };
  await prisma.formSubmission.create({ data: { tenantId: tenant.id, formId: form.id, publishedVersion: form.publishedVersion, publishedConfig: { name: form.name, fields: form.fields, design: form.design }, leadId: lead.id, values: submittedValues } });
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', new URL(base).port, '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-build.example/api/v1' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await createAcceptanceContext(browser, { viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(120000); page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/proxy/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/events') || url.pathname.endsWith('/record-events')) return route.continue({ url: `http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`, headers: { ...request.headers(), authorization: `Bearer ${token}` } });
    requests.push({ path: url.pathname + url.search, method: request.method() });
    try {
      if (delayPath && url.pathname.endsWith(delayPath)) await new Promise(done => setTimeout(done, delayMs));
      const response = await page.request.fetch(`http://127.0.0.1:${api.address().port}/api/v1${url.pathname.replace('/api/proxy', '')}${url.search}`, { method: request.method(), headers: { ...request.headers(), authorization: `Bearer ${token}` }, data: request.postDataBuffer() ?? undefined });
      await route.fulfill({ response });
    } catch (error) { if (!closing) transportErrors.push(String(error).split('\n')[0]); await route.abort().catch(() => {}); }
  });
  const navigate = path => page.goto(base + path);
  async function responsive(label, locator, refreshLabel) {
    for await (const { theme, width } of responsiveMatrix(page)) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(250);
      const dimensions = await locator.evaluate(element => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, overflow: element.scrollWidth > element.clientWidth + 1, font: getComputedStyle(element).fontFamily }));
      assert.equal(dimensions.pageOverflow, false, JSON.stringify({ width, ...dimensions }));
      assert.equal(dimensions.overflow, false, JSON.stringify({ width, ...dimensions }));
      const refresh = locator.getByRole('button', { name: refreshLabel }); await refresh.scrollIntoViewIfNeeded();
      const bounds = await refresh.boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      if (label === 'product') {
        assert.equal(await locator.locator('table').count(), 1);
        const grid = locator.getByRole('region', { name: 'Closed Won table' });
        const tableAccess = await grid.locator('table').evaluate(table => {
          const container = table.parentElement;
          const scrolls = container.scrollWidth > container.clientWidth + 1;
          container.scrollLeft = container.scrollWidth;
          const last = table.querySelector('thead th:last-child').getBoundingClientRect();
          const bounds = container.getBoundingClientRect();
          const result = { scrolls, overflowX: getComputedStyle(container).overflowX,
            lastColumnReachable: last.left >= bounds.left - 1 && last.right <= bounds.right + 1 };
          container.scrollLeft = 0;
          return result;
        });
        if (width >= 768) assert.equal(tableAccess.scrolls, false, `Table overflow at ${width}px`);
        if (tableAccess.scrolls) assert.ok(['auto', 'scroll'].includes(tableAccess.overflowX));
        assert.equal(tableAccess.lastColumnReachable, true, `Last column inaccessible at ${width}px`);
        await locator.getByText('Product Name', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}-top.png`) });
        await locator.getByRole('button', { name: 'Records per page' }).scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}.png`) }); record(`${label}: ${width}px, contained overflow, refresh reachable, font ${dimensions.font}`);
    }
  }

  await navigate('/settings?tab=products');
  const cctvHistory = await prisma.deal.findUniqueOrThrow({ where: { id: cctvDeal.id }, include: { leadDeals: true, contactDeals: true } });
  const dealCount = await prisma.deal.count({ where: { tenantId: tenant.id } });
  for await (const { theme, width } of responsiveMatrix(page)) {
    if (![320, 375, 768, 1440].includes(width)) continue;
    await navigate('/settings?tab=products');
    const activeRow = page.getByRole('region', { name: 'Products table' }).getByRole('row').filter({ hasText: cctv.name });
    await activeRow.waitFor();
    assert((await activeRow.innerText()).includes('₱5,000.00'));
    await activeRow.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive', exact: true }).click();
    await activeRow.waitFor({ state: 'hidden' });
    assert.equal((await prisma.productInterest.findUniqueOrThrow({ where: { id: cctv.id } })).active, false);
    await navigate('/settings?tab=archived');
    const filters = page.getByRole('group', { name: 'Archived record types' });
    await filters.waitFor();
    assert.deepEqual(await filters.getByRole('button').allTextContents(), ['All', 'Lead', 'Contact', 'Account', 'Deal', 'Product', 'User', 'Task', 'Campaign', 'Workflow']);
    const archivedRow = page.getByRole('region', { name: 'Archived data grid' }).getByRole('row').filter({ hasText: cctv.name });
    await archivedRow.waitFor();
    await filters.getByRole('button', { name: 'Product', exact: true }).click();
    await archivedRow.waitFor();
    assert((await archivedRow.innerText()).includes('₱5,000.00'));
    assert((await archivedRow.innerText()).includes('Product'));
    assert.notEqual((await archivedRow.locator('td').nth(4).innerText()).trim(), '—');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await filters.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    assert.equal(await filters.getByRole('button', { name: 'Workflow', exact: true }).evaluate(element => {
      const item = element.getBoundingClientRect(), container = element.parentElement.getBoundingClientRect();
      return item.left >= container.left - 1 && item.right <= container.right + 1;
    }), true);
    await filters.getByRole('button', { name: 'Product', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `archived-product-${theme}-${width}.png`) });
    await archivedRow.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restore', exact: true }).click();
    await archivedRow.waitFor({ state: 'hidden' });
    await navigate('/settings?tab=products');
    await activeRow.waitFor();
    assert((await activeRow.innerText()).includes('₱5,000.00'));
    assert.equal((await prisma.productInterest.findUniqueOrThrow({ where: { id: cctv.id } })).active, true);
    assert.deepEqual(await prisma.deal.findUniqueOrThrow({ where: { id: cctvDeal.id }, include: { leadDeals: true, contactDeals: true } }), cctvHistory);
    assert.equal(await prisma.deal.count({ where: { tenantId: tenant.id } }), dealCount);
    record(`CCTV archive/All/Product/restore preserves original price and Deal history: ${theme} ${width}px`);
  }
  await page.getByRole('region', { name: 'Products table' }).getByText(products[1].name, { exact: true }).click();
  const drawer = page.locator('#sliding-drawer-container');
  await drawer.getByText('26 records', { exact: true }).waitFor();
  assert.equal(await drawer.locator('tbody tr').count(), 25);
  assert.equal(await drawer.getByText('₱41,000.75', { exact: true }).count(), 0);
  assert.equal(await drawer.getByText('₱45,000.00', { exact: true }).count(), 1);
  assert.equal(await drawer.locator('table article').count(), 0);
  assert.deepEqual(await drawer.getByRole('columnheader').allTextContents(), ['Contacts', 'Won', 'Assigned Agent']);
  assert.equal(await drawer.getByText('Contact Customer', { exact: true }).count(), 25);
  assert.equal(await drawer.getByText('Customer Company', { exact: true }).count(), 25);
  record('Closed Won has exactly Contacts, Won, Assigned Agent; avatars/company retained; Product/value stay above table');
  delayPath = '/closed-won'; delayMs = 700;
  const wonRequests = () => requests.filter(row => row.path.includes('/closed-won')).length;
  const before = wonRequests(); await drawer.getByRole('button', { name: 'Refresh Closed Won' }).click();
  await drawer.getByRole('status', { name: 'Loading Closed Won' }).waitFor();
  assert(await drawer.getByRole('button', { name: 'Refresh Closed Won' }).isDisabled());
  await drawer.getByRole('button', { name: 'Refresh Closed Won' }).evaluate(button => { button.click(); button.click(); });
  await drawer.getByRole('status', { name: 'Loading Closed Won' }).waitFor({ state: 'hidden' });
  assert.equal(wonRequests() - before, 1); delayPath = ''; record('Closed Won refresh has one request, a spinner, and stable metadata');
  // The page label changes before the effect starts its request. Wait for the
  // requested server page and its rendered rows, including a delayed response.
  delayPath = '/closed-won'; delayMs = 700;
  const closedWon = drawer.getByRole('region', { name: 'Closed Won' });
  const waitForWonPage = (pageNumber, limit) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/product-interests/${products[1].id}/closed-won`)
      && url.searchParams.get('page') === String(pageNumber) && url.searchParams.get('limit') === String(limit);
  });
  const waitForWonRows = count => page.waitForFunction(expected => {
    const section = document.querySelector('#sliding-drawer-container section[aria-label="Closed Won"]');
    return section?.querySelector('[aria-busy]')?.getAttribute('aria-busy') === 'false'
      && section.querySelectorAll('tbody tr').length === expected;
  }, count);
  const [secondPage] = await Promise.all([
    waitForWonPage(2, 25),
    closedWon.getByRole('button', { name: 'Next page' }).click(),
  ]);
  assert.equal(secondPage.status(), 200);
  await closedWon.getByText('Page 2 of 2', { exact: true }).waitFor();
  await waitForWonRows(1);
  assert.equal(await closedWon.locator('tbody tr').count(), 1);
  assert.equal(await closedWon.getByRole('button', { name: 'Refresh Closed Won' }).isDisabled(), false);
  await closedWon.getByRole('button', { name: 'Records per page' }).click();
  const [smallerPage] = await Promise.all([
    waitForWonPage(1, 10),
    page.getByRole('option', { name: '10', exact: true }).click(),
  ]);
  assert.equal(smallerPage.status(), 200);
  await closedWon.getByText('Page 1 of 3', { exact: true }).waitFor();
  await waitForWonRows(10);
  assert.equal(await closedWon.locator('tbody tr').count(), 10);
  assert.equal(await closedWon.getByRole('button', { name: 'Refresh Closed Won' }).isDisabled(), false);
  delayPath = ''; record('Closed Won page and per-page controls wait for server responses and rendered rows');
  await responsive('product', drawer, 'Refresh Closed Won');
  await page.setViewportSize({ width: 1440, height: 900 }); await drawer.getByRole('button', { name: 'Close drawer' }).click();
  await page.getByRole('region', { name: 'Products table' }).getByText(products[0].name, { exact: true }).click();
  await drawer.getByText('No Closed Won records found.').waitFor(); record('Empty Closed Won table remains visible');

  await navigate('/settings?tab=forms'); await page.getByRole('button', { name: 'Edit Share Acceptance' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const history = page.getByRole('region', { name: 'Submission History' }); await history.locator('summary').waitFor();
  assert.equal(await history.locator('details').getAttribute('open'), null);
  await history.locator('summary').click(); await history.getByText('Electric Fence\nArchived Product', { exact: true }).waitFor();
  assert(!(await history.innerText()).includes(products[0].id)); record('Submission list starts collapsed and resolves active and archived Product UUIDs');
  delayPath = '/submissions'; delayMs = 700;
  const submissionRequests = () => requests.filter(row => row.path.includes('/submissions')).length;
  const prior = submissionRequests(); await history.getByRole('button', { name: 'Refresh submissions' }).click();
  await history.getByRole('status', { name: 'Loading submissions' }).waitFor();
  assert(await history.getByRole('button', { name: 'Refresh submissions' }).isDisabled());
  await history.getByRole('button', { name: 'Refresh submissions' }).evaluate(button => { button.click(); button.click(); });
  await history.getByRole('status', { name: 'Loading submissions' }).waitFor({ state: 'hidden' });
  assert.equal(submissionRequests() - prior, 1); assert.equal(await history.locator('details[open]').count(), 1);
  delayPath = ''; record('Submission refresh is deduplicated and preserves disclosure state');
  await responsive('submissions', history, 'Refresh submissions');

  await page.setViewportSize({ width: 1440, height: 900 }); await navigate('/settings?tab=roles');
  await page.getByRole('button', { name: 'Create Custom Role' }).click();
  assert.equal(await page.locator('label[for="role-name"] span').evaluate(element => getComputedStyle(element).color), 'oklch(0.637 0.237 25.331)');
  assert.equal(await page.getByLabel('Description — Optional', { exact: true }).getAttribute('required'), null); record('Role Name required asterisk is red; Description stays optional');

  for (const [index, product] of products.slice(0, 2).entries()) {
    await navigate('/crm/pipeline'); await page.getByText(deals[index].title, { exact: true }).first().click();
    const email = index === 0 ? contact.email : lead.email;
    const activities = await prisma.activity.count({ where: { tenantId: tenant.id } });
    const mutations = requests.filter(row => row.method !== 'GET').length;
    await page.getByRole('button', { name: `Compose email to ${email}` }).click();
    await page.getByLabel('To', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('To', { exact: true }).inputValue(), email);
    assert.equal(await page.getByPlaceholder('Subject', { exact: true }).inputValue(), `${product.name} Inquiry`);
    assert.equal(await page.locator('[contenteditable="true"]').innerText(), '');
    await page.getByPlaceholder('Subject', { exact: true }).fill('Reviewed inquiry');
    await page.locator('[contenteditable="true"]').fill('Editable message');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(requests.filter(row => row.method !== 'GET').length, mutations);
    assert.equal(await prisma.activity.count({ where: { tenantId: tenant.id } }), activities);
    await page.screenshot({ path: resolve(output, `compose-${index + 1}.png`) });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // Topbar and Inbox independently read status after reload. Neither request
    // may fail or outlive this disposable database, even if the heading is ready.
    const mailboxRequests = new Set(), mailboxStatuses = [];
    const collectMailboxRequest = request => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/proxy/integrations/gmail/status') mailboxRequests.add(request);
    };
    page.on('request', collectMailboxRequest);
    try {
      await Promise.all([
        page.waitForResponse(response => {
          if (!mailboxRequests.has(response.request())) return false;
          mailboxStatuses.push(response); return mailboxStatuses.length === 2;
        }),
        page.reload(),
      ]);
    } finally { page.off('request', collectMailboxRequest); }
    for (const mailboxStatus of mailboxStatuses) {
      assert.equal(mailboxStatus.status(), 200);
      assert.deepEqual(await mailboxStatus.json(), { isConnected: false, email: null, connectedAt: null, lastSyncAt: null });
    }
    await page.getByRole('heading', { name: 'Inbox', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Connect work email', exact: true }).waitFor();
    assert.equal(await page.getByRole('main').getByRole('alert').count(), 0);
    assert.equal(await page.getByLabel('To', { exact: true }).count(), 0);
    record(`${product.name}: ${index === 0 ? 'Contact precedence' : 'Lead fallback'}, editable Inbox prefill, no send/activity, query consumed`);
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(transportErrors, []);
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors }, null, 2));
  console.log(`Browser acceptance passed: ${checks.length} checks.`);
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); writeFileSync(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors, transportErrors, error: error instanceof Error ? error.stack || error.message : String(error) }, null, 2));
  throw error;
} finally {
  closing = true; await browser?.close(); frontend?.kill(); if (api) { api.closeAllConnections(); await new Promise(done => api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await db.close();
}

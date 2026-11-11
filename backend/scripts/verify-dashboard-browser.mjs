import { acceptancePort, createAcceptanceContext, setAcceptanceTheme } from './verify-browser-matrix.mjs';
// Real cookies, Next proxy (including streamed SSE), Express and disposable SQL.
// Requires backend and frontend production builds; pass an installed Playwright package as argv[2].
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const uiPolish = process.argv.includes('--ui-polish');
const sourceOnly = process.argv.includes('--sources-only');
const metricsOnly = process.argv.includes('--metrics-only') || sourceOnly;
const revenueSync = process.argv.includes('--revenue-sync');
const root = resolve(import.meta.dirname, '../..'), output = process.env.LEADCRM_BROWSER_OUTPUT || (resolve(process.env.DASHBOARD_VERIFICATION_OUTPUT || (uiPolish ? process.env.UI_POLISH_OUTPUT || resolve(tmpdir(), 'leadcrm-dashboard-leads-ui') : resolve(root, 'data/outputs/dashboard-verification'))));
const clockOnly = process.argv.includes('--clock-only');
const staleDealsOnly = process.argv.includes('--stale-deals');
mkdirSync(output, { recursive: true });
const pg = await PGlite.create(); await replayCrmMigrations(pg);
const socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
const base = `https://localhost:${await acceptancePort()}`, internalBase = `http://127.0.0.1:${await acceptancePort()}`;
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/dashboard_acceptance?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const playwrightModule = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || playwrightModule || 'playwright');
const { dashboardPeriod, dashboardToday } = require('../dist/shared/src/index.js');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const { salesPipeline, salesTransaction } = require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
let api, frontend, browser, page, gateway;
const checks = [], pageErrors = [], consoleMessages = [], latencies = [], queryTimes = [];
const record = (label, details = {}) => { checks.push({ label, ...details }); console.log('PASS', label); };
const wait = ms => new Promise(done => setTimeout(done, ms));
async function until(predicate, label, timeout = 25000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { if (await predicate()) return; await wait(150); }
  throw new Error(`Timed out: ${label}`);
}
try {
  // Exercise the optimized proxy's real HTTPS-origin guard through local TLS.
  // This disposable certificate never leaves the ignored acceptance directory.
  const cert = resolve(output,'localhost-cert.pem'), key = resolve(output,'localhost-key.pem');
  const openssl = process.env.OPENSSL_BINARY || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const certificate = spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true,stdio:'ignore'});
  assert.equal(certificate.status,0,'Local HTTPS certificate generation requires OpenSSL.');
  const tenant = await prisma.tenant.create({ data: { name: 'Dashboard Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Dashboard', lastName: 'Admin', email: 'dashboard@camxian.com', role: 'Client Admin', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  const role = await prisma.roleDefinition.create({ data: { tenantId: tenant.id, name: 'Sales Agent' } });
  const grants = ['dashboard','deals','leads','contacts','accounts','tasks'].map(module => ({ module, canView: true, canViewAll: ['deals', 'leads', 'contacts', 'accounts'].includes(module), canEdit: module !== 'dashboard', canCreate: module !== 'dashboard', canDelete: false, canArchive: module !== 'dashboard', ...(module === 'tasks' ? { canComplete: true } : {}) }));
  await prisma.rolePermission.createMany({ data: grants.map(grant => ({ ...grant, tenantId: tenant.id, roleId: role.id })) });
  const agents = [];
  for (const firstName of ['First','Second']) {
    const agent = await prisma.user.create({ data: { tenantId: tenant.id, firstName, lastName: 'Agent', email: `${firstName.toLowerCase()}@camxian.com`, role: role.name, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    await prisma.userRole.create({ data: { tenantId: tenant.id, userId: agent.id, roleId: role.id } }); agents.push(agent);
  }
  const [agent, replacement] = agents;
  const scope = work => tenantContext.run({ tenantId: tenant.id }, work);
  const { pipeline } = await scope(() => salesTransaction(tx => salesPipeline(tx, tenant.id)));
  let stages = await prisma.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: 'asc' } });
  for (const [i, stage] of stages.entries()) await prisma.stage.update({ where: { id: stage.id }, data: { probability: [10,40,70,100,0][i], color: ['#3B82F6','#F59E0B','#8B5CF6','#059669','#DC2626'][i] } });
  stages = await prisma.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: 'asc' } });
  await prisma.closingFieldDefinition.create({ data: { id: 'acceptance-note', tenantId: tenant.id, definition: { id: 'acceptance-note', name: 'Optional note', module: 'deals', group: 'Closed Won Requirements', type: 'Text', required: false, active: true, order: 0, options: [] } } });
  const products = [];
  for (const [name, dealValue] of [['Basic',1000],['Plus',1800]]) products.push(await prisma.productInterest.create({ data: { tenantId: tenant.id, name, dealValue } }));
  const adminToken = (await issueAuthSession(admin)).token, agentToken = (await issueAuthSession(agent)).token, replacementToken = (await issueAuthSession(replacement)).token;
  api = app.listen(0, '127.0.0.1'); await new Promise(done => api.once('listening', done));
  const port = api.address().port;
  const fixtureContacts = new Map();
  async function http(path, method = 'GET', body, token = adminToken) {
    if (method === 'POST' && path === '/crm/deals' && !body.leadIds?.length && !body.contactIds?.length) {
      const owner = body.assignedUserId ?? agent.id;
      if (!fixtureContacts.has(owner)) fixtureContacts.set(owner, (await prisma.contact.create({ data: { tenantId: tenant.id, firstName: 'Dashboard', lastName: 'Buyer', email: `${owner}@example.test`, assignedUserId: owner } })).id);
      body = { ...body, contactIds: [fixtureContacts.get(owner)] };
    }
    if (method === 'POST' && path === '/operations/tasks') body = { requestId: randomUUID(), ...body };
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection:'close' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`); return result.data;
  }
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', new URL(internalBase).port, '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, NODE_ENV: 'development', LEADCRM_QA_BUILD_ASSETS: '1', API_URL: `http://127.0.0.1:${port}/api/v1`, NEXT_PUBLIC_USE_MOCK_AUTH: 'false', NEXT_PUBLIC_USE_MOCK_DATA: 'false' } });
  frontend.stdout.pipe(log); frontend.stderr.pipe(log);
  await until(async () => { try { return (await fetch(internalBase + '/login')).ok; } catch { return false; } }, 'Next ready', 90000);
  gateway = createHttpsServer({key:readFileSync(key),cert:readFileSync(cert)},(request,response)=>{
    const upstream=httpRequest(internalBase+request.url,{method:request.method,headers:{...request.headers,'x-forwarded-proto':'https'}},incoming=>{
      incoming.on('aborted',()=>response.destroy()); incoming.on('error',()=>response.destroy());
      response.writeHead(incoming.statusCode,incoming.headers); incoming.pipe(response);
    });
    upstream.on('error',()=>{if(!response.headersSent) response.writeHead(502); response.end();});
    response.on('close',()=>upstream.destroy()); request.pipe(upstream);
  });
  gateway.listen(Number(new URL(base).port)); await new Promise(done=>gateway.once('listening',done));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-extensions'] });
  async function session(token) {
    const context = await createAcceptanceContext(browser, { ignoreHTTPSErrors:true, hasTouch:uiPolish, viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      const Native = window.EventSource; window.__dashboardEvents = [];
      window.EventSource = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('dashboard-change', () => window.__dashboardEvents.push(Date.now())); }
      };
    });
    if (uiPolish || metricsOnly) await context.addInitScript(() => {
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      const text = CanvasRenderingContext2D.prototype.fillText;
      const arc = CanvasRenderingContext2D.prototype.arc;
      const curve = CanvasRenderingContext2D.prototype.bezierCurveTo;
      CanvasRenderingContext2D.prototype.clearRect = function(...args) { this.canvas.__labels = []; this.canvas.__texts = []; this.canvas.__points = []; this.canvas.__curves = []; return clear.apply(this, args); };
      CanvasRenderingContext2D.prototype.fillText = function(...args) {
        const label = String(args[0]), transform = this.getTransform(), point = transform.transformPoint({ x: args[1], y: args[2] });
        const width = this.measureText(label).width * Math.hypot(transform.a, transform.b) / devicePixelRatio;
        const x = point.x / devicePixelRatio, left = x - (this.textAlign === 'center' ? width / 2 : ['right', 'end'].includes(this.textAlign) ? width : 0);
        (this.canvas.__labels ??= []).push(label);
        (this.canvas.__texts ??= []).push({ text: label, x, y: point.y / devicePixelRatio, left, right: left + width, width, align: this.textAlign, color: this.fillStyle });
        return text.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.arc = function(...args) { (this.canvas.__points ??= []).push({ x: args[0], y: args[1], radius: args[2] }); return arc.apply(this, args); };
      CanvasRenderingContext2D.prototype.bezierCurveTo = function(...args) { (this.canvas.__curves ??= []).push({ x: args[4], y: args[5] }); return curve.apply(this, args); };
    });
    await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const tab = await context.newPage(); tab.setDefaultTimeout(25000); tab.on('pageerror', error => pageErrors.push(error.message));
    tab.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text(), ...message.location() }); });
    await tab.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' }); await tab.getByRole('heading', { name: 'Revenue Trend', exact: true }).waitFor();
    await until(async () => (await tab.evaluate(() => window.__dashboardEvents.length)) > 0,'Dashboard subscription established'); return { context, tab };
  }
  const adminSession = await session(adminToken); page = adminSession.tab;
  const staffSession = await session(agentToken);
  const value = async (tab, label) => {
    const names = { 'Total Revenue': 'Revenue', 'Forecasted Revenue': 'Forecast', 'Active Deals': 'Open Deals', 'Total Leads': 'Leads' };
    const reporting = new URL(tab.url()).pathname === '/reporting';
    const group = tab.getByRole('group', { name: reporting ? label : names[label] ?? label, exact: true });
    return reporting ? group.locator('.text-base').innerText() : group.locator('[data-metric-value]').evaluate(node => node.querySelector('[aria-label]')?.getAttribute('aria-label') ?? node.textContent);
  };
  const stageCount = async (tab, name) => tab.getByRole('meter', { name: `${name} deal count relative to largest stage`, exact: true }).getAttribute('aria-valuenow');
  async function expectValue(label, expected, both = true) {
    await until(async () => (await value(page, label)) === expected && (!both || (await value(staffSession.tab, label)) === expected), `${label}=${expected}`);
  }
  async function mutation(label, work, assertUI) {
    const wallStart = Date.now(), started = performance.now(); const result = await work(); const committed = performance.now(); await assertUI(result);
    const displayed = Date.now();
    const eventAt = await page.evaluate(start => window.__dashboardEvents.filter(time => time >= start).at(-1),wallStart);
    const displayMs = Math.round(performance.now() - committed); latencies.push({ label, responseToDisplayMs: displayMs, requestToDisplayMs: Math.round(performance.now() - started), eventReceiptToVerifiedDisplayMs:eventAt ? displayed-eventAt : null }); record(label, { displayMs }); return result;
  }
  await expectValue('Active Deals', '0'); await expectValue('Win Rate', '0%'); await page.screenshot({path:resolve(output,'empty-zero-revenue.png'),fullPage:true}); record('Authenticated empty state through actual Next proxy and two SSE sessions');
  const clock = page.getByLabel('Current date and time',{exact:true});
  await clock.waitFor();
  const firstTick = await clock.getAttribute('datetime');
  await until(async()=>await clock.getAttribute('datetime')!==firstTick,'Live clock advances');
  const clockSnapshot = await clock.evaluate(element=>({dateTime:element.getAttribute('datetime'),text:element.innerText,bold:element.querySelector('strong').innerText}));
  const clockStamp = new Date(clockSnapshot.dateTime);
  const expectedDate = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(clockStamp);
  const expectedTime = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(clockStamp);
  assert.equal(clockSnapshot.text,`${expectedDate}, ${expectedTime}`);
  assert.equal(clockSnapshot.bold,expectedTime);
  assert.ok(Date.now()-clockStamp.getTime()<2500);
  assert.equal(await page.getByText(/Revenue, outcomes and velocity use this period/).count(),0);
  assert.equal(await page.getByText(/eligible deals\. Counts are distinct recorded milestones/).count(),0);
  record('Live Manila clock advances with bold 24-hour time and requested notes removed');
  if (staleDealsOnly) {
    await page.bringToFront();
    await prisma.rolePermission.updateMany({ where: { tenantId: tenant.id, roleId: role.id, module: 'deals' }, data: { canViewAll: false, canViewMy: true } });
    await http(`/crm/stages/${stages[0].id}`, 'PUT', { rottenAfterDays: 1 });
    const title = 'Deal crosses its inactivity threshold';
    const region = tab => tab.getByRole('region', { name: 'Action Center', exact: true });
    const item = (tab, name) => region(tab).getByRole('link').filter({ hasText: name });
    const watch = (tab) => {
      const snapshots = [];
      tab.on('response', async response => {
        if (response.ok() && new URL(response.url()).pathname === '/api/proxy/reporting/dashboard') {
          const body = await response.json().catch(() => null);
          if (body?.data) snapshots.push({ ...body.data, cacheControl: response.headers()['cache-control'] });
        }
      });
      return snapshots;
    };
    const snapshots = watch(page), staffSnapshots = watch(staffSession.tab);
    const boundary = Date.now() + 18000;
    const fixture = (title, entered) => prisma.deal.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id,
      stageId: stages[0].id, title, assignedUserId: replacement.id, ownerId: replacement.id,
      createdAt: new Date(entered), stageChangedAt: new Date(entered) } });
    const crossing = await fixture(title, boundary - 86400000);
    const staleEdit = await fixture('Deal needs a real edit', Date.now() - 2 * 86400000);
    const has = (snapshot, id) => snapshot?.actions.some(action => action.kind === 'deal' && action.id === id);
    const assertActionParity = async (tab, snapshot) => {
      const staleActions = snapshot.actions.filter(action => action.kind === 'deal');
      const links = await region(tab).locator('a[href^="/crm/deals/"]').evaluateAll(items => items.map(link => link.getAttribute('href')));
      assert.deepEqual(links.sort(), staleActions.map(action => action.href).sort());
      const count = staleActions.length;
      assert.match(await region(tab).innerText(), new RegExp(`\\b${count} stale deal${count === 1 ? '' : 's'}\\b`));
      assert.equal(snapshot.pendingActions, snapshot.actions.length);
      assert.equal(snapshot.cacheControl, 'no-store');
    };
    snapshots.length = 0;
    await page.reload();
    await item(page, staleEdit.title).waitFor();
    await until(() => +new Date(snapshots.at(-1)?.generatedAt) < boundary && has(snapshots.at(-1), staleEdit.id) && !has(snapshots.at(-1), crossing.id), 'pre-existing stale Deal on a fresh Dashboard load');
    await assertActionParity(page, snapshots.at(-1));
    assert.equal(await item(page, title).count(), 0);
    record('Fresh Dashboard load shows the existing qualifying Deal and matches the uncached API');
    await until(async () => (await item(page, title).count()) === 1 && has(snapshots.at(-1), crossing.id), 'clock-only staleness through existing foreground reconciliation', 46000);
    assert.equal(snapshots.at(-1).actions.filter(action => action.id === crossing.id).length, 1);
    assert.equal(await item(page, title).getAttribute('href'), `/crm/deals/${crossing.id}`);
    await assertActionParity(page, snapshots.at(-1));
    const postBoundary = snapshots.at(-1).generatedAt;
    await staffSession.tab.bringToFront();
    await until(() => staffSnapshots.some(snapshot => snapshot.generatedAt >= postBoundary && snapshot.access.deals), 'assignment-limited Dashboard response');
    assert.ok(staffSnapshots.every(snapshot => !has(snapshot, crossing.id) && !has(snapshot, staleEdit.id)));
    assert.equal(await item(staffSession.tab, title).count(), 0);
    await assertActionParity(staffSession.tab, staffSnapshots.at(-1));
    await page.bringToFront();
    await page.screenshot({path:resolve(output,'stale-deals-visible.png'),fullPage:true});
    record('Clock crossing appears once through the real proxy and is excluded from assignment-limited API and UI');
    await item(page, title).click();
    await page.waitForURL(`**/crm/deals/${crossing.id}`);
    await page.getByText(title, { exact: true }).first().waitFor();
    record('Action opens the correct Deal details');
    await page.goBack();
    await item(page, title).waitFor();
    await assertActionParity(page, snapshots.at(-1));
    await page.evaluate(() => { window.__staleDashboardInstance = true; });
    const afterNote = snapshots.length;
    await http('/crm/activities', 'POST', { dealId: crossing.id, type: 'note', title: 'Customer follow-up recorded' });
    await until(async () => snapshots.length > afterNote && !has(snapshots.at(-1), crossing.id) && (await item(page, title).count()) === 0, 'note resolves Action Center item', 10000);
    await assertActionParity(page, snapshots.at(-1));
    assert.equal(await page.evaluate(() => window.__staleDashboardInstance), true);
    record('Committed Deal note removes the item from API and UI without reloading');
    await item(page, staleEdit.title).waitFor();
    const afterEdit = snapshots.length;
    await http(`/crm/deals/${staleEdit.id}`, 'PUT', { title: 'Real update on this Deal' });
    await until(async () => snapshots.length > afterEdit && !has(snapshots.at(-1), staleEdit.id) && (await item(page, staleEdit.title).count()) === 0, 'real edit resolves Action Center item', 10000);
    await assertActionParity(page, snapshots.at(-1));
    assert.equal(await page.evaluate(() => window.__staleDashboardInstance), true);
    await page.screenshot({path:resolve(output,'stale-deals-resolved.png'),fullPage:true});
    record('Committed Deal edit removes the item from API and UI without reloading');
  } else if (clockOnly) {
    for (const width of [1440,640,639,390,320]) {
      await page.setViewportSize({width,height:1000});
      await clock.scrollIntoViewIfNeeded();
      for (const label of ['Dashboard date range', 'Sync Metrics']) {
        const control = page.getByRole('button',{name:label,exact:true});
        assert.equal(await control.locator('span').isVisible(),width>=640);
        if (width<640) {
          const bounds = await control.boundingBox(); assert.equal(bounds.width,44); assert.equal(bounds.height,44);
        }
      }
      const dimensions = await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scrollWidth<=width+1);
      await page.screenshot({path:resolve(output,`clock-${width}.png`),fullPage:true});
      await page.getByRole('heading',{name:'Lead Source Performance',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(output,`clock-${width}-funnel.png`),fullPage:true});
      record(`Clock, requested notes and responsive toolbar ${width}`,dimensions);
    }
  } else if (revenueSync) {
    const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
    const dateRange = page.getByRole('button', { name: 'Dashboard date range', exact: true });
    const dashboards = [page, staffSession.tab];
    const navigationStarts = await Promise.all(dashboards.map(tab => tab.evaluate(() => performance.timeOrigin)));
    const lastMonth = dashboardPeriod({ range: 'lastMonth' });
    const historicalRows = await Promise.all([1250.5, 2000, 9000].map((amount, index) => prisma.deal.create({ data: {
      tenantId: tenant.id, pipelineId: pipeline.id, stageId: stages[index === 2 ? 4 : 3].id,
      title: `Prior month fixture ${index + 1}`, value: amount, currency: 'PHP',
      ownerId: agent.id, assignedUserId: agent.id, createdAt: lastMonth.from, closedAt: new Date(+lastMonth.until - 1),
      ...(index < 2 ? { leadSource: 'Referral', revenueOwnerId: agent.id, revenueOwnerEligible: true } : {}),
    } })));
    const savedWins = await prisma.deal.findMany({
      where: { id: { in: historicalRows.map(row => row.id) }, stage: { isWon: true, isLost: false } },
      select: { value: true, closedAt: true },
    });
    assert.equal(savedWins.length, 2);
    const historicalRevenue = savedWins.reduce((sum, row) => sum + row.value, 0);
    await expectValue('Win Rate', '0%');
    await expectValue('Total Revenue', money(0));
    assert.equal(await dateRange.getAttribute('title'), 'Monthly');
    assert.equal(await page.getByRole('button', { name: /Filter Revenue Trend|Lead Source date range/ }).count(), 0);
    await page.getByText('No won revenue in the selected period.', { exact: true }).waitFor();
    await page.getByText('No won deals for this period.', { exact: true }).waitFor();
    await page.getByText('No verified eligible sales attribution in this period.', { exact: true }).waitFor();

    const reportResponse = range => page.waitForResponse(response => response.ok() &&
      new URL(response.url()).pathname === '/api/proxy/reporting/dashboard' && new URL(response.url()).searchParams.get('range') === range);
    async function selectRange(label, range) {
      const pending = reportResponse(range);
      await dateRange.click();
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      return (await (await pending).json()).data;
    }
    async function verifyHistoricalReport(report) {
      const from = new Date(`${report.period.start}T00:00:00+08:00`), until = new Date(+new Date(`${report.period.end}T00:00:00+08:00`) + 86400000);
      const rows = historicalRows.filter(row => row.closedAt >= from && row.closedAt < until);
      const wins = rows.filter(row => row.stageId === stages[3].id);
      const revenue = wins.reduce((sum, row) => sum + row.value, 0);
      const rate = wins.length === 0 ? 0 : Math.round(wins.length / rows.length * 1000) / 10;
      assert.equal(report.metrics.totalRevenue, revenue);
      assert.equal(report.trend.reduce((sum, row) => sum + row.revenue, 0), revenue);
      assert.deepEqual([report.metrics.won, report.metrics.lost], [wins.length, rows.length - wins.length]);
      assert.equal(report.leadSourcePerformance.period.start, report.period.start);
      assert.equal(report.leadSourcePerformance.period.end, report.period.end);
      await expectValue('Total Revenue', money(revenue), false);
      await expectValue('Win Rate', `${rate}%`, false);
      if (wins.length) {
        await page.getByRole('img', { name: /^Revenue Trend by/ }).waitFor();
        await page.getByText(`Referral: ${wins.length} won deals`, { exact: true }).waitFor({ state: 'attached' });
        await page.getByRole('region', { name: 'Sales Leaderboard' }).getByText(`${wins.length} deals`, { exact: true }).waitFor();
      } else await page.getByText('No won revenue in the selected period.', { exact: true }).waitFor();
    }
    await dateRange.click();
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['Weekly', 'Monthly', 'Yearly']);
    await page.keyboard.press('Escape');
    await verifyHistoricalReport(await selectRange('Yearly', 'thisYear'));
    assert.equal(await dateRange.getAttribute('title'), 'Yearly');
    record('Desktop Yearly selection reconciles stored wins, API, trend and rendered Revenue');

    await page.setViewportSize({ width: 390, height: 850 });
    assert.equal((await dateRange.boundingBox()).width, 44);
    await dateRange.click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'Yearly', exact: true }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
    await verifyHistoricalReport(await selectRange('Weekly', 'thisWeek'));
    const customReport = await http(`/reporting/dashboard?range=custom&start=${lastMonth.end}&end=${lastMonth.end}`);
    assert.deepEqual([customReport.period.start, customReport.period.end], [lastMonth.end, lastMonth.end]);
    assert.equal(customReport.metrics.totalRevenue, historicalRevenue);
    assert.deepEqual([customReport.metrics.won, customReport.metrics.lost], [2, 1]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    record('Mobile Weekly selection works; historical custom API includes wins at the last millisecond of the Manila month');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await selectRange('Monthly', 'thisMonth');
    await expectValue('Total Revenue', money(0));

    const current = await mutation('A newly created Deal updates both open Dashboards', () => http('/crm/deals', 'POST', {
      pipelineId: pipeline.id, stageId: stages[0].id, title: 'Live revenue fixture', productInterestIds: [products[0].id], assignedUserId: agent.id,
    }, agentToken), () => expectValue('Active Deals', '1'));
    const stagePath = `/crm/deals/${current.id}/stage`;
    await mutation('Qualified Deal updates Forecast while Revenue is zero', () => http(stagePath, 'PATCH', { stageId: stages[2].id }, agentToken), async () => {
      await expectValue('Forecasted Revenue', money(current.value));
      await expectValue('Total Revenue', money(0));
    });
    await mutation('A close from the Dashboard session reaches both viewers without reload', async () => {
      const response = await page.evaluate(async ({ path, stageId }) => {
        const result = await fetch(`/api/proxy${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId }) });
        return { status: result.status, body: await result.json() };
      }, { path: stagePath, stageId: stages[3].id });
      assert.equal(response.status, 200, JSON.stringify(response.body));
    }, async () => {
      const stored = await prisma.deal.findUniqueOrThrow({ where: { id: current.id }, include: { stage: true } });
      assert.ok(stored.stage.isWon && stored.closedAt);
      const report = await http('/reporting/dashboard?range=thisMonth');
      assert.equal(report.metrics.totalRevenue, stored.value);
      assert.equal(report.trend.reduce((sum, row) => sum + row.revenue, 0), stored.value);
      await expectValue('Total Revenue', money(stored.value));
      await expectValue('Forecasted Revenue', money(0));
      await expectValue('Active Deals', '0');
      await expectValue('Win Rate', '100%');
    });
    await assert.rejects(() => http(`/crm/deals/${current.id}`, 'PUT', { value: 5 }, agentToken), /historical snapshots/);
    await assert.rejects(() => http(stagePath, 'PATCH', { stageId: stages[2].id }, agentToken), /has been won/);
    await mutation('A committed fixture value correction reaches both viewers', () => prisma.deal.update({
      where: { id: current.id }, data: { value: 1750.25 },
    }), async corrected => {
      const report = await http('/reporting/dashboard?range=thisMonth');
      assert.equal(report.metrics.totalRevenue, corrected.value);
      await expectValue('Total Revenue', money(corrected.value));
    });
    const cancelled = await http('/crm/deals', 'POST', {
      pipelineId: pipeline.id, stageId: stages[0].id, title: 'Cancellation fixture', productInterestIds: [products[1].id], assignedUserId: agent.id,
    }, agentToken);
    await expectValue('Active Deals', '1');
    const cancelledPath = `/crm/deals/${cancelled.id}/stage`;
    await mutation('Cancelling a Deal removes it from Open Deals without adding Revenue', () =>
      http(cancelledPath, 'PATCH', { stageId: stages[4].id, lostReason: 'Deferred' }, agentToken), async () => {
      await expectValue('Active Deals', '0');
      await expectValue('Total Revenue', money(1750.25));
    });
    await mutation('Reopening an eligible cancelled Deal restores the Qualified Forecast', () =>
      http(cancelledPath, 'PATCH', { stageId: stages[2].id }, agentToken), async () => {
      await expectValue('Active Deals', '1');
      await expectValue('Forecasted Revenue', money(cancelled.value));
      await expectValue('Total Revenue', money(1750.25));
    });
    await mutation('Archiving the confirmed win removes its Revenue without changing Forecast', () =>
      http(`/crm/deals/${current.id}/archive`, 'PATCH', undefined, agentToken), async () => {
      await expectValue('Total Revenue', money(0));
      await expectValue('Forecasted Revenue', money(cancelled.value));
      await expectValue('Win Rate', '0%');
    });
    assert.deepEqual(await Promise.all(dashboards.map(tab => tab.evaluate(() => performance.timeOrigin))), navigationStarts);
    const overview = page.getByRole('region', { name: 'Pipeline Overview', exact: true });
    const currentPipeline = await overview.innerText();
    const yearly = await selectRange('Yearly', 'thisYear');
    const { won, lost } = yearly.metrics;
    await expectValue('Win Rate', `${won === 0 ? 0 : Math.round(won / (won + lost) * 1000) / 10}%`, false);
    assert.equal(await overview.innerText(), currentPipeline);
    await expectValue('Forecasted Revenue', money(cancelled.value));
    record('Changing the toolbar period keeps current Pipeline Overview and Forecast');

    await page.goto(base + '/reporting');
    await dateRange.click();
    await page.getByRole('menuitemradio', { name: 'Last Month', exact: true }).click();
    await expectValue('Total Revenue', money(historicalRevenue), false);
    await expectValue('Win Rate', '50%', false);
    await page.getByRole('button', { name: 'Filter Revenue Trend', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Year', exact: true }).click();
    await page.getByRole('heading', { name: 'Revenue Trend by Year', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Filter Deal Pipeline Conversion Funnel', exact: true }).count(), 1);
    const exported = page.waitForResponse(response => new URL(response.url()).pathname === '/api/proxy/reporting/dashboard/export');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const csv = await exported;
    const csvFilters = new URL(csv.url()).searchParams;
    assert.equal(csv.ok(), true);
    assert.equal(csvFilters.get('range'), 'lastMonth');
    assert.equal(csvFilters.get('revenueInterval'), 'year');
    assert.match(readFileSync(await (await downloaded).path(), 'utf8'), /"Win Rate","50","Current eligible Sales Pipeline \/ %"/);
    record('Reports retains its independent chart controls and current Win Rate in CSV');
  } else if (metricsOnly) {
    const { verifyDashboardMetrics } = await import('./verify-dashboard-metrics.mjs');
    await verifyDashboardMetrics({ page, staffPage: staffSession.tab, base, output, http, prisma, tenant, agent, replacement, pipeline, stages, products, record, until, wait, expectValue, sourceOnly });
  } else if (uiPolish) {
    const { verifyDashboardLeadsUi } = await import('./verify-dashboard-leads-ui.mjs');
    await verifyDashboardLeadsUi({ page, staffPage: staffSession.tab, base, output, http, prisma, tenant, admin, agent, replacement, pipeline, stages, products, record, until, wait, expectValue, leadsOnly: process.argv.includes('--leads-only'), dashboardOnly: process.argv.includes('--dashboard-only') });
  } else {
  const lead = await mutation('Another agent creates a lead visible to both reporting users', () => http('/crm/leads', 'POST', { firstName: 'Browser', lastName: 'Lead', email: 'browser@example.test', status: 'Inquiry', assignedUserId: replacement.id }, replacementToken), () => expectValue('Total Leads', '1'));
  const created = await mutation('Deal creation updates all current charts', () => http('/crm/deals', 'POST', { pipelineId: pipeline.id, stageId: stages[0].id, title: 'Browser Deal', productInterestIds: [products[0].id], assignedUserId: agent.id }), () => expectValue('Active Deals', '1'));
  const deal = created;
  for (const index of [1,2,0,2]) {
    await mutation(`Stage movement to ${stages[index].name}`, () => http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[index].id }), async () => {
      await expectValue('Active Deals', '1');
      await until(async () => await stageCount(page, stages[index].name) === '1', 'Pipeline moved');
    });
  }
  const legacy = await prisma.deal.create({data:{tenantId:tenant.id,pipelineId:pipeline.id,stageId:stages[0].id,title:'Legacy amount correction',value:500,assignedUserId:agent.id,ownerId:agent.id}});
  // Product pricing is an immutable snapshot in normal CRM APIs. Exercise a
  // committed database correction as an integration write, without weakening it.
  await mutation('Committed early-stage amount correction preserves Qualified-only forecast', () => prisma.deal.update({where:{id:legacy.id},data:{value:1800}}), () => expectValue('Forecasted Revenue', '₱1,000.00'));
  await http(`/crm/deals/${legacy.id}/archive`,'PATCH'); await expectValue('Active Deals','1');
  await mutation('Won closure updates revenue, trend, counts, rate and attribution', () => http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[3].id }), async () => { await expectValue('Active Deals','0'); await expectValue('Total Revenue','₱1,000.00'); await expectValue('Win Rate','100%'); await page.getByRole('region', {name:'Sales Leaderboard',exact:true}).getByText('1 deal', { exact: true }).waitFor(); });
  const closeAt = (await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt;
  await http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[3].id });
  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt.toISOString(), closeAt.toISOString());
  assert.equal(await prisma.dealStageHistory.count({ where: { dealId: deal.id, newStageId: stages[3].id } }),1); record('Repeated closure has one revenue recognition and one history milestone');
  const losing = await http('/crm/deals','POST',{ pipelineId: pipeline.id, stageId: stages[0].id, title: 'Lost and Reopened', productInterestIds:[products[0].id], assignedUserId:agent.id });
  await mutation('Lost closure and Win Rate denominator', () => http(`/crm/deals/${losing.id}/stage`,'PATCH',{ stageId:stages[4].id, lostReason:'Deferred' }), () => expectValue('Win Rate','50%'));
  await mutation('Lost reopening removes current outcome and restores pipeline', () => http(`/crm/deals/${losing.id}/stage`,'PATCH',{ stageId:stages[2].id }), async () => { await expectValue('Active Deals','1'); await expectValue('Win Rate','100%'); });
  const task = await mutation('Task creation updates Action Center', () => http('/operations/tasks','POST',{ requestId:randomUUID(), title:'Browser overdue follow-up', dueDate:new Date(Date.now()-86400000).toISOString(), priority:'High', assignedUserId:agent.id, dealIds:[deal.id] }), async () => { await page.getByText('Browser overdue follow-up',{exact:true}).waitFor(); await staffSession.tab.getByText('Browser overdue follow-up',{exact:true}).waitFor(); });
  const actionLayout = await page.getByRole('link').filter({hasText:'Browser overdue follow-up'}).evaluate(el=>({height:el.parentElement.clientHeight,itemHeight:el.getBoundingClientRect().height,overflow:getComputedStyle(el.parentElement).overflowY,clipped:el.getBoundingClientRect().bottom>el.parentElement.getBoundingClientRect().bottom+1})); assert.ok(Math.abs(actionLayout.height-actionLayout.itemHeight)<=1); assert.ok(actionLayout.itemHeight<108); assert.equal(actionLayout.overflow,'auto'); assert.equal(actionLayout.clipped,false); record('Action Center uses a compact content-based scroll viewport',actionLayout);
  await mutation('Task completion removes pending action', () => http(`/operations/tasks/${task.id}/complete`,'PATCH'), async () => until(async () => await page.getByText('Browser overdue follow-up',{exact:true}).count() === 0, 'Task disappeared'));
  const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
  const workflow = await scope(() => workflows.createWorkflow(tenant.id,admin.id,{ name:'Dashboard movement', trigger:'deal.updated', isActive:true, conditions:{operator:'AND',conditions:[{field:'deal.title',operator:'equals',value:'Workflow Ready'}]},actions:[{type:'move_deal_stage',config:{stageId:stages[1].id}}] }));
  const { dispatchQueuedWorkflows } = require('../dist/backend/src/modules/automation/workflows/workflow-queue.js');
  await mutation('Committed Workflow stage movement synchronizes', async () => {
    await http(`/crm/deals/${losing.id}`,'PUT',{title:'Workflow Ready'});
    // This API-only fixture explicitly exercises the bounded production consumer.
    await dispatchQueuedWorkflows();
  }, async () => until(async () => await stageCount(page, 'Contacted') === '1','Workflow stage visible'));
  await scope(() => workflows.toggleWorkflow(workflow.id,tenant.id,admin.id,false));
  await mutation('Archive changes eligibility', () => http(`/crm/deals/${losing.id}/archive`,'PATCH'), () => expectValue('Active Deals','0'));
  await mutation('Restore changes eligibility', () => http(`/crm/deals/${losing.id}/restore`,'PATCH'), () => expectValue('Active Deals','1'));
  await mutation('Lead reassignment preserves organization totals for both viewers', () => http(`/crm/leads/${lead.id}`,'PUT',{assignedUserId:agent.id}), () => expectValue('Total Leads','1'));
  await staffSession.context.setOffline(true);
  await mutation('Offline reconnection retrieves authoritative current state', async () => {
    await http(`/crm/deals/${losing.id}`,'PUT',{assignedUserId:replacement.id});
    await http(`/crm/deals/${losing.id}/stage`,'PATCH',{stageId:stages[2].id});
    await staffSession.context.setOffline(false);
  }, async () => until(async () => await stageCount(staffSession.tab, 'Qualified') === '1','Recovered committed stage after offline period'));
  api.closeAllConnections(); await new Promise(done => api.close(done));
  api = app.listen(port,'127.0.0.1'); await new Promise(done => api.once('listening',done));
  await wait(200);
  await mutation('Server restart preserves revisions and automatically reconnects', async () => {
    await http(`/crm/deals/${losing.id}`,'PUT',{assignedUserId:agent.id});
    await http(`/crm/deals/${losing.id}/stage`,'PATCH',{stageId:stages[1].id});
  }, async () => until(async () => await stageCount(staffSession.tab, 'Contacted') === '1','Restart recovered committed stage'));
  await mutation('Permission revocation hides sensitive Dashboard without reload', () => http(`/administration/roles/${role.id}`,'PUT',{permissions:grants.map(p => p.module === 'dashboard' ? {...p,canView:false} : p)}), async () => until(async () => await staffSession.tab.getByRole('heading',{name:'Revenue Trend',exact:true}).count() === 0,'Dashboard hidden'));
  await mutation('Permission restoration remounts Dashboard without reload', () => http(`/administration/roles/${role.id}`,'PUT',{permissions:grants}), async () => { await staffSession.tab.getByRole('heading',{name:'Revenue Trend',exact:true}).waitFor(); await until(async () => await value(staffSession.tab,'Active Deals') === '1','Grant visible'); });
  await page.goto(base+'/reporting');
  await page.getByRole('button',{name:'Dashboard date range',exact:true}).waitFor();
  for (const label of ['Today','Last 7 Days','Last 30 Days','This Month','Last Month','Last 3 Months','Last 6 Months','This Year']) {
    await page.getByRole('button',{name:'Dashboard date range',exact:true}).click(); await page.getByRole('menuitemradio',{name:label,exact:true}).click();
    await page.getByRole('heading',{name:/^Revenue Trend by /}).waitFor();
    await until(async () => !await page.getByRole('button',{name:'Syncing…',exact:true}).count(),'Date query complete');
  }
  // A live-clock suite may cross Manila midnight after creating/closing its records.
  // Select their actual calendar dates instead of assuming they all belong to today.
  const fixtureStart = dashboardToday(new Date(deal.createdAt));
  let fixtureEnd = dashboardToday();
  async function applyFixtureDates() {
    await page.getByRole('button',{name:'Dashboard date range',exact:true}).click(); await page.getByRole('menuitemradio',{name:'Custom Date Range',exact:true}).click();
    await page.getByLabel('Start date',{exact:true}).fill(fixtureStart); await page.getByLabel('End date',{exact:true}).fill(fixtureEnd); await page.getByRole('button',{name:'Apply dates',exact:true}).click();
  }
  await applyFixtureDates();
  await until(async () => await value(page,'Total Revenue') === '₱1,000.00','Custom revenue'); record('All nine date filters and current-state distinction');
  const secondWin = await http('/crm/deals','POST',{pipelineId:pipeline.id,stageId:stages[0].id,title:'Second Agent Win',productInterestIds:[products[1].id],assignedUserId:replacement.id},replacementToken);
  for (const stage of stages.slice(1,3)) await http(`/crm/deals/${secondWin.id}/stage`,'PATCH',{stageId:stage.id},replacementToken);
  await mutation('Second agent revenue is included in both organization dashboards',()=>http(`/crm/deals/${secondWin.id}/stage`,'PATCH',{stageId:stages[3].id},replacementToken),async () => {
    const currentEnd = dashboardToday();
    if (currentEnd !== fixtureEnd) { fixtureEnd = currentEnd; await applyFixtureDates(); }
    await expectValue('Total Revenue','₱2,800.00');
  });
  await page.getByText('Second Agent',{exact:true}).waitFor();
  assert.equal(await staffSession.tab.getByRole('heading', { name: 'Sales Leaderboard', exact: true }).count(), 0);
  assert.equal(await staffSession.tab.getByText('Second Agent', { exact: true }).count(), 0);
  for (const interval of ['Week','Month','Year']) {
    await page.getByRole('button',{name:'Filter Revenue Trend',exact:true}).click();
    await page.getByRole('menuitem',{name:interval,exact:true}).click();
    await page.getByRole('heading',{name:/^Revenue Trend by /}).waitFor();
    await expectValue('Total Revenue','₱2,800.00');
  }
  await page.getByRole('button',{name:'Filter Revenue Trend',exact:true}).click(); await page.getByRole('menuitem',{name:'Month',exact:true}).click();
  await page.goto(base+'/reporting');
  await page.getByRole('button',{name:'Filter Deal Pipeline Conversion Funnel',exact:true}).waitFor();
  assert.equal(await page.getByText('Cohort details',{exact:true}).count(),0);
  for (const period of ['Week','Month','Year']) {
    const response = page.waitForResponse(response=>response.url().includes('/reporting/dashboard?') && new URL(response.url()).searchParams.get('funnelRange')===period.toLowerCase());
    await page.getByRole('button',{name:'Filter Deal Pipeline Conversion Funnel',exact:true}).click(); await page.getByRole('menuitem',{name:period,exact:true}).click();
    const filteredResponse = await response;
    assert.equal(new URL(filteredResponse.url()).searchParams.get('range'),'thisMonth');
    const result = await filteredResponse.json();
    assert.equal(result.data.conversion.period.range,period.toLowerCase());
  }
  await page.getByRole('button',{name:'Filter Deal Pipeline Conversion Funnel',exact:true}).click(); await page.getByRole('menuitem',{name:'Custom Range',exact:true}).click();
  const today = dashboardToday();
  await page.getByLabel('Funnel From Date').fill(fixtureStart); await page.getByLabel('Funnel To Date').fill(today);
  assert.equal(await page.getByLabel('Funnel To Date').getAttribute('max'),today);
  const tomorrow = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
  await page.getByLabel('Funnel To Date').fill(tomorrow); await page.getByRole('button',{name:'Apply funnel dates',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Choose valid historical dates'}).waitFor();
  await page.getByLabel('Funnel From Date').fill(tomorrow); await page.getByLabel('Funnel To Date').fill(today); await page.getByRole('button',{name:'Apply funnel dates',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Choose valid historical dates'}).waitFor();
  await page.getByLabel('Funnel From Date').fill(fixtureStart);

  const customResponse = page.waitForResponse(response=>response.url().includes('/reporting/dashboard?') && new URL(response.url()).searchParams.get('funnelRange')==='custom');
  await page.getByRole('button',{name:'Apply funnel dates',exact:true}).click();
  assert.equal(new URL((await customResponse).url()).searchParams.get('range'),'thisMonth');
  assert.equal(await page.getByText('View revenue and outcome data',{exact:true}).count(),0);
  assert.equal(await page.getByText(/Reporting limitations \(/).count(),0);
  assert.equal(await page.getByText(/Automatic updates connected|Assigned records only/).count(),0);
  const cohort = await http(`/reporting/dashboard?range=custom&start=${fixtureStart}&end=${fixtureEnd}&revenueInterval=month&funnelRange=custom&funnelStart=${fixtureStart}&funnelEnd=${today}`);
  for (const [label, rate] of [
    ['Lead → Contacted', cohort.conversion.leadToContacted], ['Contacted → Qualified', cohort.conversion.contactedToQualified],
    [`Qualified → ${cohort.pipeline.stages[3].name}`, cohort.conversion.qualifiedToWon],
  ]) {
    await page.getByText(`${label}: ${rate===null?'Unavailable':`${rate}%`}`,{exact:true}).waitFor();
  }
  record('Revenue intervals, independent funnel periods, historical custom date controls and requested cleanup');
  await page.goto(base+'/dashboard');
  await page.getByRole('region',{name:'Pipeline Overview'}).waitFor();
  const pipelineSession = await session(adminToken);
  await pipelineSession.tab.goto(base+'/crm/deals',{waitUntil:'domcontentloaded',timeout:60000});
  const pipelineNav = pipelineSession.tab.getByRole('button',{name:'Pipeline',exact:true});
  if (await pipelineNav.count()) await pipelineNav.click();
  const observerSession = await session(adminToken);
  await observerSession.tab.goto(base+'/crm/deals',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(await pipelineSession.tab.getByRole('button',{name:'Manage pipeline stages',exact:true}).count(),0);
  for (const [index, stage] of stages.entries()) {
    const color = `#12345${index}`;
    await http(`/crm/stages/${stage.id}`, 'PUT', { color });
    const persisted = await http(`/crm/pipelines/${pipeline.id}`);
    assert.equal(persisted.stages[index].color,color);
    await until(async()=>{
      const rows=await Promise.all([http('/reporting/dashboard'),http('/reporting/dashboard','GET',undefined,agentToken)]);
      if(!rows.every(row=>row.pipeline.stages[index].color===color)) return false;
      if(index>=3) return true; // Terminal stages are absent from Pipeline Overview.
      const selectors = [page,staffSession.tab].map(tab=>tab.getByRole('meter',{name:`${stage.name} deal count relative to largest stage`,exact:true}).locator('div'));
      return (await Promise.all(selectors.map(selector=>selector.evaluate(el=>el.style.backgroundColor)))).every(value=>value===`rgb(18, 52, ${80+index})`);
    },'Saved stage color reaches Dashboard');
    const observerColor = observerSession.tab.getByRole('heading',{name:stage.name,exact:true}).locator('..').locator('..').locator('[aria-hidden="true"]').first();
    await until(async()=>await observerColor.evaluate(el=>el.style.backgroundColor)===`rgb(18, 52, ${80+index})`,'Color reaches another Deals session');
  }
  await pipelineSession.context.close(); await observerSession.context.close();
  const reopened = await session(adminToken); await reopened.tab.goto(base+'/crm/deals',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(await reopened.tab.getByRole('button',{name:'Manage pipeline stages',exact:true}).count(),0);
  assert.equal((await http(`/crm/pipelines/${pipeline.id}`)).stages[0].color,'#123450');
  for (const width of [1440,768,390,320]) {
    await reopened.tab.setViewportSize({width,height:1000});
    const bounds=await reopened.tab.getByRole('combobox',{name:'Pipeline',exact:true}).boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
    await reopened.tab.screenshot({path:resolve(output,`stages-${width}.png`)});
  }
  await reopened.context.close();
  record('All five saved colors persist and propagate through authorized Dashboard revisions');
  assert.equal(await page.getByRole('button',{name:'Export CSV',exact:true}).count(),0);
  const csv = await page.request.get(base+'/api/proxy/reporting/dashboard/export?range=thisMonth');
  assert.ok(csv.ok()); assert.match(csv.headers()['content-type'],/text\/csv/);
  record('Dashboard export button removed; shared reporting CSV endpoint remains authorized');
  let failing = true;
  await page.route('**/api/proxy/reporting/dashboard?*', async route => {
    if (failing && await page.evaluate(() => window.__dashboardRetryClicked === true)) failing = false;
    return failing ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:{message:'Acceptance database unavailable'}})}) : route.continue();
  });
  await page.getByRole('button',{name:'Sync Metrics',exact:true}).click(); await page.getByRole('alert').filter({hasText:'Acceptance database unavailable'}).waitFor();
  assert.equal(await value(page,'Total Revenue'),'₱2,800.00');
  // Background reconciliation must keep failing until the actual Retry click.
  // Releasing it earlier can remove the button before Playwright can click it.
  await page.getByRole('button',{name:'Retry',exact:true}).evaluate(button => button.addEventListener('click', () => { window.__dashboardRetryClicked = true; }, { once: true }));
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await until(async () => await page.getByRole('alert').filter({hasText:'Acceptance database unavailable'}).count() === 0,'Error recovery'); record('Backend failure retains labeled stale data and Retry recovers');
  await wait(5000); // Let verification toasts expire before visual inspection.
  for (const theme of ['Classic','Light','Dark','System']) {
    await setAcceptanceTheme(page,theme);
    for (const width of [320,375,390,430,768,1024,1440,1920]) {
      await page.setViewportSize({width,height:1000}); await wait(300);
      const dimensions = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth > innerWidth+1,
        chartsOutside:[...document.querySelectorAll('[role="img"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width && (r.left<0 || r.right>innerWidth+1);}).length,
        headingsOutside:[...document.querySelectorAll('main h3, main [aria-label^="Filter "]')].filter(el=>{const r=el.getBoundingClientRect();return r.width && (r.left<0 || r.right>innerWidth+1);}).length}));
      assert.equal(dimensions.overflow,false,JSON.stringify(dimensions)); assert.equal(dimensions.chartsOutside,0,JSON.stringify(dimensions)); assert.equal(dimensions.headingsOutside,0,JSON.stringify(dimensions));
      await page.locator('main').evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:resolve(output,`${theme}-${width}.png`),fullPage:true});
      await page.getByRole('heading',{name:'Sales Leaderboard',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(output,`${theme}-${width}-lower.png`),fullPage:true}); record(`${theme} responsive ${width}`,dimensions);
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await mutation('Deactivation clears session and preserves historical credit', () => http(`/administration/users/${agent.id}/deactivate`,'POST',{replacementAgentId:replacement.id}), async () => { await until(async () => await staffSession.tab.getByRole('heading',{name:'Revenue Trend',exact:true}).count() === 0,'Inactive session cleared'); await page.getByText('First Agent',{exact:true}).waitFor(); });
  for (let i=0;i<5;i++) { const r = await http('/reporting/dashboard?range=thisMonth'); queryTimes.push(r.queryMs); assert.equal(r.metrics.totalRevenue,r.trend.reduce((sum,p)=>sum+p.revenue,0)); assert.equal(r.metrics.activeDeals,r.distribution.reduce((sum,p)=>sum+p.count,0)); assert.equal(r.metrics.openPipelineValue,r.distribution.reduce((sum,p)=>sum+(p.value ?? 0),0)); }
  record('Authoritative reconciliation after all committed mutations',{queryMs:queryTimes});
  }
  assert.deepEqual(pageErrors,[]);
  assert.deepEqual(consoleMessages.filter(message=>/MaxListenersExceededWarning|ObjectMultiplex|Blocked script execution/.test(message.text)),[]);
  writeFileSync(resolve(output,clockOnly?'clock-results.json':'results.json'),JSON.stringify({checks,pageErrors,consoleMessages,latencies,queryTimes,stages,scope:'Disposable PostgreSQL-compatible database, optimized frontend build, clean Chrome profile with extensions disabled and local HTTPS gateway'},null,2));
  console.log(`Dashboard acceptance passed: ${checks.length} checks.`);
} catch (error) {
  if (page) { await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{}); writeFileSync(resolve(output,'failure.txt'),await page.locator('body').innerText().catch(()=>'')); }
  writeFileSync(resolve(output,clockOnly?'clock-results.json':'results.json'),JSON.stringify({checks,pageErrors,consoleMessages,latencies,queryTimes,error:String(error)},null,2)); throw error;
} finally {
  await browser?.close(); frontend?.kill();
  if (gateway) { gateway.closeAllConnections(); await new Promise(done=>gateway.close(done)); }
  if (api) { api.closeAllConnections(); await new Promise(done=>api.close(done)); }
  await prisma.$disconnect(); await socket.stop();
  // Socket close handlers schedule detach callbacks on the next event-loop turn.
  await new Promise(done => setImmediate(done));
  await pg.close();
}

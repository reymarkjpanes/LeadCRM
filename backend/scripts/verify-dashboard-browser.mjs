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
const root = resolve(import.meta.dirname, '../..'), output = resolve(process.env.DASHBOARD_VERIFICATION_OUTPUT || (uiPolish ? process.env.UI_POLISH_OUTPUT || resolve(tmpdir(), 'leadcrm-dashboard-leads-ui') : resolve(root, 'data/outputs/dashboard-verification')));
const clockOnly = process.argv.includes('--clock-only');
mkdirSync(output, { recursive: true });
const pg = await PGlite.create(); await replayCrmMigrations(pg);
const socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 }); await socket.start();
const base = 'https://localhost:3032', internalBase = 'http://127.0.0.1:3031';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/dashboard_acceptance?connection_limit=1&statement_cache_size=0`, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), APP_URL: base, CORS_ORIGIN: base, ALLOWED_ORIGINS: base });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url), Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) { return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options); };
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { tenantContext } = require('../dist/backend/src/core/tenant/tenant-context.js');
const { salesPipeline, salesTransaction } = require('../dist/backend/src/modules/crm/leads/lead-automation.service.js');
const { issueAuthSession } = require('../dist/backend/src/core/auth/auth-session.js');
let api, frontend, browser, page, gateway;
const checks = [], pageErrors = [], latencies = [], queryTimes = [];
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
  const grants = ['dashboard','deals','leads','contacts','accounts','tasks'].map(module => ({ module, canView: true, canEdit: module !== 'dashboard', canCreate: module !== 'dashboard', canDelete: false, canArchive: module !== 'dashboard', ...(module === 'tasks' ? { canComplete: true } : {}) }));
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
  async function http(path, method = 'GET', body, token = adminToken) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection:'close' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`); return result.data;
  }
  const log = createWriteStream(resolve(output, 'frontend.log'));
  frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3031', '-H', '127.0.0.1'], { cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, NODE_ENV: 'development', API_URL: `http://127.0.0.1:${port}/api/v1`, NEXT_PUBLIC_USE_MOCK_AUTH: 'false', NEXT_PUBLIC_USE_MOCK_DATA: 'false' } });
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
  gateway.listen(3032); await new Promise(done=>gateway.once('listening',done));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function session(token) {
    const context = await browser.newContext({ ignoreHTTPSErrors:true, hasTouch:uiPolish, viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      const Native = window.EventSource; window.__dashboardEvents = [];
      window.EventSource = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('dashboard-change', () => window.__dashboardEvents.push(Date.now())); }
      };
    });
    if (uiPolish) await context.addInitScript(() => {
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      const text = CanvasRenderingContext2D.prototype.fillText;
      const arc = CanvasRenderingContext2D.prototype.arc;
      const curve = CanvasRenderingContext2D.prototype.bezierCurveTo;
      CanvasRenderingContext2D.prototype.clearRect = function(...args) { this.canvas.__labels = []; this.canvas.__points = []; this.canvas.__curves = []; return clear.apply(this, args); };
      CanvasRenderingContext2D.prototype.fillText = function(...args) { (this.canvas.__labels ??= []).push(String(args[0])); return text.apply(this, args); };
      CanvasRenderingContext2D.prototype.arc = function(...args) { (this.canvas.__points ??= []).push({ x: args[0], y: args[1], radius: args[2] }); return arc.apply(this, args); };
      CanvasRenderingContext2D.prototype.bezierCurveTo = function(...args) { (this.canvas.__curves ??= []).push({ x: args[4], y: args[5] }); return curve.apply(this, args); };
    });
    await context.addCookies([{ name: 'leadcrm_token', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const tab = await context.newPage(); tab.setDefaultTimeout(25000); tab.on('pageerror', error => pageErrors.push(error.message));
    await tab.goto(base + '/dashboard'); await tab.getByRole('heading', { name: 'Revenue Trend by Month', exact: true }).waitFor();
    await until(async () => (await tab.evaluate(() => window.__dashboardEvents.length)) > 0,'Dashboard subscription established'); return { context, tab };
  }
  const adminSession = await session(adminToken); page = adminSession.tab;
  const staffSession = await session(agentToken);
  const value = (tab, label) => tab.getByRole('group', { name: label, exact: true }).locator('.text-base').innerText();
  async function expectValue(label, expected, both = true) {
    await until(async () => (await value(page, label)) === expected && (!both || (await value(staffSession.tab, label)) === expected), `${label}=${expected}`);
  }
  async function mutation(label, work, assertUI) {
    const wallStart = Date.now(), started = performance.now(); const result = await work(); const committed = performance.now(); await assertUI(result);
    const displayed = Date.now();
    const eventAt = await page.evaluate(start => window.__dashboardEvents.filter(time => time >= start).at(-1),wallStart);
    const displayMs = Math.round(performance.now() - committed); latencies.push({ label, responseToDisplayMs: displayMs, requestToDisplayMs: Math.round(performance.now() - started), eventReceiptToVerifiedDisplayMs:eventAt ? displayed-eventAt : null }); record(label, { displayMs }); return result;
  }
  await expectValue('Active Deals', '0'); await expectValue('Win Rate', 'Unavailable'); await page.screenshot({path:resolve(output,'empty-zero-revenue.png'),fullPage:true}); record('Authenticated empty state through actual Next proxy and two SSE sessions');
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
  if (clockOnly) {
    for (const width of [1440,640,639,390,320]) {
      await page.setViewportSize({width,height:1000});
      await clock.scrollIntoViewIfNeeded();
      for (const label of ['Dashboard date range','Sync Metrics']) {
        const control = page.getByRole('button',{name:label,exact:true});
        assert.equal(await control.locator('span').isVisible(),width>=640);
        if (width<640) {
          const bounds = await control.boundingBox(); assert.equal(bounds.width,44); assert.equal(bounds.height,44);
        }
      }
      assert.equal(await page.getByRole('button',{name:'Dashboard date range',exact:true}).locator('svg').last().isVisible(),width>=640);
      const dimensions = await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scrollWidth<=width+1);
      await page.screenshot({path:resolve(output,`clock-${width}.png`),fullPage:true});
      await page.getByRole('heading',{name:'Deal Pipeline Conversion Funnel',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:resolve(output,`clock-${width}-funnel.png`),fullPage:true});
      record(`Clock, requested notes and responsive toolbar ${width}`,dimensions);
    }
  } else if (uiPolish) {
    const { verifyDashboardLeadsUi } = await import('./verify-dashboard-leads-ui.mjs');
    await verifyDashboardLeadsUi({ page, staffPage: staffSession.tab, base, output, http, prisma, tenant, admin, agent, replacement, pipeline, stages, products, record, until, wait, expectValue, leadsOnly: process.argv.includes('--leads-only') });
  } else {
  const lead = await mutation('Another agent creates a lead visible to both reporting users', () => http('/crm/leads', 'POST', { firstName: 'Browser', lastName: 'Lead', email: 'browser@example.test', status: 'Warm', assignedUserId: replacement.id }, replacementToken), () => expectValue('Total Leads', '1'));
  const created = await mutation('Deal creation updates all current charts', () => http('/crm/deals', 'POST', { pipelineId: pipeline.id, stageId: stages[0].id, title: 'Browser Deal', productInterestIds: [products[0].id], assignedUserId: agent.id }), () => expectValue('Active Deals', '1'));
  const deal = created;
  for (const index of [1,2,0,2]) {
    await mutation(`Stage movement to ${stages[index].name}`, () => http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[index].id }), async () => {
      await expectValue('Active Deals', '1');
      await until(() => page.getByText(`${stages[index].name}: 1 (100%)`, { exact: true }).isVisible(), 'Pipeline moved');
    });
  }
  const legacy = await prisma.deal.create({data:{tenantId:tenant.id,pipelineId:pipeline.id,stageId:stages[0].id,title:'Legacy amount correction',value:500,assignedUserId:agent.id,ownerId:agent.id}});
  // Product pricing is an immutable snapshot in normal CRM APIs. Exercise a
  // committed database correction as an integration write, without weakening it.
  await mutation('Committed integration amount correction updates pipeline and forecast', () => prisma.deal.update({where:{id:legacy.id},data:{value:1800}}), () => expectValue('Forecasted Revenue', '₱880.00'));
  await http(`/crm/deals/${legacy.id}/archive`,'PATCH'); await expectValue('Active Deals','1');
  await mutation('Won closure updates revenue, trend, counts, rate and attribution', () => http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[3].id }), async () => { await expectValue('Active Deals','0'); await expectValue('Total Revenue','₱1,000.00'); await expectValue('Win Rate','100%'); await page.getByText('1 won deals', { exact: true }).last().waitFor(); });
  const closeAt = (await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt;
  await http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[3].id });
  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt.toISOString(), closeAt.toISOString());
  assert.equal(await prisma.dealStageHistory.count({ where: { dealId: deal.id, newStageId: stages[3].id } }),1); record('Repeated closure has one revenue recognition and one history milestone');
  const losing = await http('/crm/deals','POST',{ pipelineId: pipeline.id, stageId: stages[0].id, title: 'Lost and Reopened', productInterestIds:[products[0].id], assignedUserId:agent.id });
  await mutation('Lost closure and Win Rate denominator', () => http(`/crm/deals/${losing.id}/stage`,'PATCH',{ stageId:stages[4].id, lostReason:'Deferred' }), () => expectValue('Win Rate','50%'));
  await mutation('Lost reopening removes current outcome and restores pipeline', () => http(`/crm/deals/${losing.id}/stage`,'PATCH',{ stageId:stages[2].id }), async () => { await expectValue('Active Deals','1'); await expectValue('Win Rate','100%'); });
  const task = await mutation('Task creation updates Action Center', () => http('/operations/tasks','POST',{ title:'Browser overdue follow-up', dueDate:new Date(Date.now()-86400000).toISOString(), priority:'High', assignedUserId:agent.id }), async () => { await page.getByText('Browser overdue follow-up',{exact:true}).waitFor(); await staffSession.tab.getByText('Browser overdue follow-up',{exact:true}).waitFor(); });
  const actionLayout = await page.getByRole('link').filter({hasText:'Browser overdue follow-up'}).evaluate(el=>({height:el.parentElement.clientHeight,overflow:getComputedStyle(el.parentElement).overflowY,clipped:el.getBoundingClientRect().bottom>el.parentElement.getBoundingClientRect().bottom+1})); assert.equal(actionLayout.height,580); assert.equal(actionLayout.overflow,'auto'); assert.equal(actionLayout.clipped,false); record('Action Center uses a stable five-slot scroll viewport',actionLayout);
  await mutation('Task completion removes pending action', () => http(`/operations/tasks/${task.id}/complete`,'PATCH'), async () => until(async () => await page.getByText('Browser overdue follow-up',{exact:true}).count() === 0, 'Task disappeared'));
  const workflows = require('../dist/backend/src/modules/automation/workflows/workflows.service.js');
  const workflow = await scope(() => workflows.createWorkflow(tenant.id,admin.id,{ name:'Dashboard movement', trigger:'deal.updated', isActive:true, conditions:{operator:'AND',conditions:[{field:'deal.title',operator:'equals',value:'Workflow Ready'}]},actions:[{type:'move_deal_stage',config:{stageId:stages[1].id}}] }));
  await mutation('Committed Workflow stage movement synchronizes', () => http(`/crm/deals/${losing.id}`,'PUT',{title:'Workflow Ready'}), async () => until(() => page.getByText('Contacted: 1 (100%)',{exact:true}).isVisible(),'Workflow stage visible'));
  await scope(() => workflows.toggleWorkflow(workflow.id,tenant.id,admin.id,false));
  await mutation('Archive changes eligibility', () => http(`/crm/deals/${losing.id}/archive`,'PATCH'), () => expectValue('Active Deals','0'));
  await mutation('Restore changes eligibility', () => http(`/crm/deals/${losing.id}/restore`,'PATCH'), () => expectValue('Active Deals','1'));
  await mutation('Lead reassignment preserves organization totals for both viewers', () => http(`/crm/leads/${lead.id}`,'PUT',{assignedUserId:agent.id}), () => expectValue('Total Leads','1'));
  await staffSession.context.setOffline(true);
  await mutation('Offline reconnection retrieves authoritative current state', async () => {
    await http(`/crm/deals/${losing.id}`,'PUT',{assignedUserId:replacement.id});
    await http(`/crm/deals/${losing.id}/stage`,'PATCH',{stageId:stages[2].id});
    await staffSession.context.setOffline(false);
  }, async () => until(() => staffSession.tab.getByText('Qualified: 1 (100%)',{exact:true}).isVisible(),'Recovered committed stage after offline period'));
  api.closeAllConnections(); await new Promise(done => api.close(done));
  api = app.listen(port,'127.0.0.1'); await new Promise(done => api.once('listening',done));
  await wait(200);
  await mutation('Server restart preserves revisions and automatically reconnects', async () => {
    await http(`/crm/deals/${losing.id}`,'PUT',{assignedUserId:agent.id});
    await http(`/crm/deals/${losing.id}/stage`,'PATCH',{stageId:stages[1].id});
  }, async () => until(() => staffSession.tab.getByText('Contacted: 1 (100%)',{exact:true}).isVisible(),'Restart recovered committed stage'));
  await mutation('Permission revocation hides sensitive Dashboard without reload', () => http(`/administration/roles/${role.id}`,'PUT',{permissions:grants.map(p => p.module === 'dashboard' ? {...p,canView:false} : p)}), async () => until(async () => await staffSession.tab.getByRole('heading',{name:'Revenue Trend by Month',exact:true}).count() === 0,'Dashboard hidden'));
  await mutation('Permission restoration remounts Dashboard without reload', () => http(`/administration/roles/${role.id}`,'PUT',{permissions:grants}), async () => { await staffSession.tab.getByRole('heading',{name:'Revenue Trend by Month',exact:true}).waitFor(); await until(async () => await value(staffSession.tab,'Active Deals') === '1','Grant visible'); });
  for (const label of ['Today','Last 7 Days','Last 30 Days','This Month','Last Month','Last 3 Months','Last 6 Months','This Year']) {
    await page.getByRole('button',{name:'Dashboard date range',exact:true}).click(); await page.getByRole('menuitem',{name:label,exact:true}).click();
    await page.getByRole('heading',{name:'Revenue Trend by Month',exact:true}).waitFor();
    await until(async () => !await page.getByRole('button',{name:'Syncing…',exact:true}).count(),'Date query complete');
  }
  await page.getByRole('button',{name:'Dashboard date range',exact:true}).click(); await page.getByRole('menuitem',{name:'Custom Date Range',exact:true}).click();
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await page.getByLabel('Start date',{exact:true}).fill(today); await page.getByLabel('End date',{exact:true}).fill(today); await page.getByRole('button',{name:'Apply dates',exact:true}).click();
  await until(async () => await value(page,'Total Revenue') === '₱1,000.00','Custom revenue'); record('All nine date filters and current-state distinction');
  const secondWin = await http('/crm/deals','POST',{pipelineId:pipeline.id,stageId:stages[0].id,title:'Second Agent Win',productInterestIds:[products[1].id],assignedUserId:replacement.id},replacementToken);
  for (const stage of stages.slice(1,3)) await http(`/crm/deals/${secondWin.id}/stage`,'PATCH',{stageId:stage.id},replacementToken);
  await mutation('Second agent revenue is included in both organization dashboards',()=>http(`/crm/deals/${secondWin.id}/stage`,'PATCH',{stageId:stages[3].id},replacementToken),()=>expectValue('Total Revenue','₱2,800.00'));
  await page.getByText('Second Agent',{exact:true}).waitFor(); await staffSession.tab.getByText('Second Agent',{exact:true}).waitFor();
  for (const interval of ['Week','Month','Year']) {
    await page.getByRole('button',{name:'Filter Revenue Trend',exact:true}).click();
    await page.getByRole('menuitem',{name:interval,exact:true}).click();
    await page.getByRole('heading',{name:`Revenue Trend by ${interval}`,exact:true}).waitFor();
    await expectValue('Total Revenue','₱2,800.00');
  }
  await page.getByRole('button',{name:'Filter Revenue Trend',exact:true}).click(); await page.getByRole('menuitem',{name:'Month',exact:true}).click();
  for (const period of ['Week','Month','Year']) {
    await page.getByRole('button',{name:'Filter Deal Pipeline Conversion Funnel',exact:true}).click(); await page.getByRole('menuitem',{name:period,exact:true}).click();
    await page.getByText(`Deals created during the current ${period.toLowerCase()} · Recorded milestones through today`,{exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'Filter Deal Pipeline Conversion Funnel',exact:true}).click(); await page.getByRole('menuitem',{name:'Custom Range',exact:true}).click();
  await page.getByLabel('Funnel From Date').fill(today); await page.getByLabel('Funnel To Date').fill(today);
  assert.equal(await page.getByLabel('Funnel To Date').getAttribute('max'),today);
  const tomorrow = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
  await page.getByLabel('Funnel To Date').fill(tomorrow); await page.getByRole('button',{name:'Apply funnel dates',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Choose valid historical dates'}).waitFor();
  await page.getByLabel('Funnel From Date').fill(tomorrow); await page.getByLabel('Funnel To Date').fill(today); await page.getByRole('button',{name:'Apply funnel dates',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Choose valid historical dates'}).waitFor();
  await page.getByLabel('Funnel From Date').fill(today);

  await page.getByRole('button',{name:'Apply funnel dates',exact:true}).click();
  await page.getByText(/Deals created .*Recorded milestones through/).filter({hasNotText:'current'}).waitFor();
  assert.equal(await page.getByText('View revenue and outcome data',{exact:true}).count(),0);
  assert.equal(await page.getByText(/Reporting limitations \(/).count(),0);
  assert.equal(await page.getByText(/Automatic updates connected|Assigned records only|Lead → Contacted:/).count(),0);
  record('Revenue intervals, independent funnel periods, historical custom date controls and requested cleanup');
  const pipelineSession = await session(adminToken);
  await pipelineSession.tab.goto(base+'/crm/deals',{waitUntil:'domcontentloaded',timeout:60000});
  const pipelineNav = pipelineSession.tab.getByRole('button',{name:'Pipeline',exact:true});
  if (await pipelineNav.count()) await pipelineNav.click();
  const observerSession = await session(adminToken);
  await observerSession.tab.goto(base+'/crm/deals',{waitUntil:'domcontentloaded',timeout:60000});
  await pipelineSession.tab.getByRole('button',{name:'Manage pipeline stages',exact:true}).click();
  const manager = pipelineSession.tab.getByRole('dialog',{name:'Manage pipeline stages',exact:true});
  for (const [index, stage] of stages.entries()) {
    const color = `#12345${index}`;
    await manager.getByLabel(`Stage Color for ${stage.name}`,{exact:true}).fill(color);
    const saveResponse = pipelineSession.tab.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/crm/stages/${stage.id}`));
    await manager.getByRole('button',{name:'Save Changes',exact:true}).nth(index).click();
    const saved = await saveResponse; assert.ok(saved.ok(),await saved.text());
    await until(async()=>!(await manager.getByRole('button',{name:'Saving…',exact:true}).count()),'Color save complete');
    const persisted = await http(`/crm/pipelines/${pipeline.id}`);
    assert.equal(persisted.stages[index].color,color);
    await until(async()=>{
      const rows=await Promise.all([http('/reporting/dashboard'),http('/reporting/dashboard','GET',undefined,agentToken)]);
      if(!rows.every(row=>row.pipeline.stages[index].color===color)) return false;
      const selectors = [page,staffSession.tab].map(tab=>index>2 ? tab.getByText(stage.name,{exact:true}).locator('span').first() : tab.getByText(stage.name+': '+(index===1?'1 (100%)':'0 (0%)'),{exact:true}).locator('span').first());
      return (await Promise.all(selectors.map(selector=>selector.evaluate(el=>el.style.backgroundColor)))).every(value=>value===`rgb(18, 52, ${80+index})`);
    },'Saved stage color reaches Dashboard');
    const observerColor = observerSession.tab.getByRole('heading',{name:stage.name,exact:true}).locator('..').locator('..').locator('[aria-hidden="true"]').first();
    await until(async()=>await observerColor.evaluate(el=>el.style.backgroundColor)===`rgb(18, 52, ${80+index})`,'Color reaches another Deals session');
  }
  await pipelineSession.context.close(); await observerSession.context.close();
  const reopened = await session(adminToken); await reopened.tab.goto(base+'/crm/deals',{waitUntil:'domcontentloaded',timeout:60000});
  await reopened.tab.getByRole('button',{name:'Manage pipeline stages',exact:true}).click();
  assert.equal(await reopened.tab.getByLabel('Stage Color for Lead',{exact:true}).inputValue(),'#123450');
  for (const width of [1440,768,390,320]) {
    await reopened.tab.setViewportSize({width,height:1000});
    const bounds=await reopened.tab.getByRole('dialog',{name:'Manage pipeline stages',exact:true}).boundingBox();
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
  await page.route('**/api/proxy/reporting/dashboard?*', route => failing ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,error:{message:'Acceptance database unavailable'}})}) : route.continue());
  await page.getByRole('button',{name:'Sync Metrics',exact:true}).click(); await page.getByRole('alert').filter({hasText:'Acceptance database unavailable'}).waitFor();
  assert.equal(await value(page,'Total Revenue'),'₱2,800.00'); failing=false; await page.getByRole('button',{name:'Retry',exact:true}).click();
  await until(async () => await page.getByRole('alert').filter({hasText:'Acceptance database unavailable'}).count() === 0,'Error recovery'); record('Backend failure retains labeled stale data and Retry recovers');
  await wait(5000); // Let verification toasts expire before visual inspection.
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => { localStorage.setItem('app_theme',theme === 'dark' ? 'Dark' : 'Light'); window.dispatchEvent(new CustomEvent('themechange',{detail:{theme,mode:theme === 'dark' ? 'Dark' : 'Light'}})); },theme);
    await until(() => page.locator('.crm-shell[data-theme-container]').evaluate((el, dark) => el.classList.contains('dark') === dark, theme === 'dark'), `${theme} theme applied`);
    assert.equal(await page.locator('.crm-shell[data-theme-container]').evaluate(el=>el.classList.contains('dark')),theme === 'dark');
    for (const width of [1440,1024,768,390,375,320]) {
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
  await mutation('Deactivation clears session and preserves historical credit', () => http(`/administration/users/${agent.id}/deactivate`,'POST',{replacementAgentId:replacement.id}), async () => { await until(async () => await staffSession.tab.getByRole('heading',{name:'Revenue Trend by Month',exact:true}).count() === 0,'Inactive session cleared'); await page.getByText('First Agent',{exact:true}).waitFor(); });
  for (let i=0;i<5;i++) { const r = await http('/reporting/dashboard?range=thisMonth'); queryTimes.push(r.queryMs); assert.equal(r.metrics.totalRevenue,r.trend.reduce((sum,p)=>sum+p.revenue,0)); assert.equal(r.metrics.activeDeals,r.distribution.reduce((sum,p)=>sum+p.count,0)); assert.equal(r.metrics.openPipelineValue,r.distribution.reduce((sum,p)=>sum+(p.value ?? 0),0)); }
  record('Authoritative reconciliation after all committed mutations',{queryMs:queryTimes});
  }
  assert.deepEqual(pageErrors,[]);
  writeFileSync(resolve(output,clockOnly?'clock-results.json':'results.json'),JSON.stringify({checks,pageErrors,latencies,queryTimes,stages,scope:'Disposable PostgreSQL-compatible database, optimized frontend build and local HTTPS gateway'},null,2));
  console.log(`Dashboard acceptance passed: ${checks.length} checks.`);
} catch (error) {
  if (page) { await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{}); writeFileSync(resolve(output,'failure.txt'),await page.locator('body').innerText().catch(()=>'')); }
  writeFileSync(resolve(output,clockOnly?'clock-results.json':'results.json'),JSON.stringify({checks,pageErrors,latencies,queryTimes,error:String(error)},null,2)); throw error;
} finally {
  await browser?.close(); frontend?.kill();
  if (gateway) { gateway.closeAllConnections(); await new Promise(done=>gateway.close(done)); }
  if (api) { api.closeAllConnections(); await new Promise(done=>api.close(done)); }
  await prisma.$disconnect(); await socket.stop(); await pg.close();
}

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { LEAD_SOURCES } from '../../shared/src/contracts/record-experience.js';

// Uses only the parent harness's disposable SQL, real API, sessions and proxy.
export async function verifyDashboardMetrics({ page, staffPage, base, output, http, prisma, tenant, agent, replacement, pipeline, stages, record, until, wait, expectValue, sourceOnly = false }) {
  const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
  const chart = title => page.getByRole('heading', { name: title, exact: true }).locator('..').locator('..');
  const revenue = () => page.getByRole('img', { name: /^Revenue Trend by/ });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const fetchReport = query => http(`/reporting/dashboard?${query}`);
  const overview=page.getByRole('region',{name:'Pipeline Overview',exact:true});
  const sources=page.getByRole('region',{name:'Lead Source Performance',exact:true});
  const toolbar = page.getByRole('button', { name: 'Dashboard date range', exact: true });
  async function selectRange(label) {
    await toolbar.click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  }
  const reconcile = report => {
    assert.equal(report.metrics.totalRevenue, report.trend.reduce((sum,row) => sum + row.revenue,0));
    assert.equal(report.metrics.won, report.trend.reduce((sum,row) => sum + row.won,0));
    assert.equal(report.metrics.lost, report.trend.reduce((sum,row) => sum + row.lost,0));
    assert.equal(report.metrics.activeDeals, report.distribution.reduce((sum,row) => sum + row.count,0));
    assert.equal(report.metrics.forecastedRevenue, report.distribution.find(row => row.id === stages[2].id)?.value ?? 0);
    assert.equal(report.metrics.openPipelineValue, report.distribution.reduce((sum,row) => sum + row.value,0));
  };
  if (sourceOnly) {
    await create('Source chart open pipeline', 2500);
    await verifySources();
    return;
  }
  assert.ok(await page.getByText('No won revenue in the selected period.', { exact: true }).isVisible());
  assert.ok(await page.getByRole('region', { name: 'Pipeline Overview' }).getByText('No open deals.', { exact: true }).isVisible());
  record('Zero revenue and no closed outcomes have honest empty states');
  async function create(title, value, index = 0) {
    const product = await prisma.productInterest.create({ data: { tenantId: tenant.id, name: title, dealValue: value } });
    const deal = await http('/crm/deals', 'POST', { title, pipelineId: pipeline.id, stageId: stages[0].id, productInterestIds: [product.id], assignedUserId: agent.id });
    if (index >= 3) await http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[2].id });
    if (index) await http(`/crm/deals/${deal.id}/stage`, 'PATCH', { stageId: stages[index].id, ...(index === 4 ? { lostReason: 'Deferred' } : {}) });
    return deal;
  }
  await create('Metrics open Lead', 100000);
  await create('Metrics open Contacted', 50000, 1);
  const qualified = await create('Metrics open Qualified', 37000, 2);
  await prisma.stage.update({ where: { id: stages[0].id }, data: { probability: null } });
  await prisma.deal.update({ where: { id: qualified.id }, data: { expectedCloseDate: new Date('2030-01-01') } });
  await expectValue('Forecasted Revenue', money(37000));
  await expectValue('Active Deals', '3');
  reconcile(await fetchReport('range=thisMonth'));
  record('Forecasted Revenue matches only Qualified despite valued early stages, missing probability and future close date');
  const winner = await create('Metrics credited win', 1000, 3);
  await create('Metrics second credited win', 500, 3);
  await create('Metrics lost', 2000, 4);
  const timestamp = new Date();
  const unknown = await prisma.deal.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, stageId: stages[3].id, title: 'Unattributed historical fixture',
    value: 5000, currency: 'PHP', createdAt: new Date(+timestamp - 3600000), closedAt: timestamp, assignedUserId: agent.id, ownerId: agent.id } });
  // This disposable legacy fixture intentionally lacks history. Release its
  // current-entry reference before deletion, preserving the production FK.
  await prisma.$transaction([
    prisma.deal.update({ where: { id: unknown.id }, data: { currentStageHistoryId: null } }),
    prisma.dealStageHistory.deleteMany({ where: { dealId: unknown.id } }),
  ]);
  await expectValue('Total Revenue', money(6500));
  await expectValue('Win Rate', '75%');
  await page.getByRole('region', { name: 'Sales Leaderboard' }).getByText('2 deals', { exact: true }).waitFor();
  assert.ok(await page.getByText(/1 won deals.*5,000.00 without verified eligible sales credit/).isVisible());
  await page.getByText(/Reporting warnings/).click();
  await page.getByText(/period wins lack verified historical agent attribution/).waitFor();
  await page.getByText(/cohort deals lack a recorded starting milestone/).waitFor();
  record('Multiple wins group under immutable agent credit; unknown revenue and incomplete funnel history are exposed');
  const initial = await fetchReport('range=thisMonth'); reconcile(initial);
  assert.equal(initial.leaderboard[0].revenue, 1500); assert.equal(initial.leaderboard[0].won, 2);
  assert.equal(initial.conversion.cohort, 7); assert.equal(initial.conversion.qualifiedToWon, null);
  assert.deepEqual(await page.getByRole('heading', {level:3}).allTextContents(), ['Action Center','Revenue Trend','Pipeline Overview','Lead Source Performance','Sales Leaderboard']);
  for (const title of ['Avg Deal Velocity','Deals Won vs. Lost','Pipeline Distribution','Pipeline Value by Stage']) assert.equal(await page.getByText(title,{exact:true}).count(),0);
  for(const stage of initial.distribution){
    const row=overview.getByRole('listitem',{name:stage.name,exact:true});
    assert.equal(await row.getByRole('meter').getAttribute('aria-valuenow'),String(stage.count));
    assert.equal(await row.getByText(`${stage.count} ${stage.count === 1 ? 'deal' : 'deals'}`,{exact:true}).count(),1);
    assert.equal(await row.getByRole('meter').locator('div').evaluate((bar,color)=>{const probe=document.createElement('span');probe.style.backgroundColor=color;return probe.style.backgroundColor===bar.style.backgroundColor;},stage.color),true);
  }
  const currentCounts = report => report.pipeline.stages.slice(0, 4).map(stage => stage.isWon ? report.metrics.currentWon : report.distribution.find(row => row.id === stage.id).count);
  async function expectSources(report, tab = page) {
    const region = tab.getByRole('region', { name: 'Lead Source Performance', exact: true });
    const counts = new Map(report.leadSourcePerformance.sources.map(row => [row.name, row.won]));
    const expected = [...new Set([...LEAD_SOURCES, ...counts.keys()])].map(name => {
      const won = counts.get(name) ?? 0;
      return `${name}: ${won} ${won === 1 ? 'won deal' : 'won deals'}`;
    });
    await until(async () => JSON.stringify(await region.getByRole('listitem').allTextContents()) === JSON.stringify(expected), 'Source chart matches authoritative won Deal counts');
    assert.equal(await tab.getByRole('region', { name: 'Conversion Funnel', exact: true }).count(), 0);
  }
  await expectSources(initial);
  const board=page.getByRole('region',{name:'Sales Leaderboard',exact:true});
  for(const [index,agent] of initial.leaderboard.entries()){
    await board.getByLabel(`Rank ${index+1}`,{exact:true}).waitFor();
    await board.getByText(`${agent.firstName} ${agent.lastName}`,{exact:true}).waitFor();
    assert.equal(await board.getByLabel(money(agent.revenue),{exact:true}).count(),1);
  }
  record('Dashboard uses exact current API stage counts and colors, won source counts and attributed agents');

  for (const theme of ['light','dark']) {
    await page.evaluate(theme => { localStorage.setItem('app_theme', theme === 'dark' ? 'Dark' : 'Light'); window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, mode: theme === 'dark' ? 'Dark' : 'Light' } })); }, theme);
    await until(() => page.locator('.crm-shell[data-theme-container]').evaluate((element,dark) => element.classList.contains('dark') === dark, theme === 'dark'), 'Theme applied');
    for (const [label, range, interval] of [['Today', 'today', 'Week'], ['Last 3 Months', 'last3', 'Month']]) {
      await selectRange(label);
      await page.getByRole('img', { name: new RegExp(`^Revenue Trend by ${interval}:`) }).waitFor();
      const report = await fetchReport(`range=${range}&revenueInterval=${interval.toLowerCase()}`); reconcile(report);
      for (const width of [320,375,390,430,768,1024,1440]) {
        await page.setViewportSize({ width, height: 1000 }); await wait(350);
        const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          charts: [...document.querySelectorAll('canvas')].map(canvas => { const bounds = canvas.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right, labels: canvas.__labels ?? [] }; }) }));
        assert.ok(dimensions.scrollWidth <= width + 1, JSON.stringify(dimensions));
        assert.equal(dimensions.charts.length, 2);
        for (const [index, canvas] of dimensions.charts.entries()) {
          assert.ok(canvas.width > 0 && canvas.height > 0, JSON.stringify(canvas));
          if (index === 0) assert.ok(canvas.left >= 0 && canvas.right <= width + 1, JSON.stringify(canvas));
          assert.ok(!canvas.labels.some(label => /^\d{4}-\d{2}-\d{2}$/.test(label)), 'Human-readable dates');
        }
        assert.ok(dimensions.charts[0].labels.some(label => label.startsWith('₱')), 'Compact currency scale');
        record(`${theme} ${interval} charts, labels and legends fit ${width}px`, dimensions);
      }
    }
    await page.getByRole('heading', { name: 'Sales Leaderboard', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `${theme}-metrics-1440.png`), fullPage: true });
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.getByRole('heading', { name: 'Sales Leaderboard', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `${theme}-metrics-320.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectRange('Today');
  await page.getByRole('img', { name: /^Revenue Trend by Week:/ }).waitFor();
  await revenue().scrollIntoViewIfNeeded(); await wait(1100);
  const canvas = revenue().locator('canvas');
  const point = await canvas.evaluate(canvas => canvas.__points.find(point => point.radius === 6));
  assert.ok(point, 'Single actual revenue marker');
  const bounds = await canvas.boundingBox(); assert.ok(point.x > bounds.width * 0.3 && point.x < bounds.width * 0.8, 'Single bucket is centered');
  await canvas.hover({ position: { x: point.x, y: point.y } });
  await until(() => canvas.evaluate(canvas => canvas.__labels.some(label => label.includes('Revenue (PHP):') && label.includes('6,500.00'))), 'Exact revenue tooltip');
  await page.mouse.move(0,0);
  record('Single revenue bucket is centered, visible and exposes the exact recorded revenue tooltip');
  await selectRange('This Month');
  await expectValue('Total Revenue', money(6500), false);

  await prisma.deal.update({ where: { id: winner.id }, data: { assignedUserId: replacement.id } });
  assert.equal((await fetchReport('range=thisMonth')).leaderboard[0].id, agent.id);
  let failed = true;
  await page.route('**/api/proxy/reporting/dashboard?*', route => failed ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Metrics refresh unavailable' } }) }) : route.continue());
  await page.getByRole('button', { name: 'Sync Metrics', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Metrics refresh unavailable' }).waitFor();
  assert.equal(await page.getByRole('group', { name: 'Revenue', exact: true }).getByLabel(money(6500), { exact: true }).getAttribute('aria-label'), money(6500));
  failed = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await until(async () => await page.getByRole('alert').filter({ hasText: 'Metrics refresh unavailable' }).count() === 0, 'Refresh recovery');
  await page.unroute('**/api/proxy/reporting/dashboard?*');
  record('Sync failure retains authoritative values; retry recovers; reassignment retains historical revenue owner');

  await page.goto(base + '/reporting');
  await selectRange('Custom Date Range');
  await page.getByLabel('Start date', { exact: true }).fill('2020-01-01');
  await page.getByLabel('End date', { exact: true }).fill('2020-01-02');
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expectValue('Total Revenue', money(0), false);
  await expectValue('Win Rate', '42.9%', false); await expectValue('Forecasted Revenue', money(37000), false);
  assert.ok(await page.getByText('No won revenue in the selected period.').isVisible());
  assert.equal((await fetchReport('range=custom&start=2020-01-01&end=2020-01-02')).conversion.cohort, 7);
  record('Custom global date filter changes period charts while current KPIs and independent cohort stay consistent');
  await page.goto(base + '/dashboard');
  await expectSources(initial);
  assert.equal(await page.getByRole('button', { name: /Filter Revenue Trend|Lead Source date range/ }).count(), 0);
  for (const [label, range] of [['Last Month','lastMonth'],['Today','today'],['Custom Date Range','custom']]) {
    const before = await page.getByRole('region', { name: 'Pipeline Overview' }).innerHTML();
    const response = page.waitForResponse(response => response.url().includes('/reporting/dashboard?') && new URL(response.url()).searchParams.get('range') === range);
    await selectRange(label);
    if (range === 'custom') {
      await page.getByLabel('Start date', { exact: true }).fill(today);
      await page.getByLabel('End date', { exact: true }).fill(today);
      await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
    }
    const filtered = await response; const report = (await filtered.json()).data;
    const params = new URL(filtered.url()).searchParams;
    assert.equal(params.get('leadSourceRange'), range);
    assert.equal(params.get('leadSourceStart'), params.get('start'));
    assert.equal(params.get('leadSourceEnd'), params.get('end'));
    assert.deepEqual(report.leadSourcePerformance.period, { start: report.period.start, end: report.period.end, timezone: report.period.timezone });
    if (report.leadSourcePerformance.sources.length) await expectSources(report);
    else await sources.getByText('No won deals for this period.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Pipeline Overview' }).innerHTML(), before);
    await expectValue('Total Revenue', money(report.metrics.totalRevenue), false);
    await expectValue('Win Rate', range === 'lastMonth' ? '0%' : '75%', false);
    record(`Toolbar ${label} filters sales metrics while preserving the current Pipeline Overview`);
  }
  await selectRange('This Month');
  await expectSources(initial);
  const invalid = await create('Metrics missing money', 100, 0);
  await prisma.deal.update({ where: { id: invalid.id }, data: { value: null } });
  await expectValue('Forecasted Revenue', money(37000));
  const missingMoneyReport = await fetchReport('range=thisMonth');
  const leadStage = missingMoneyReport.distribution.find(stage => stage.id === stages[0].id);
  await overview.getByRole('listitem', {name:leadStage.name,exact:true}).getByText(`${leadStage.count} deals`, {exact:true}).waitFor();
  assert.equal(await overview.getByText('Unavailable', {exact:true}).count(), 0);
  await http(`/crm/deals/${invalid.id}/stage`, 'PATCH', { stageId: stages[2].id });
  await expectValue('Forecasted Revenue', 'Unavailable');
  await prisma.deal.update({ where: { id: invalid.id }, data: { value: 1234567890.12 } });
  await expectValue('Forecasted Revenue', money(1234604890.12));
  for (const width of [320,375,390,430,768,1024,1440]) {
    await page.setViewportSize({ width, height: 1000 }); await wait(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await prisma.deal.update({ where: { id: invalid.id }, data: { isArchived: true } });
  await expectValue('Forecasted Revenue', money(37000));
  record('Invalid early-stage money preserves Forecast; moving into Qualified and archival refresh it through SSE; long amounts fit');
  await staffPage.getByRole('group', { name: 'Forecast', exact: true }).waitFor();
  reconcile(await fetchReport('range=thisMonth'));

  // Reproduce the reported snapshot with real Deals in this disposable tenant.
  await prisma.deal.updateMany({ where: { tenantId: tenant.id, pipelineId: pipeline.id }, data: { isArchived: true } });
  const snapshotDeals = [];
  for (const [index, count] of [17, 1, 2, 1, 3].entries()) {
    for (let i = 0; i < count; i++) snapshotDeals.push({ ...await create(`Snapshot ${stages[index].name} ${i}`, 100, index), stageId: stages[index].id });
  }
  await expectSources(await fetchReport('range=thisMonth'), staffPage);
  const dealsPage = staffPage;
  const dealErrors = [];
  dealsPage.on('pageerror', error => dealErrors.push(error.message));
  try {
    await dealsPage.goto(`${base}/crm/deals?pipelineId=${pipeline.id}`, { waitUntil: 'domcontentloaded' });
    const boardCounts = () => dealsPage.locator('[aria-label="Deal pipeline"] h3').evaluateAll(headings => headings.map(heading => heading.parentElement.parentElement.parentElement.querySelector('span:last-child')?.textContent.trim()));
    async function compareSnapshot(expected) {
      const rows = await http(`/crm/deals?pipelineId=${pipeline.id}&limit=100`);
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
      assert.deepEqual(stages.map(stage => rows.filter(row => row.stageId === stage.id).length), expected);
      const report = await fetchReport('range=thisMonth');
      assert.deepEqual(currentCounts(report), expected.slice(0, 4));
      await expectSources(report);
      await until(async () => JSON.stringify(await boardCounts()) === JSON.stringify(expected.map(String)), 'Deals board agrees with Dashboard');
      assert.equal(await sources.getByText('Closed Lost', { exact: true }).count(), 0);
      return report;
    }
    await compareSnapshot([17, 1, 2, 1, 3]);
    record('Screenshot fixture matches All Deals and both authorized Dashboard sessions: 17/1/2/1, with 3 Lost excluded');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { localStorage.setItem('app_theme', theme === 'dark' ? 'Dark' : 'Light'); window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, mode: theme === 'dark' ? 'Dark' : 'Light' } })); }, theme);
      await until(() => page.locator('.crm-shell[data-theme-container]').evaluate((element, dark) => element.classList.contains('dark') === dark, theme === 'dark'), 'Snapshot theme applied');
      for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); await wait(250);
        await sources.scrollIntoViewIfNeeded();
        const layout = await sources.evaluate(region => ({ width: innerWidth, rootWidth: document.documentElement.scrollWidth,
          clipped: [...region.querySelectorAll('h3, button')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent) }));
        assert.ok(layout.rootWidth <= width + 1, JSON.stringify(layout));
        assert.deepEqual(layout.clipped, [], JSON.stringify(layout));
        await sources.screenshot({ path: resolve(output, `lead-sources-${theme}-${width}.png`) });
        record(`Lead Source Performance fits ${theme} ${width}px`, layout);
      }
    }
    await http(`/crm/deals/${snapshotDeals[0].id}/stage`, 'PATCH', { stageId: stages[1].id });
    await dealsPage.getByRole('button', { name: 'Refresh', exact: true }).click();
    await compareSnapshot([16, 2, 2, 1, 3]);
    record('Lead to Contacted updates Dashboard through existing reconciliation and Deals through its Refresh control');
    const qualified = snapshotDeals.find(deal => deal.stageId === stages[2].id);
    await http(`/crm/deals/${qualified.id}/stage`, 'PATCH', { stageId: stages[3].id });
    const synced = page.waitForResponse(response => response.url().includes('/reporting/dashboard?') && response.ok());
    await page.getByRole('button', { name: 'Sync Metrics', exact: true }).click();
    assert.equal((await (await synced).json()).data.metrics.currentWon, 2);
    await dealsPage.getByRole('button', { name: 'Refresh', exact: true }).click();
    await compareSnapshot([16, 2, 1, 2, 3]);
    record('Closed Won and Sync Metrics reconcile current stage counts without a second subscription or local counting');
    assert.deepEqual(dealErrors, []);
  } catch (error) {
    await dealsPage.screenshot({ path: resolve(output, 'deals-snapshot-failure.png'), fullPage: true }).catch(() => {});
    error.message += `\nDeals URL: ${dealsPage.url()}\nPage errors: ${JSON.stringify(dealErrors)}\n${await dealsPage.locator('body').innerText().catch(() => '')}`;
    throw error;
  } finally { await dealsPage.close(); }

  await verifySources();
  async function verifySources() {
    const stamp = new Date();
    const longSource = 'A long historical source name that remains accessible when the chart wraps its category labels';
    const sourceFixtures = [['Social Media Advertisement', 1234], ['Referral', 12], [longSource, 10], ['Website', 8], ['Email Campaign', 5], ['Content Marketing', 4], ['Google Ads', 3], ['Direct Mail', 2], ['Others', 1], [null, 2]];
    await prisma.deal.createMany({ data: sourceFixtures.flatMap(([leadSource, count]) => Array.from({ length: count }, (_, index) => ({
      tenantId: tenant.id, pipelineId: pipeline.id, stageId: stages[3].id, title: `Source fixture ${leadSource} ${index}`, leadSource,
      value: 0, currency: 'PHP', createdAt: new Date(+stamp - 3600000), closedAt: stamp,
    }))) });
    const grouped = await fetchReport('range=thisMonth');
    assert.equal(grouped.leadSourcePerformance.sources.length, sourceFixtures.length);
    assert.equal(grouped.leadSourcePerformance.sources[0].won, 1234);
    assert.ok(grouped.leadSourcePerformance.sources.some(row => row.name === 'Not specified'));
    assert.equal(grouped.leadSourcePerformance.sources.filter(row => row.name === 'Others').length, 1);
    assert.equal(grouped.leadSourcePerformance.sources.find(row => row.name === 'Others').won, 1);
    assert.equal(grouped.leadSourcePerformance.sources.reduce((sum, row) => sum + row.won, 0), grouped.metrics.won);
    await page.goto(base + '/dashboard'); await expectSources(grouped);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { localStorage.setItem('app_theme', theme === 'dark' ? 'Dark' : 'Light'); window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, mode: theme === 'dark' ? 'Dark' : 'Light' } })); }, theme);
      await until(() => page.locator('.crm-shell[data-theme-container]').evaluate((shell, dark) => shell.classList.contains('dark') === dark, theme === 'dark'), 'Source theme applied');
      for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); await sources.scrollIntoViewIfNeeded(); await wait(1100);
        const dimensions = await sources.evaluate(region => {
          const canvas = region.querySelector('canvas'), bounds = canvas.getBoundingClientRect();
          return { width: innerWidth, rootWidth: document.documentElement.scrollWidth, chartWidth: bounds.width,
            texts: canvas.__texts ?? [], labels: canvas.__labels ?? [],
            scrollable: (() => { const scroller = region.querySelector('[aria-label="Scrollable lead source chart"]'); return { width: scroller.clientWidth, scrollWidth: scroller.scrollWidth, tabIndex: scroller.tabIndex }; })(),
            sections: ['Pipeline Overview', 'Lead Source Performance'].map(name => { const rect = document.querySelector(`section[aria-label="${name}"]`).getBoundingClientRect(); return { x: rect.x, y: rect.y, bottom: rect.bottom, right: rect.right }; }) };
        });
        assert.ok(dimensions.rootWidth <= width + 1);
        assert.ok(dimensions.scrollable.scrollWidth > dimensions.scrollable.width);
        assert.equal(dimensions.scrollable.tabIndex, 0);
        for (const row of grouped.leadSourcePerformance.sources) {
          const count = dimensions.texts.find(text => text.text === String(row.won) && text.align === 'center' && text.color === (theme === 'dark' ? '#f8fafc' : '#0f172a'));
          assert.ok(count && count.left >= 0 && count.right <= dimensions.chartWidth + 1, JSON.stringify({ row, dimensions }));
          assert.equal(count.color, theme === 'dark' ? '#f8fafc' : '#0f172a');
        }
        assert.ok(dimensions.texts.every(text => text.left >= -1 && text.right <= dimensions.chartWidth + 1), JSON.stringify(dimensions));
        const social = dimensions.texts.find(text => text.text === 'Social Media');
        const advertisement = dimensions.texts.find(text => text.text === 'Advertisement');
        assert.ok(social && advertisement);
        assert.equal(social.x, advertisement.x);
        assert.ok(advertisement.y > social.y);
        const [left, right] = dimensions.sections;
        if (width >= 1024) { assert.ok(Math.abs(left.y - right.y) <= 1); assert.ok(right.x >= left.right); }
        else assert.ok(right.y >= left.bottom);
        await sources.screenshot({ path: resolve(output, `lead-sources-full-${theme}-${width}.png`) });
        record(`All configured sources, centered multiline labels and exact vertical counts scroll inside ${theme} ${width}px cards`, dimensions);
      }
    }
    const pipelineBefore = await overview.innerHTML();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const delayed = async route => {
      if (new URL(route.request().url()).searchParams.get('range') === 'lastMonth') {
        await pending; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Selected range unavailable' } }) });
      } else await route.continue();
    };
    await page.route('**/api/proxy/reporting/dashboard?*', delayed);
    await selectRange('Last Month');
    await page.getByLabel('Loading Dashboard').waitFor();
    assert.equal(await sources.count(), 0);
    release();
    await page.getByRole('alert').filter({ hasText: 'Selected range unavailable' }).waitFor();
    await page.unroute('**/api/proxy/reporting/dashboard?*', delayed);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await sources.getByText('No won deals for this period.', { exact: true }).waitFor();
    assert.equal(await overview.innerHTML(), pipelineBefore);
    record('Range loading and failure hide stale charts; Retry restores the live Pipeline Overview');
  }
}

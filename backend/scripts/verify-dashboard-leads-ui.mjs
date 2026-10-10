// Run through verify-dashboard-browser.mjs --ui-polish using its disposable SQL,
// production frontend, real HttpOnly sessions, HTTPS proxy and SSE subscriptions.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function verifyDashboardLeadsUi({ page, staffPage, base, output, http, prisma, tenant, admin, agent, replacement, pipeline, stages, products, record, until, wait, expectValue, leadsOnly = false }) {
  const widths = [320, 375, 390, 430, 768, 1024, 1440, 1920];
  const revenue = () => page.getByRole('img', { name: /^Revenue Trend by/ });
  const action = () => page.getByRole('heading', { name: 'Action Center', exact: true }).locator('..').locator('..');
  const actionList = () => page.getByRole('region', { name: 'Action Center actions', exact: true });
  const currency = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
  async function layout(label) {
    await wait(400);
    const dimensions = await revenue().evaluate(region => {
      const card = region.parentElement, canvas = region.querySelector('canvas');
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      const list = card.nextElementSibling.querySelector('[aria-label="Action Center actions"]');
      return { width: innerWidth, rootWidth: document.documentElement.scrollWidth, fontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
        region: rect(region), card: rect(card), canvas: rect(canvas), action: rect(card.nextElementSibling),
        list: { ...rect(list), clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth, overflow: getComputedStyle(list).overflowY,
          clippedItems: [...list.querySelectorAll('a')].filter(link => [...link.children].some(child => child.getBoundingClientRect().bottom > link.getBoundingClientRect().bottom - parseFloat(getComputedStyle(link).paddingBottom))).length },
        bottomPadding: parseFloat(getComputedStyle(card).paddingBottom), labels: canvas.__labels ?? [],
        points: canvas.__points ?? [], overflowY: region.scrollHeight > region.clientHeight + 1 };
    });
    assert.ok(dimensions.rootWidth <= dimensions.width + 1, JSON.stringify(dimensions));
    assert.ok(Math.abs(dimensions.canvas.height - dimensions.region.height) <= 1, JSON.stringify(dimensions));
    assert.ok(Math.abs(dimensions.card.bottom - dimensions.region.bottom - dimensions.bottomPadding) <= 1, JSON.stringify(dimensions));
    assert.ok(dimensions.region.height >= 220 && dimensions.canvas.width > 0);
    assert.equal(dimensions.overflowY, false);
    assert.ok(dimensions.canvas.right <= dimensions.width + 1);
    assert.ok(dimensions.labels.some(text => text.startsWith('₱')), JSON.stringify(dimensions.labels));
    assert.equal(dimensions.list.overflow, 'auto');
    assert.ok(dimensions.list.scrollWidth <= dimensions.list.clientWidth);
    assert.equal(dimensions.list.clippedItems, 0, 'Action labels, titles and due dates fit at every width');
    assert.equal(dimensions.list.height, (dimensions.width >= 1024 ? 36.25 : 21.5) * dimensions.fontSize);
    if (dimensions.width >= 1024) {
      assert.ok(Math.abs(dimensions.card.y - dimensions.action.y) <= 1);
      assert.ok(Math.abs(dimensions.card.height - dimensions.action.height) <= 1);
      assert.ok(dimensions.action.x >= dimensions.card.right);
    } else {
      assert.ok(dimensions.action.y >= dimensions.card.bottom);
      assert.ok(dimensions.region.height <= 221, 'Stacked chart keeps its sensible minimum height');
    }
    record(label, dimensions);
    return dimensions;
  }
  async function interval(label, range = 'thisMonth') {
    const response = page.waitForResponse(r => r.url().includes('/reporting/dashboard?') && new URL(r.url()).searchParams.get('revenueInterval') === label.toLowerCase());
    await page.getByRole('button', { name: 'Filter Revenue Trend', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await response;
    await page.getByRole('heading', { name: `Revenue Trend by ${label}`, exact: true }).waitFor();
    const report = await http(`/reporting/dashboard?range=${range}&revenueInterval=${label.toLowerCase()}`);
    assert.equal(report.metrics.totalRevenue, report.trend.reduce((sum, row) => sum + row.revenue, 0));
    assert.equal(report.metrics.won, report.trend.reduce((sum, row) => sum + row.won, 0));
    assert.deepEqual(report.trend.map(row => row.name), report.trend.map(row => row.name).sort());
    return report;
  }
  if (!leadsOnly) {
  await prisma.productInterest.update({ where: { id: products[0].id }, data: { dealValue: 45000 } });
  const won = await http('/crm/deals', 'POST', { title: 'UI polish actual win', pipelineId: pipeline.id, stageId: stages[0].id, productInterestIds: [products[0].id], assignedUserId: agent.id });
  for (const stage of stages.slice(1, 4)) await http(`/crm/deals/${won.id}/stage`, 'PATCH', { stageId: stage.id });
  await expectValue('Total Revenue', currency(45000));
  const single = await http('/reporting/dashboard?range=thisMonth&revenueInterval=month');
  assert.equal(single.trend.length, 1); assert.equal(single.trend[0].revenue, 45000);
  const singleLayout = await layout('Single actual PHP 45,000 observation fills card');
  assert.ok(singleLayout.points.some(point => point.radius === 4), 'Single data point is drawn');
  await wait(1100); // Existing Chart.js value animation must finish before hit testing.
  const singlePoint = await revenue().locator('canvas').evaluate(c => c.__points.find(p => p.radius === 4));
  await revenue().locator('canvas').hover({ position: { x: singlePoint.x, y: singlePoint.y } });
  await until(() => revenue().locator('canvas').evaluate(canvas => canvas.__labels.some(text => text.startsWith('Revenue (PHP):') && text.includes('45,000.00'))), 'Single-point currency tooltip');
  await page.mouse.move(0, 0);
  assert.equal(await page.getByRole('button', { name: 'Export CSV', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Dashboard date range', exact: true }).getAttribute('title'), 'This Month');
  const syncResponse = page.waitForResponse(r => r.url().includes('/reporting/dashboard?'));
  await page.getByRole('button', { name: 'Sync Metrics', exact: true }).click(); await syncResponse;
  await expectValue('Total Revenue', currency(45000));
  record('Dashboard has two header controls; This Month and Sync Metrics work');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const heights = [];
  const tasks = [];
  for (const count of [0, 1, 4, 5, 6, 10]) {
    while (tasks.length < count) tasks.push(await http('/operations/tasks', 'POST', { title: tasks.length === 4 ? 'A long follow-up title that wraps across several lines while the due date remains readable and the complete title is available on the existing record' : `UI polish overdue follow-up ${tasks.length}`, dueDate: new Date(Date.now() - 86400000).toISOString(), priority: 'High', assignedUserId: agent.id }));
    const report = await http('/reporting/dashboard?range=thisMonth');
    await until(async () => await action().getByRole('link').count() === report.actions.length, `${count} task Action Center refresh`);
    if (!count) await action().getByText('All caught up!', { exact: true }).waitFor();
    else assert.equal(report.actions.length, count);
    await actionList().evaluate(list => { list.scrollTop = 0; });
    const slots = await actionList().evaluate(list => {
      const viewport = list.getBoundingClientRect();
      const items = [...list.querySelectorAll('a')].map(link => {
        const item = link.getBoundingClientRect();
        return { height: item.height, top: item.top - viewport.top, bottom: item.bottom - viewport.top, title: link.title,
          contentClipped: [...link.children].some(child => child.getBoundingClientRect().bottom > item.bottom - 12) };
      });
      return { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, items, visible: items.filter(item => item.top >= 0 && item.bottom <= list.clientHeight).length };
    });
    assert.equal(slots.visible, Math.min(count, 5));
    assert.equal(slots.scrollHeight > slots.clientHeight, count > 5);
    assert.ok(slots.items.every(item => item.height === 108 && !item.contentClipped));
    if (count >= 5) assert.equal(slots.items[4].bottom, slots.clientHeight);
    if (count >= 6) assert.ok(slots.items[5].top > slots.clientHeight);
    const size = await layout(`Action Center stable five-slot viewport with ${count} actions`);
    heights.push(size.region.height);
    record(`${count} actions: complete slots and scrolling threshold`, slots);
    await page.screenshot({ path: resolve(output, `dashboard-actions-${count}.png`), fullPage: true });
  }
  assert.ok(heights.every(height => Math.abs(height - heights[0]) <= 1), 'Chart height is independent of action count');
  assert.deepEqual(await actionList().getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))), (await http('/reporting/dashboard?range=thisMonth')).actions.map(row => row.href));
  await actionList().scrollIntoViewIfNeeded();
  const headerBefore = await action().getByRole('heading').boundingBox();
  await actionList().hover(); await page.mouse.wheel(0, 250);
  await until(() => actionList().evaluate(list => list.scrollTop > 0), 'Mouse wheel scrolls only the action list');
  const scrollBefore = await actionList().evaluate(list => list.scrollTop);
  tasks.push(await http('/operations/tasks', 'POST', { title: 'Background action appended below the current viewport', dueDate: new Date(Date.now() + 86400000).toISOString(), priority: 'Low', assignedUserId: agent.id }));
  await until(async () => await actionList().getByRole('link').count() === 11, 'Additional action arrives through SSE');
  assert.equal(await actionList().evaluate(list => list.scrollTop), scrollBefore);
  assert.deepEqual(await action().getByRole('heading').boundingBox(), headerBefore);
  await layout('Background addition preserves card height and scroll position');
  const completedBelowViewport = tasks.splice(tasks.length - 2, 1)[0];
  await http(`/operations/tasks/${completedBelowViewport.id}/complete`, 'PATCH');
  await until(async () => await actionList().getByRole('link').count() === 10, 'Background completion arrives through SSE');
  assert.equal(await actionList().evaluate(list => list.scrollTop), scrollBefore);
  assert.deepEqual(await action().getByRole('heading').boundingBox(), headerBefore);
  await layout('Background completion preserves card height and scroll position');
  await actionList().focus(); await page.keyboard.press('Home');
  await until(() => actionList().evaluate(list => list.scrollTop === 0), 'Keyboard Home scrolls to first action');
  await page.keyboard.press('End');
  await until(() => actionList().evaluate(list => list.scrollTop >= list.scrollHeight - list.clientHeight - 1), 'Keyboard End reaches all actions');
  await actionList().evaluate(list => { list.scrollTop = 0; });
  await actionList().getByRole('link').nth(8).focus(); await page.keyboard.press('Tab');
  assert.equal(await actionList().getByRole('link').last().evaluate(link => document.activeElement === link), true);
  const focused = await actionList().getByRole('link').last().evaluate(link => ({ top: link.getBoundingClientRect().top, bottom: link.getBoundingClientRect().bottom, viewport: { top: link.parentElement.getBoundingClientRect().top, bottom: link.parentElement.getBoundingClientRect().bottom } }));
  assert.ok(focused.top >= focused.viewport.top && focused.bottom <= focused.viewport.bottom + 1);
  await page.screenshot({ path: resolve(output, 'dashboard-actions-scrolled.png') });
  record('Mouse wheel, Home/End, Tab focus, all remaining actions and unchanged header', focused);
  await actionList().evaluate(list => { list.scrollTop = 0; });
  for (const density of ['Small', 'Large', 'Medium']) {
    await page.evaluate(density => { localStorage.setItem('app_font_size', density); window.dispatchEvent(new CustomEvent('themechange')); }, density);
    const expectedFontSize = { Small: 14, Medium: 16, Large: 18 }[density];
    await until(() => page.evaluate(size => parseFloat(getComputedStyle(document.documentElement).fontSize) === size, expectedFontSize), `${density} density applied`);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await actionList().focus(); await actionList().evaluate(list => { list.scrollTop = 0; });
      const visible = await actionList().evaluate(list => [...list.querySelectorAll('a')].filter(link => link.getBoundingClientRect().top >= list.getBoundingClientRect().top && link.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1).length);
      assert.equal(visible, width >= 1024 ? 5 : 3);
      await layout(`${density} font density at ${width}: complete slots without clipped text`);
    }
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await actionList().scrollIntoViewIfNeeded();
  const touchBox = await actionList().boundingBox();
  const touch = await page.context().newCDPSession(page);
  const x = touchBox.x + touchBox.width / 2, startY = touchBox.y + touchBox.height - 30;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
  for (let offset = 20; offset <= 180; offset += 20) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - offset }] }); await wait(20);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(() => actionList().evaluate(list => list.scrollTop > 0), 'Touch swipe scrolls the mobile action list');
  await touch.detach();
  await layout('Mobile touch swipe uses a bounded three-slot list');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await actionList().getByRole('link').last().click();
  await page.waitForURL(url => url.pathname === '/operations/taskboard' && url.searchParams.get('taskId') === tasks.at(-1).id);
  record('Scrolled action retains its existing task record navigation');
  await page.goto(base + '/dashboard');
  await actionList().getByRole('link').last().waitFor();
  for (const label of ['Week', 'Year', 'Month']) {
    const report = await interval(label);
    assert.equal(report.metrics.totalRevenue, 45000);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await layout(`${label} chart responsive ${width}`);
      await revenue().scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, `dashboard-${label.toLowerCase()}-${width}.png`) });
    }
  }
  // Historical observations are created only in this disposable database.
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(new Date());
  const [year, monthNumber] = month.split('-').map(Number);
  for (const [offset, value] of [[1, 20000], [2, 30000]]) {
    const closedAt = new Date(Date.UTC(year, monthNumber - 1 - offset, 10));
    await prisma.deal.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, stageId: stages[3].id, title: `Historical actual observation ${offset}`, value, currency: 'PHP', closedAt, createdAt: new Date(closedAt.getTime() - 86400000), revenueOwnerId: agent.id, revenueOwnerEligible: true, assignedUserId: agent.id, ownerId: agent.id } });
  }
  await page.getByRole('button', { name: 'Dashboard date range', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Last 3 Months', exact: true }).click();
  await expectValue('Total Revenue', currency(95000), false);
  for (const label of ['Week', 'Year', 'Month']) {
    const report = await interval(label, 'last3');
    assert.equal(report.metrics.totalRevenue, 95000);
    if (label === 'Month') { assert.equal(report.trend.length, 3); assert.deepEqual(report.trend.map(row => row.revenue), [30000, 20000, 45000]); }
    for (const width of widths) { await page.setViewportSize({ width, height: 1000 }); await layout(`Multiple observations ${label} responsive ${width}`); }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await revenue().scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, 'dashboard-multiple-months.png') });
  const canvas = revenue().locator('canvas');
  const endpoints = await canvas.evaluate(c => c.__curves);
  assert.ok(endpoints.length > 0, 'Multiple observations form a real curve');
  let tooltip = false;
  // The existing area chart has invisible multi-point markers and a small hit
  // radius. Probe the real curve endpoints with subpixel rounding tolerance.
  for (const endpoint of endpoints) {
    for (const delta of [-1, 0, 1]) {
      await canvas.hover({ position: { x: endpoint.x + delta, y: endpoint.y + delta } });
      await wait(250);
      tooltip = await canvas.evaluate(c => c.__labels.some(text => text.startsWith('Revenue (PHP):')));
      if (tooltip) break;
    }
    if (tooltip) break;
  }
  record('Multiple-observation tooltip probe', { endpoints, labels: await canvas.evaluate(c => c.__labels) });
  assert.ok(tooltip, 'Multiple-observation tooltip');
  await page.screenshot({ path: resolve(output, 'dashboard-multiple-tooltip.png') });
  record('Chronological multiple observations, actual aggregates and tooltips');
  await page.mouse.move(0, 0);
  const csv = await page.request.get(base + '/api/proxy/reporting/dashboard/export?range=last3');
  assert.ok(csv.ok()); assert.match(csv.headers()['content-type'], /text\/csv/);
  record('Reporting CSV endpoint remains intact');
  for (const task of tasks) await http(`/operations/tasks/${task.id}/complete`, 'PATCH');
  await until(async () => await action().getByRole('link').count() === 0, 'Completed tasks disappear automatically');
  const completed = await layout('Card and chart retain stable height after all actions are completed');
  assert.ok(Math.abs(completed.region.height - heights[0]) <= 1);
  await page.goto(base + '/reporting');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).waitFor();
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadWait; assert.equal(await download.failure(), null);
  record('Reports retains its CSV download');
  }

  const leads = [];
  for (let i = 0; i < 12; i++) leads.push(await http('/crm/leads', 'POST', { firstName: `Polish${String(i).padStart(2, '0')}`, lastName: 'Lead', email: `polish${i}@example.test`, phone: '+639123456789', companyName: `Company ${i}`, status: i === 0 ? 'Hot' : 'Warm', source: 'Website', assignedUserId: i % 2 ? replacement.id : agent.id }));
  await expectValue('Total Leads', '12');
  await page.goto(base + '/crm/leads');
  const grid = page.getByRole('region', { name: 'Leads data grid', exact: true });
  await grid.getByRole('button', { name: 'Row actions' }).first().waitFor();
  const search = page.getByPlaceholder('Search leads...', { exact: true });
  const rows = () => grid.locator('tbody tr');
  const summary = expected => until(() => grid.getByText(`${expected} total records`, { exact: true }).isVisible(), `Lead count ${expected}`);
  for (const [tab, count] of [['All Leads', 12], ['My Leads', 6], ['Active Leads', 12]]) {
    const tabPage = tab === 'My Leads' ? staffPage : page;
    if (tab === 'My Leads') await tabPage.goto(base + '/crm/leads');
    const tabGrid = tabPage.getByRole('region', { name: 'Leads data grid', exact: true });
    await tabPage.getByRole('button', { name: tab, exact: true }).click();
    await until(() => tabGrid.getByText(`${count} total records`, { exact: true }).isVisible(), `${tab} count ${count}`);
    assert.equal(await tabGrid.getByRole('columnheader', { name: 'Actions', exact: true }).count(), 0);
    assert.equal(await tabGrid.getByRole('button', { name: 'Email', exact: true }).count(), 0);
    for (const width of widths) {
      await tabPage.setViewportSize({ width, height: 1000 }); await wait(250);
      const dimensions = await tabGrid.evaluate(region => {
        const table = region.querySelector('table'), scroll = table.parentElement;
        const headerCount = table.querySelectorAll('thead th').length;
        return { width: innerWidth, rootWidth: document.documentElement.scrollWidth, right: region.getBoundingClientRect().right, headerCount, widths: table.querySelectorAll('col').length, rowColumns: table.querySelector('tbody tr')?.children.length, lastHeader: table.querySelector('thead th:last-child')?.textContent, horizontalScroll: scroll.scrollWidth > scroll.clientWidth, maxScroll: scroll.scrollWidth - scroll.clientWidth };
      });
      assert.ok(dimensions.rootWidth <= width + 1); assert.ok(dimensions.right <= width + 1);
      assert.equal(dimensions.headerCount, dimensions.widths); assert.equal(dimensions.rowColumns, dimensions.headerCount);
      assert.equal(dimensions.lastHeader?.trim(), 'Source');
      await tabGrid.locator('table').evaluate(table => { table.parentElement.scrollLeft = table.parentElement.scrollWidth; });
      if (dimensions.horizontalScroll) assert.ok(await tabGrid.locator('table').evaluate(table => table.parentElement.scrollLeft) > 0);
      await tabGrid.locator('table').evaluate(table => { table.parentElement.scrollLeft = 0; });
      record(`${tab} responsive ${width}`, dimensions);
      if (tab === 'All Leads') { await grid.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, `leads-${width}.png`) }); }
    }
    await tabPage.setViewportSize({ width: 1440, height: 1000 });
    await tabGrid.getByRole('button', { name: 'Row actions' }).first().click();
    await tabPage.getByRole('menuitem', { name: 'Send Email', exact: true }).waitFor();
    await tabPage.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'All Leads', exact: true }).click(); await summary(12);
  await search.fill('polish0@example.test'); await summary(1);
  const selection = grid.getByRole('checkbox', { name: `Select record ${leads[0].id}`, exact: true });
  await selection.check(); assert.equal(await selection.isChecked(), true); await selection.uncheck();
  await grid.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('heading', { name: 'Polish00 Lead', exact: true }).waitFor();
  await page.goto(base + '/crm/leads'); await search.waitFor(); await summary(12);
  await page.getByRole('button', { name: 'Filter Leads', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Filter by Status: Hot', exact: true }).check(); await summary(1);
  await page.getByRole('checkbox', { name: 'Filter by Status: Hot', exact: true }).uncheck(); await summary(12);
  await page.getByRole('button', { name: 'Close filters', exact: true }).click();
  await grid.getByRole('columnheader', { name: /Name/ }).click();
  await until(async () => (await rows().first().innerText()).includes('Polish00'), 'Ascending server sort');
  await grid.getByRole('columnheader', { name: /Name/ }).click();
  await until(async () => (await rows().first().innerText()).includes('Polish11'), 'Descending server sort');
  await page.getByRole('button', { name: 'Records per page', exact: true }).click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await page.getByText('Page 1 of 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByText('Page 2 of 2', { exact: true }).waitFor(); await until(async () => await rows().count() === 2, 'Second page records');
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await page.getByText('Page 1 of 2', { exact: true }).waitFor();
  record('Lead search, status filter, sorting, selection, details and pagination');
  await search.fill('polish0@example.test'); await summary(1);
  await http(`/crm/leads/${leads[0].id}`, 'PUT', { status: 'Cold', assignedUserId: replacement.id, companyName: 'Edited Company' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await grid.getByText('Edited Company', { exact: true }).first().waitFor();
  assert.equal(await grid.getByText('Edited Company', { exact: true }).count(), 2); // Name subtitle and Company column.
  await grid.getByText('Cold', { exact: true }).waitFor();
  await grid.getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menuitem', { name: 'Send Email', exact: true }).click();
  await page.waitForURL(/\/inbox/); // Existing compose handoff consumes the query.
  const compose = page.getByRole('dialog', { name: 'Compose email', exact: true });
  await compose.waitFor(); assert.equal(await compose.getByLabel('To', { exact: true }).inputValue(), 'polish0@example.test');
  record('Edited Lead refresh, reassignment, status and existing email compose handoff');
  await staffPage.goto(base + '/dashboard');
  await staffPage.getByRole('heading', { name: 'Revenue Trend by Month', exact: true }).waitFor();
}

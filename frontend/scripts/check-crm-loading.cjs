// Run against the local dev server with mock auth/data flags set to false.
// All API responses are intercepted fixtures; no backend or stored session is used.
// Set PLAYWRIGHT_MODULE / CHROME_PATH when using an external Playwright runtime.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const output = process.env.TEST_OUTPUT_DIR;
const widths = [320, 375, 768, 1440];
const user = { id: 'test-user', tenantId: 'test-tenant', role: 'Client Admin', firstName: 'Test', lastName: 'User', email: 'test@example.com', status: 'ACTIVE', tenantStatus: 'ACTIVE', tenantName: 'Test CRM', onboardingCompletedAt: '2026-01-01' };
const rows = module => [{ id: 'test-row', tenantId: user.tenantId, name: 'Fixture Account', firstName: 'Fixture', lastName: 'Person', leadPerson: 'Fixture Person', contactPerson: 'Fixture Person', displayName: 'Fixture Person', status: 'WARM', email: 'fixture@example.com', createdAt: '2026-01-01', isArchived: false }];
const list = data => ({ success: true, data, meta: { total: data.length, page: 1, pageSize: 25, limit: 100, totalPages: 1, hasMore: false } });
const campaigns = ['SENT', 'FAILED', 'DRAFT'].map((status, i) => ({ id: `campaign-${i}`, name: `Fixture ${status}`, status, type: i === 1 ? 'SMS' : 'EMAIL', audienceSource: 'LEADS', createdAt: '2026-01-01', sentCount: 2, openedCount: 1, clickedCount: 0, isArchived: false }));

async function fixtures(page, module) {
  const state = { pending: [], hold: true, fail: false, requests: 0 };
  await page.route('**/api/proxy/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace('/api/proxy', '');
    let body = list([]);
    if (endpoint === '/auth/me') body = { success: true, data: { user } };
    else if (endpoint.includes('/permissions')) body = { success: true, data: endpoint.includes('/users/') ? {} : [] };
    else if (endpoint.startsWith('/preferences/columns/')) body = { success: true, data: { columns: [] } };
    else if (endpoint.startsWith('/preferences/table/')) body = { success: true, data: { pageSize: 25, viewMode: 'wrap', sort: null, viewType: 'table' } };
    else if (endpoint === '/marketing/campaigns/metrics') body = { success: true, data: { activeCampaigns: 0, sent: 4, opened: 2, clicked: 0 } };
    else if (endpoint === '/marketing/campaigns') body = list(campaigns);
    else if (/^\/crm\/(leads|contacts|accounts)$/.test(endpoint)) {
      body = list(rows(module));
      const isTable = endpoint === `/crm/${module}` && (url.searchParams.get('pageSize') === '25' || (module === 'contacts' && url.searchParams.get('limit') === '100'));
      if (isTable) {
        state.requests++;
        if (state.hold) await new Promise(resolve => state.pending.push(resolve));
        if (state.fail) return route.fulfill({ status: 500, json: { error: 'Fixture refresh failure' } });
      }
    }
    await route.fulfill({ json: body });
  });
  state.release = () => { state.hold = false; state.pending.splice(0).forEach(resolve => resolve()); };
  return state;
}

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const main = document.querySelector('main');
    return { width: innerWidth, document: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScroll: main.scrollWidth };
  });
  assert.ok(dimensions.document <= dimensions.width + 1, JSON.stringify(dimensions));
  assert.ok(dimensions.mainScroll <= dimensions.mainWidth + 1, JSON.stringify(dimensions));
}

async function screenshot(page, name) {
  if (!output) return;
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    for (const module of ['leads', 'contacts', 'accounts']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(30000);
      const state = await fixtures(page, module);
      await page.goto(`${base}/crm/${module}`, { timeout: 180000 });
      const loading = page.getByRole('status').filter({ hasText: `Loading ${module}...` });
      await loading.waitFor();
      assert.equal(await loading.count(), 1);
      const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
      assert.ok(await refresh.isDisabled());
      await page.getByRole('textbox', { name: new RegExp(`Search ${module}`, 'i') }).waitFor();
      state.release();
      await loading.waitFor({ state: 'hidden' });
      await page.getByText(module === 'accounts' ? 'Fixture Account' : 'Fixture', { exact: module === 'contacts' }).first().waitFor();
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 640 ? 642 : 900 });
        state.hold = true;
        const before = state.requests;
        await refresh.click();
        await loading.waitFor();
        assert.ok(await refresh.isDisabled());
        await refresh.evaluate(button => { button.click(); button.click(); });
        assert.equal(state.requests, before + 1, `${module}: duplicate refresh`);
        const size = await loading.locator('.animate-spin').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
        assert.equal(size.width, 16);
        assert.equal(size.height, 16);
        await noOverflow(page);
        await screenshot(page, `${module}-${width}-loading`);
        state.release();
        await loading.waitFor({ state: 'hidden' });
        await noOverflow(page);
      }
      state.fail = true;
      await refresh.click();
      await page.getByText('Fixture refresh failure', { exact: true }).first().waitFor();
      await loading.waitFor({ state: 'hidden' });
      assert.ok(await refresh.isEnabled());
      await page.getByText(module === 'accounts' ? 'Fixture Account' : 'Fixture', { exact: module === 'contacts' }).first().waitFor();
      console.log(`PASS ${module}: initial load, refresh at four widths, duplicate guard, failure retains rows`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await fixtures(page, 'campaigns');
    await page.goto(`${base}/marketing/campaigns`, { timeout: 180000 });
    const filter = page.getByRole('button', { name: 'Filter campaigns' });
    await filter.waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 640 ? 642 : 900 });
      const add = page.getByRole('button', { name: 'Create campaign', exact: true });
      assert.equal(await add.count(), 1);
      assert.equal(await add.locator('span').isVisible(), width >= 640);
      assert.equal(await filter.locator('span').isVisible(), width >= 640);
      const searchBox = await page.getByRole('textbox', { name: 'Search campaigns', exact: true }).boundingBox();
      const filterBox = await filter.boundingBox();
      assert.ok(Math.abs(searchBox.y - filterBox.y) < 2);
      assert.ok(searchBox.x + searchBox.width <= filterBox.x);
      await noOverflow(page);
      await screenshot(page, `campaigns-${width}`);
      await filter.click();
      const panel = page.locator('aside:visible').filter({ hasText: 'Filter by' });
      await panel.waitFor();
      await page.waitForTimeout(400); // Wait for the existing rail transition to finish.
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height);
      if (width >= 640) {
        const table = await page.locator('table').boundingBox();
        assert.ok(table.x >= box.x + box.width);
      }
      await panel.getByRole('checkbox', { name: 'Filter by Failed', exact: true }).check();
      await page.getByText('Fixture FAILED', { exact: true }).waitFor();
      assert.equal(await page.getByText('Fixture SENT', { exact: true }).count(), 0);
      await panel.getByRole('button', { name: 'Clear filters' }).click();
      await page.getByText('Fixture SENT', { exact: true }).waitFor();
      await noOverflow(page);
      await screenshot(page, `campaigns-${width}-filters`);
      await panel.getByRole('button', { name: 'Close filters' }).click();
      await panel.waitFor({ state: 'hidden' });
    }
    const sentColor = await page.getByText('sent', { exact: true }).evaluate(el => getComputedStyle(el).color);
    const failedColor = await page.getByText('failed', { exact: true }).evaluate(el => getComputedStyle(el).color);
    assert.notEqual(sentColor, failedColor);
    await page.setViewportSize({ width: 320, height: 900 });
    for (const [name, tooltip] of [['Create campaign', 'Create Campaign'], ['Filter campaigns', 'Filter']]) {
      await page.getByRole('button', { name, exact: true }).focus();
      await page.getByRole('tooltip', { name: tooltip, exact: true }).waitFor();
    }
    await filter.click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Filters' }).waitFor({ state: 'hidden' });
    assert.ok(await filter.evaluate(el => el === document.activeElement));
    console.log('PASS campaigns: four widths, inline toolbar, mobile icons/tooltips, bounded rail, filtering/clear, status colors, Escape/focus return');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

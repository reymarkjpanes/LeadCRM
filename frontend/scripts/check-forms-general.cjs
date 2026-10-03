// Local UI checks with intercepted API fixtures; never modifies a live account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const output = process.env.TEST_OUTPUT_DIR;
const user = { id: 'test-user', tenantId: 'test-tenant', role: 'Client Admin', firstName: 'Test', lastName: 'User', email: 'test@example.com', status: 'ACTIVE', tenantStatus: 'ACTIVE', tenantName: 'Test CRM', onboardingCompletedAt: '2026-01-01' };
const organization = { id: user.tenantId, name: 'Test CRM', industry: 'Software', email: 'test@example.com', phone: '+63281233488', domain: 'example.com', address: 'Manila' };
const forms = ['published', 'draft'].map((status, i) => ({ id: `form-${i}`, tenantId: user.tenantId, name: i ? 'Draft form' : 'Contact Us', status, fields: [], design: {}, settings: {}, revision: 1, publishedVersion: i ? 0 : 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' }));
async function fixtures(page) {
  const state = { deletes: 0, unpublishes: 0, saved: null, release: null, fail: false };
  await page.route('**/api/proxy/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/proxy', '');
    const method = route.request().method();
    let body = { success: true, data: [], meta: { total: 2, page: 1, limit: 100, hasMore: false } };
    if (endpoint === '/auth/me') body.data = { user };
    else if (endpoint.includes('/permissions')) body.data = endpoint.includes('/users/') ? {} : [];
    else if (endpoint === '/administration/organization-settings') {
      if (method === 'PATCH') state.saved = route.request().postDataJSON();
      body.data = { ...organization, ...state.saved };
    } else if (endpoint === '/marketing/forms') body.data = forms;
    else if (endpoint.endsWith('/unpublish')) { state.unpublishes++; body.data = { ...forms[0], status: 'draft' }; }
    else if (endpoint.startsWith('/marketing/forms/') && method === 'DELETE') {
      state.deletes++;
      await new Promise(resolve => { state.release = resolve; });
      if (state.fail) return route.fulfill({ status: 409, json: { message: 'Published forms must be unpublished before they can be deleted.', error: 'Published forms must be unpublished before they can be deleted.' } });
      body.data = null;
    }
    await route.fulfill({ json: body });
  });
  return state;
}
async function checkBounds(page, locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1, JSON.stringify(box));
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, main: document.querySelector('main').clientWidth, scroll: document.querySelector('main').scrollWidth }));
  assert.ok(overflow.document <= overflow.width + 1 && overflow.scroll <= overflow.main + 1, JSON.stringify(overflow));
}
async function screenshot(page, name) {
  if (!output) return;
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const state = await fixtures(page);
    await page.goto(`${base}/settings?tab=org-general`, { timeout: 180000 });
    const card = page.getByRole('region', { name: 'Organization Details' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const phone = page.getByLabel('Phone', { exact: true });
    assert.equal(await phone.inputValue(), '(28) 123-3488');
    await phone.fill('letters');
    assert.equal(await phone.inputValue(), '(28) 123-3488');
    await page.getByText('Enter a valid Philippine telephone number.').waitFor();
    await phone.fill('123');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    assert.equal(state.saved, null);
    await phone.fill('(28) 123-3488');
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 640 ? 900 : 1000 });
      await page.waitForTimeout(350); // Existing navigation uses a 200ms responsive transition.
      await checkBounds(page, card);
      const address = await page.getByLabel('Office Address').boundingBox();
      const cardBox = await card.boundingBox();
      assert.ok(address.width > cardBox.width - 60);
      const name = await page.getByLabel('Organization Name').boundingBox();
      const industry = await page.getByLabel('Industry', { exact: true }).boundingBox();
      assert.equal(Math.abs(name.y - industry.y) < 2, width >= 1024);
      await checkBounds(page, phone);
      await page.getByRole('button', { name: 'Save Changes' }).scrollIntoViewIfNeeded();
      await checkBounds(page, page.getByRole('button', { name: 'Save Changes' }));
      await screenshot(page, `general-${width}`);
    }
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await card.getByRole('button', { name: 'Edit', exact: true }).waitFor();
    assert.equal(state.saved.phone, '+63281233488');
    console.log('PASS General: four widths, full-width address, column breakpoints, fixed prefix, inline validation, normalized save');
    await page.goto(`${base}/settings?tab=forms`);
    await page.getByRole('button', { name: 'Unpublish', exact: true }).waitFor().catch(async error => {
      console.error(await page.locator('body').innerText());
      throw error;
    });
    const published = page.locator('article').filter({ hasText: 'Contact Us' });
    const draft = page.locator('article').filter({ hasText: 'Draft form' });
    assert.ok(await published.getByText('Published', { exact: true }).evaluate(el => el.classList.contains('text-blue-700')));
    assert.ok(await draft.getByText('Draft', { exact: true }).evaluate(el => el.classList.contains('text-slate-700')));
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 640 ? 900 : 1000 });
      await page.waitForTimeout(350);
      await published.getByRole('button', { name: 'Row actions', exact: true }).click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      assert.ok(await menu.getByRole('menuitem', { name: 'Delete', exact: true }).isDisabled());
      await menu.getByText('Unpublish this form before deleting it.').waitFor();
      await checkBounds(page, menu);
      await screenshot(page, `published-form-${width}`);
      await page.keyboard.press('Escape');
      await draft.getByRole('button', { name: 'Row actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await dialog.waitFor();
      await checkBounds(page, dialog);
      await screenshot(page, `delete-form-${width}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(state.deletes, 0);
    }
    await published.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await published.getByText('Draft', { exact: true }).waitFor();
    assert.equal(state.unpublishes, 1);
    await published.getByRole('button', { name: 'Row actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Delete Form', exact: true });
    await confirm.click();
    await page.waitForFunction(() => document.querySelector('[role=alertdialog] button:last-child')?.disabled);
    await confirm.evaluate(button => { button.click(); button.click(); });
    assert.equal(state.deletes, 1);
    state.release();
    await published.waitFor({ state: 'hidden' });
    await draft.waitFor();
    console.log('PASS Forms: four widths, status colors, disabled Delete/helper, confirmation Cancel, Unpublish, duplicate guard and successful deletion');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

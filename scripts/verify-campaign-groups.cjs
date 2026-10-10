const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { homedir } = require('node:os');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), process.env.PLAYWRIGHT_NODE_PATH || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node')] }));
const out = path.resolve('data/outputs/campaign-groups'); fs.mkdirSync(out, { recursive: true });
const base = 'http://localhost:3108';
const user = { id: 'qa-admin', tenantId: 'qa-tenant', role: 'Client Admin', status: 'ACTIVE', firstName: 'Local', lastName: 'QA', email: 'qa@camxian.com', mustChangePassword: false, onboardingCompletedAt: '2026-01-01T00:00:00Z', onboardingStep: 3, tenantStatus: 'ACTIVE', tenantName: 'QA Workspace' };
const member = { ...user, id: 'julie', firstName: 'Julie Ann', lastName: 'Tiron', email: 'julie@example.test', role: 'Sales Marketing' };
const campaign = { id: 'campaign', tenantId: user.tenantId, name: 'Welcome Message', type: 'EMAIL', status: 'SENT', targetAudience: { name: 'Biometrics - lead' }, recipientCount: 4, sentCount: 4, openedCount: 3, clickedCount: 1, engagement: 75, deliveredCount: 3, bouncedCount: 1, failedCount: 0, sentAt: '2026-10-02T02:10:00Z', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T02:10:00Z' };
const recipients = [
  { id: 'a', name: 'Doris Testing', email: 'doris@example.com', deliveryStatus: 'Delivered', opened: true, clicked: false },
  { id: 'b', name: 'Tiron Julieann', email: 'tiron@example.com', deliveryStatus: 'Delivered', opened: true, clicked: false },
  { id: 'c', name: 'Mara Santos', email: 'mara@example.com', deliveryStatus: 'Bounced', opened: false, clicked: false },
  { id: 'd', name: 'Luis Reyes', email: 'luis@example.com', deliveryStatus: 'Delivered', opened: true, clicked: true },
].map(row => ({ ...row, lastActivity: '2026-10-02T03:13:00Z', failureReason: null }));
let groups = [{ id: 'sales', tenantId: user.tenantId, name: 'Sales', members: [{ id: 'membership', userId: member.id, user: member }], createdAt: campaign.createdAt, updatedAt: campaign.createdAt }];
const requests = [], checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'); const p = url.pathname.replace('/api/v1', '');
  requests.push({ path: p, method: req.method });
  res.setHeader('Content-Type', 'application/json');
  if (!(req.headers.cookie || '').includes('leadcrm_token=local-campaign-groups-qa')) { res.statusCode = 401; res.end(JSON.stringify({ error: 'Authentication required' })); return; }
  let input = ''; for await (const chunk of req) input += chunk; const body = input ? JSON.parse(input) : {};
  let data = [], meta = { total: 0, totalPages: 1, page: 1, limit: 25, hasMore: false };
  if (p === '/auth/me') data = { user };
  else if (p.endsWith('/permissions')) data = p.includes('/users/') ? {} : [];
  else if (p === '/administration/users') { data = [user, member]; meta.total = 2; }
  else if (p === '/administration/roles') { await delay(4500); data = [{ id: 'admin', tenantId: user.tenantId, name: 'Client Admin', isSystemRole: true, description: 'Manages team members, roles, and CRM data.', permissions: [], userCount: 1 }, { id: 'staff', tenantId: user.tenantId, name: 'Sales Marketing', isSystemRole: false, description: 'Works with customer relationships and campaigns.', permissions: [], userCount: 1 }]; }
  else if (p === '/marketing/campaigns') { data = [campaign]; meta.total = 1; }
  else if (p === '/marketing/campaigns/metrics') data = { activeCampaigns: 0, sent: 4, opened: 3, clicked: 1 };
  else if (p === '/marketing/campaigns/campaign/report') { await delay(650); data = { ...campaign, recipients, topLinks: [{ url: 'https://camxian.com/cctv-surveillance-system', uniqueClicks: 1, totalClicks: 1, clickRate: 25, lastClicked: '2026-10-02T03:13:00Z' }] }; }
  else if (p === '/administration/groups') {
    if (req.method === 'POST') { if (!body.name?.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Name is required.' })); return; } const group = { id: `group-${groups.length}`, tenantId: user.tenantId, name: body.name.trim(), members: [], createdAt: campaign.createdAt, updatedAt: campaign.createdAt }; groups.push(group); data = group; }
    else { await delay(700); data = groups; }
  } else if (p.startsWith('/administration/groups/')) {
    const [, id, tail, userId] = p.match(/^\/administration\/groups\/([^/]+)(?:\/(members)(?:\/([^/]+))?)?$/) || [];
    const group = groups.find(row => row.id === id);
    if (tail === 'members' && req.method === 'POST') { if (!group.members.some(row => row.userId === body.userId)) group.members.push({ id: `member-${body.userId}`, userId: body.userId, user: [user, member].find(row => row.id === body.userId) }); }
    else if (tail === 'members' && req.method === 'DELETE') group.members = group.members.filter(row => row.userId !== userId);
    else if (req.method === 'PUT') { group.name = body.name.trim(); data = group; }
    else if (req.method === 'DELETE') { if (group.members.length) { res.statusCode = 409; res.end(JSON.stringify({ error: 'Remove all members from this group before deleting it.' })); return; } groups = groups.filter(row => row.id !== id); }
  } else if (p.startsWith('/preferences/')) data = { columns: [], pageSize: 25, viewMode: 'wrap', sort: null, viewType: 'table' };
  else if (p === '/integrations/gmail/status') { res.end(JSON.stringify({ isConnected: false })); return; }
  res.end(JSON.stringify({ success: true, data, meta }));
});
let browser, qaPage;
(async () => {
  await new Promise(resolve => server.listen(4108, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: 'Asia/Manila' });
  await context.addCookies([{ name: 'leadcrm_token', value: 'local-campaign-groups-qa', url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage(); qaPage = page; page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const check = async label => {
    if (label === 'group-skeleton') await delay(250); // Let the existing tab entrance animation settle.
    const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(sizes.scroll <= sizes.width + 1, `${label}: overflow ${JSON.stringify(sizes)}`); checks.push({ label, ...sizes });
    await page.screenshot({ path: path.join(out, `${label}-${sizes.width}.png`), fullPage: true });
  };
  const responsive = async label => { for (const width of [1440, 768, 390, 375, 320]) { await page.setViewportSize({ width, height: 960 }); await delay(250); await check(label); } };
  const focusContained = async role => {
    const panel = page.getByRole(role);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
      assert(await panel.evaluate(element => element.contains(document.activeElement)), `${role}: focus escaped`);
    }
    checks.push({ label: `${role}-focus-trap`, width: page.viewportSize().width });
  };
  await page.goto(base + '/marketing/campaigns'); await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Row actions' }).waitFor(); await responsive('campaign-list');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: /Create Campaign/ }).click(); await page.getByRole('heading', { name: 'Campaigns', exact: true }).waitFor({ state: 'hidden' });
  checks.push({ label: 'create-campaign-flow', opened: !await page.getByRole('heading', { name: 'Campaigns', exact: true }).count() });
  await page.goto(base + '/marketing/campaigns'); await page.getByRole('button', { name: 'Row actions' }).click(); await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByText('Doris Testing', { exact: true }).waitFor();
  await responsive('campaign-report');
  for (const width of [1440, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.getByRole('button', { name: 'Filter recipients' }).click();
    const menu = page.getByRole('menu', { name: 'Recipient status filters' }); const box = await menu.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width, 'Recipient filter clipped');
    await page.getByRole('menuitemradio', { name: 'Clicked', exact: true }).click(); await page.getByText('1 of 4 recipients', { exact: true }).waitFor();
    await page.getByLabel('Search recipients', { exact: true }).fill('LUIS@EXAMPLE'); await page.getByText('Luis Reyes', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByText('Luis Reyes', { exact: true }).waitFor();
    await page.getByLabel('Search recipients', { exact: true }).fill(''); await page.getByRole('button', { name: 'Filter recipients' }).click(); await page.getByRole('menuitemradio', { name: 'All recipients', exact: true }).click();
    for (const name of ['Recipient performance', 'Top links clicked']) {
      const region = page.getByRole('region', { name: `${name} table`, exact: true });
      await region.scrollIntoViewIfNeeded();
      const scroll = await region.locator(':scope > div').first().evaluate(element => {
        element.scrollLeft = element.scrollWidth;
        return { client: element.clientWidth, content: element.scrollWidth, left: element.scrollLeft };
      });
      if (width <= 768) assert(scroll.left > 0, `${name}: table cannot scroll`);
      checks.push({ label: `${name}-table-scroll`, width, ...scroll });
      await page.screenshot({ path: path.join(out, `${name.toLowerCase().replaceAll(' ', '-')}-scrolled-${width}.png`) });
      await region.locator(':scope > div').first().evaluate(element => { element.scrollLeft = 0; });
      await page.screenshot({ path: path.join(out, `${name.toLowerCase().replaceAll(' ', '-')}-${width}.png`) });
    }
  }
  await page.goto(base + '/settings?tab=roles'); await page.getByRole('status', { name: 'Loading roles and permissions' }).waitFor(); await check('role-skeleton');
  await page.getByRole('heading', { name: 'Client Admin', exact: true }).waitFor(); await responsive('roles');
  // Revisit while requests are delayed to inspect skeleton grids at every width.
  for (const width of [1440, 768, 390, 375, 320]) { await page.setViewportSize({ width, height: 960 }); await page.reload(); await page.getByRole('status', { name: 'Loading roles and permissions' }).waitFor(); await check('role-skeleton'); await page.getByRole('heading', { name: 'Client Admin', exact: true }).waitFor(); }
  await page.goto(base + '/settings?tab=users'); await page.getByRole('button', { name: 'Groups', exact: true }).click(); await page.getByRole('status', { name: 'Loading groups', exact: true }).waitFor(); await check('group-skeleton');
  await page.getByRole('button', { name: 'Open Sales', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: /Filter groups/ }).count(), 0);
  await responsive('groups');
  for (const width of [1440, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.reload();
    await page.getByRole('button', { name: 'Groups', exact: true }).click();
    await page.getByRole('status', { name: 'Loading groups', exact: true }).waitFor(); await check('group-skeleton');
    await page.getByRole('button', { name: 'Open Sales', exact: true }).waitFor();
  }
  await page.getByLabel('Search groups', { exact: true }).fill('missing'); await page.getByText('No groups match your search.', { exact: true }).waitFor();
  await page.getByLabel('Search groups', { exact: true }).fill('sales');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByRole('button', { name: 'Open Sales', exact: true }).waitFor();
  await page.getByLabel('Search groups', { exact: true }).fill('');
  await page.getByRole('button', { name: 'New Group', exact: true }).click(); await responsive('new-group-modal');
  await focusContained('dialog');
  const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: /^Name/ }).fill('   '); await dialog.getByRole('button', { name: 'Create Group' }).click(); await page.getByText('Name is required.', { exact: true }).waitFor();
  await dialog.getByRole('textbox', { name: /^Name/ }).fill(' Browser group '); await dialog.getByRole('button', { name: 'Create Group' }).click(); await page.getByRole('heading', { name: 'Browser group', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit group', exact: true }).click(); await page.getByRole('dialog').getByRole('textbox', { name: /^Name/ }).fill('Renamed browser group');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click(); await page.getByRole('heading', { name: 'Renamed browser group', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add Members', exact: true }).click(); await page.getByLabel('Select Julie Ann Tiron').check(); await page.getByRole('dialog').getByRole('button', { name: 'Add Members', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Julie Ann Tiron', exact: true }).waitFor(); await responsive('group-members');
  await page.getByLabel('Search members...', { exact: true }).fill('Sales Marketing'); await page.getByText('Julie Ann Tiron', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Group actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Delete Group', exact: true }).click(); await page.getByText('Remove all members from this group before deleting it.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove Julie Ann Tiron', exact: true }).click(); await responsive('remove-member-dialog');
  await focusContained('alertdialog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Julie Ann Tiron', exact: true }).click(); await page.getByRole('button', { name: 'Remove Member', exact: true }).click(); await page.getByText('Member removed successfully.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Group actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Delete Group', exact: true }).click(); await responsive('delete-group-dialog');
  await focusContained('alertdialog');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Group', exact: true }).click(); await page.getByText('Group deleted successfully.', { exact: true }).waitFor();
  assert.deepEqual(errors, []); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, requests, errors }, null, 2)); console.log(`Passed ${checks.length} browser/layout checks; screenshots saved to ${out}`);
})().catch(async error => { console.error(error); if (qaPage) { await qaPage.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); fs.writeFileSync(path.join(out, 'failure.txt'), await qaPage.locator('body').innerText()); } process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.close(); });

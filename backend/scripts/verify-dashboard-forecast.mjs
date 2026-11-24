import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// Extends the existing disposable DB/API/proxy/browser harness; never uses configured data.
export async function verifyDashboardForecast({ page, session, prisma, http, tenant, agent, replacement, pipeline, stages,
  base, output, issueAuthSession, setAcceptanceTheme, record, until, wait }) {
  const extraSessions = [];
  const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
  const current = await http('/reporting/dashboard?range=thisMonth');
  const today = current.period.end;
  const future = new Date(`${Number(today.slice(0, 4)) + 2}-01-01T00:00:00Z`);
  async function role(name, deals = true) {
    return prisma.roleDefinition.create({ data: { tenantId: tenant.id, name, permissions: { create: [
      { module: 'dashboard', canView: true },
      ...(deals ? [{ module: 'deals', canView: true, canViewAll: true, canViewMy: true }] : []),
    ] } } });
  }
  const [managerRole, associateRole, customRole, deniedRole] = await Promise.all([
    role('Sales Admin'), role('Sales Associate'), role('Forecast custom'), role('Dashboard only', false),
  ]);
  async function assigned(user, definition) {
    await prisma.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: definition.id } });
    return prisma.user.update({ where: { id: user.id }, data: { role: definition.name } });
  }
  async function employee(definition) {
    const user = await prisma.user.create({ data: { tenantId: tenant.id, firstName: definition.name, lastName: 'Fixture',
      email: `${randomUUID()}@camxian.com`, role: definition.name, mustChangePassword: false, onboardingCompletedAt: new Date() } });
    return assigned(user, definition);
  }
  const associateA = await assigned(agent, associateRole), associateB = await assigned(replacement, associateRole);
  const manager = await employee(managerRole), custom = await employee(customRole), denied = await employee(deniedRole);
  await prisma.userRole.create({ data: { tenantId: tenant.id, userId: associateA.id, roleId: managerRole.id } });
  await prisma.tenantGroup.create({ data: { tenantId: tenant.id, name: 'Forecast team', members: { create: [
    { userId: associateA.id, isHead: true }, { userId: associateB.id },
  ] } } });
  await prisma.tenantGroup.create({ data: { tenantId: tenant.id, name: 'Custom forecast team', members: { create: [
    { userId: associateA.id }, { userId: associateB.id }, { userId: custom.id, isHead: true },
  ] } } });
  async function deal(value, assignedUserId, date = `${today}T00:00:00Z`) {
    return prisma.deal.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, stageId: stages[2].id,
      title: `Forecast fixture ${value}`, value, currency: 'PHP', assignedUserId, expectedCloseDate: date ? new Date(date) : null } });
  }
  const aDeal = await deal(10000, associateA.id, `${current.salesForecast.period.end}T00:00:00Z`);
  await deal(15000, associateB.id); await deal(20000, manager.id); await deal(5000, null);
  await deal(7000, associateA.id, null); await deal(3000, associateB.id, future.toISOString());
  async function open(user) {
    const opened = await session((await issueAuthSession(user)).token);
    extraSessions.push(opened); return opened.tab;
  }
  try {
    const managerPage = await open(manager), aPage = await open(associateA), bPage = await open(associateB), customPage = await open(custom), deniedPage = await open(denied);
    const chart = tab => tab.getByRole('region', { name: 'Sales Forecast', exact: true });
    const read = async (tab, range = 'thisMonth') => {
      const response = await tab.request.get(`${base}/api/proxy/reporting/dashboard?range=${range}`);
      assert.equal(response.status(), 200); assert.equal(response.headers()['cache-control'], 'no-store');
      return (await response.json()).data;
    };
    const datedValue = async tab => (await chart(tab).getByRole('list', { name: 'Sales Forecast interval values' }).locator('li').allTextContents())
      .reduce((sum, text) => sum + Number(text.slice(text.lastIndexOf(':') + 1).replace(/[^\d.-]/g, '')), 0);
    async function expectForecast(tab, total, dated) {
      await until(async () => {
        const value = await tab.getByRole('group', { name: 'Forecast', exact: true }).locator('[data-metric-value]').evaluate(node => node.querySelector('[aria-label]')?.getAttribute('aria-label'));
        return value === money(total) && await datedValue(tab) === dated;
      }, `Forecast ${total}, dated ${dated}`);
    }
    for (const [tab, total, dated] of [[page, 60000, 50000], [managerPage, 60000, 50000], [aPage, 17000, 10000], [bPage, 18000, 15000], [customPage, 35000, 25000]]) {
      const report = await read(tab);
      assert.equal(report.metrics.forecastedRevenue, total);
      assert.equal(report.salesForecast.buckets.reduce((sum, bucket) => sum + bucket.value, 0), dated);
      await expectForecast(tab, total, dated);
    }
    assert.equal((await read(managerPage)).metrics.activeDeals, 1);
    assert.equal((await read(deniedPage)).salesForecast, null);
    await chart(deniedPage).getByText('Deal reporting access is restricted.').waitFor();
    const injected = await aPage.request.get(`${base}/api/proxy/reporting/dashboard?assignedUserId=${associateB.id}`);
    assert.equal(injected.status(), 400);
    record('Separate authenticated role sessions enforce forecast-only company, assigned, custom and restricted scopes');
    assert.equal(current.salesForecast.period.start, `${today.slice(0, 7)}-01`);
    const [year, month] = today.split('-').map(Number);
    assert.equal(current.salesForecast.period.end, new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10));
    record('Full-month forecast includes month-end Expected Close Dates after today without changing the KPI');

    for (const [label, range, interval] of [['Weekly', 'thisWeek', 'day'], ['Yearly', 'thisYear', 'month'], ['Monthly', 'thisMonth', 'week']]) {
      await page.getByRole('button', { name: 'Dashboard date range', exact: true }).click();
      const response = page.waitForResponse(response => response.url().includes('/reporting/dashboard?') && new URL(response.url()).searchParams.get('range') === range);
      await page.getByRole('menuitemradio', { name: label, exact: true }).click();
      const data = (await (await response).json()).data;
      assert.equal(data.salesForecast.period.interval, interval); assert.equal(data.metrics.forecastedRevenue, 60000);
      const expectedEnd = range === 'thisWeek' ? new Date(Date.parse(data.salesForecast.period.start) + 6 * 86400000).toISOString().slice(0, 10)
        : range === 'thisMonth' ? current.salesForecast.period.end : `${today.slice(0, 4)}-12-31`;
      assert.equal(data.salesForecast.period.end, expectedEnd);
      assert.equal(data.salesForecast.buckets.at(-1).end, expectedEnd);
      assert.equal(data.salesForecast.buckets.length, range === 'thisWeek' ? 7 : range === 'thisYear' ? 12 : current.salesForecast.buckets.length);
      assert.equal(data.period.end, today);
      assert.equal(data.leadSourcePerformance.period.end, today);
      await expectForecast(page, 60000, range === 'thisWeek' && current.salesForecast.period.end > expectedEnd ? 40000 : 50000);
    }
    record('Main Weekly, Monthly and Yearly selector controls forecast grouping while KPI remains current');

    await http(`/crm/deals/${aDeal.id}/stage`, 'PATCH', { stageId: stages[0].id });
    await expectForecast(aPage, 7000, 0); await expectForecast(managerPage, 50000, 40000);
    await http(`/crm/deals/${aDeal.id}/stage`, 'PATCH', { stageId: stages[2].id });
    await expectForecast(aPage, 17000, 10000);
    await prisma.deal.update({ where: { id: aDeal.id }, data: { expectedCloseDate: future } });
    await expectForecast(aPage, 17000, 0);
    await prisma.deal.update({ where: { id: aDeal.id }, data: { expectedCloseDate: new Date(`${today}T00:00:00Z`), value: 11000 } });
    await expectForecast(aPage, 18000, 11000); await expectForecast(managerPage, 61000, 51000);
    await prisma.deal.update({ where: { id: aDeal.id }, data: { assignedUserId: associateB.id } });
    await expectForecast(aPage, 7000, 0); await expectForecast(bPage, 29000, 26000);
    await managerPage.getByRole('button', { name: 'Sync Metrics', exact: true }).click();
    await expectForecast(managerPage, 61000, 51000);
    record('Existing revision stream updates stage, close date, saved value and reassignment; Sync Metrics preserves scoped totals');

    // Distribute fixture dates across weeks/months to visually inspect multiple purple bars.
    await prisma.deal.updateMany({ where: { tenantId: tenant.id, assignedUserId: manager.id }, data: { expectedCloseDate: new Date(`${today.slice(0, 7)}-01T00:00:00Z`) } });
    const earlierDay = fraction => `${today.slice(0, 7)}-${String(Math.max(1, Math.floor(Number(today.slice(-2)) * fraction))).padStart(2, '0')}T00:00:00Z`;
    await prisma.deal.updateMany({ where: { tenantId: tenant.id, assignedUserId: null }, data: { expectedCloseDate: new Date(earlierDay(1 / 3)) } });
    await prisma.deal.updateMany({ where: { tenantId: tenant.id, value: 15000 }, data: { expectedCloseDate: new Date(earlierDay(2 / 3)) } });
    const expectedBuckets = (await read(page)).salesForecast.buckets.map(bucket => bucket.value);
    await until(async () => {
      const displayed = (await chart(page).getByRole('list', { name: 'Sales Forecast interval values' }).locator('li').allTextContents())
        .map(text => Number(text.slice(text.lastIndexOf(':') + 1).replace(/[^\d.-]/g, '')));
      return JSON.stringify(displayed) === JSON.stringify(expectedBuckets);
    }, 'Close-date changes update individual intervals even when the total is unchanged');
    await expectForecast(page, 61000, 51000);
    record('Within-period expected close date edits move values between bars without changing the current KPI or chart total');
    assert.deepEqual(await page.locator('main h3').allTextContents(), ['Action Center', 'Revenue Trend', 'Sales Forecast', 'Pipeline Overview', 'Lead Source Performance', 'Sales Leaderboard']);
    for (const theme of ['Light', 'Dark']) {
      await setAcceptanceTheme(page, theme);
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await chart(page).scrollIntoViewIfNeeded(); await wait(350);
        const bounds = await chart(page).evaluate(element => {
          const rect = element.getBoundingClientRect(), previous = element.previousElementSibling.getBoundingClientRect(), next = element.nextElementSibling.getBoundingClientRect();
          const scroll = element.querySelector('[aria-label="Scrollable sales forecast chart"]');
          return { width: rect.width, previousWidth: previous.width, nextWidth: next.width, left: rect.left, right: rect.right,
            viewport: innerWidth, outerOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            scrollOverflow: scroll.scrollWidth > scroll.clientWidth, scrollStyle: getComputedStyle(scroll).overflowX,
            parentOverflowY: getComputedStyle(element).overflowY, canvasWidth: element.querySelector('canvas').getBoundingClientRect().width };
        });
        assert.equal(bounds.outerOverflow, false, JSON.stringify(bounds));
        assert.ok(bounds.left >= 0 && bounds.right <= width + 1, JSON.stringify(bounds));
        assert.ok(Math.abs(bounds.width - bounds.previousWidth) < 2 && Math.abs(bounds.width - bounds.nextWidth) < 2, JSON.stringify(bounds));
        assert.ok(bounds.canvasWidth > 0); assert.equal(bounds.scrollStyle, 'auto'); assert.equal(bounds.parentOverflowY, 'visible');
        await chart(page).screenshot({ path: resolve(output, `forecast-${theme}-${width}.png`) });
        record(`Sales Forecast ${theme} ${width}px: full-width row and contained chart overflow`, bounds);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const canvas = chart(page).locator('canvas');
    assert.ok((await canvas.evaluate(element => element.__labels ?? [])).some(label => /₱/.test(label)), 'Canvas contains tenant-currency labels');
    // Permission changes must evict confidential values from an already-open Dashboard.
    await prisma.rolePermission.updateMany({ where: { tenantId: tenant.id, roleId: managerRole.id, module: 'deals' }, data: { canView: false } });
    await until(async () => await chart(managerPage).getByText('Deal reporting access is restricted.').count() === 1, 'Live forecast permission revocation');
    assert.equal((await read(managerPage)).metrics.forecastedRevenue, null);
    record('Live Deal permission revocation removes both forecast outputs');
  } finally {
    for (const opened of extraSessions) await opened.context.close();
  }
}

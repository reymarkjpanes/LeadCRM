import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setAcceptanceTheme } from './verify-browser-matrix.mjs';

/** Runs against the parent's disposable SQL, authenticated HTTP and production browser. */
export async function verifyTableControls({ page, base, prisma, tenant, foreignTenant, admin, deniedToken, call, until, record, reads, control, output }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setAcceptanceTheme(page, 'Light');
  const modules = [
    { id: 'leads', path: '/crm/leads', api: '/crm/leads', model: 'lead', field: 'firstName', search: 'Josh', region: 'Leads data grid', hide: 'Email' },
    { id: 'contacts', path: '/crm/contacts', api: '/crm/contacts', model: 'contact', field: 'firstName', search: 'Search Target', region: 'Contacts data grid', hide: 'Email' },
    { id: 'accounts', path: '/crm/accounts', api: '/crm/accounts', model: 'account', field: 'name', search: 'Search Target', region: 'Accounts data grid', hide: 'Industry' },
    { id: 'tasks', path: '/operations/taskboard', api: '/operations/tasks', model: 'task', field: 'title', search: 'Search Target', region: 'Tasks data grid', hide: 'Due Date' },
    { id: 'workflows', path: '/automation/workflows', api: '/automation/workflows', model: 'workflow', field: 'name', search: 'Search Target', region: 'Workflows table', hide: 'Trigger' },
    { id: 'campaigns', path: '/marketing/campaigns', api: '/marketing/campaigns', model: 'campaign', field: 'name', search: 'Search Target', region: 'Campaigns table', hide: 'Type' },
    { id: 'users', path: '/settings?tab=users', api: '/administration/users', model: 'user', field: 'firstName', search: 'Search Target', region: 'Team Management table', hide: 'Role' },
  ];
  // Keep the API allowlists explicit in the acceptance test, independently of UI rendering.
  const sortFields = {
    leads: ['name', 'firstName', 'lastName', 'email', 'phone', 'companyName', 'status', 'source', 'createdAt', 'updatedAt'],
    contacts: ['firstName', 'lastName', 'email', 'phone', 'companyName', 'status', 'source', 'createdAt'],
    accounts: ['name', 'industry', 'size', 'address', 'createdAt'], tasks: ['title', 'dueDate', 'createdAt', 'updatedAt'],
    workflows: ['name', 'status', 'createdAt'], campaigns: ['name', 'createdAt'], users: ['name', 'role', 'email', 'status', 'groups', 'createdAt'],
  };
  const common = { tenantId: tenant.id };
  const foreignAdmin = await prisma.user.create({ data: { tenantId: foreignTenant.id, firstName: 'Search Target Foreign', lastName: 'Admin', email: 'foreign-admin@camxian.com', role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() } });
  await prisma.account.create({ data: { tenantId: foreignTenant.id, name: 'Search Target Foreign Account',  } });
  await prisma.contact.create({ data: { tenantId: foreignTenant.id, firstName: 'Search Target Foreign', lastName: 'Contact', productsNormalized: true } });
  await prisma.task.create({ data: { tenantId: foreignTenant.id, title: 'Search Target Foreign Task', assignedUserId: foreignAdmin.id, dueDate: new Date(), createdById: foreignAdmin.id } });
  await prisma.workflow.create({ data: { tenantId: foreignTenant.id, name: 'Search Target Foreign Workflow', trigger: 'lead.created', actions: [] } });
  await prisma.campaign.create({ data: { tenantId: foreignTenant.id, name: 'Search Target Foreign Campaign', type: 'EMAIL' } });
  // Enough real records for every table to test a non-first page.
  for (let index = 4; index <= 32; index++) {
    const number = String(index).padStart(2, '0');
    await prisma.account.create({ data: { ...common, name: `Search Target Account ${number}`,  } });
    await prisma.contact.create({ data: { ...common, firstName: 'Search Target', lastName: `Person ${number}`, productsNormalized: true } });
    await prisma.task.create({ data: { ...common, title: `Search Target Task ${number}`, assignedUserId: admin.id, dueDate: new Date(), createdById: admin.id } });
    await prisma.workflow.create({ data: { ...common, name: `Search Target Workflow ${number}`, trigger: 'lead.created', actions: [] } });
    await prisma.campaign.create({ data: { ...common, name: `Search Target Campaign ${number}`, type: 'EMAIL' } });
    await prisma.user.create({ data: { ...common, firstName: 'Search Target', lastName: `User ${number}`, role: 'Sales', status: 'ACTIVE', email: `table-control-${number}@camxian.com`, mustChangePassword: false, onboardingCompletedAt: new Date() } });
  }
  // Varied keys make the assertions check the intended field/value, rather than
  // merely checking that two equally incorrect requests agree with each other.
  const textKeys = ['zebra', 'Alpha', 'record 10', 'Record 2', '', null];
  const statuses = ['HOT', 'Cold', 'Warm'];
  const groups = await Promise.all(['Zebra', 'Alpha'].map(name => prisma.tenantGroup.create({ data: { ...common, name } })));
  const linkedAccount = await prisma.account.findFirst({ where: common });
  for (const module of modules) {
    const rows = await prisma[module.model].findMany({ where: { ...common, [module.field]: { contains: module.search, mode: 'insensitive' } }, orderBy: { id: 'asc' } });
    for (const [index, row] of rows.entries()) {
      const text = textKeys[index % textKeys.length];
      const date = new Date(Date.UTC(2026, index % 3, 1 + index % 20));
      const values = {
        leads: { firstName: index % 2 ? 'josh' : 'Josh', companyName: text, phone: text ? `+63917${index % 3}123456` : text, source: ['Website', 'Referral', 'Google Ads', null][index % 4], status: statuses[index % 3], createdAt: date, updatedAt: date },
        contacts: { firstName: index % 2 ? 'search target' : 'Search Target', companyName: text, accountId: index % 2 ? null : linkedAccount.id,
          phone: text ? `+63917${index % 3}123456` : text, email: text ? `person${index % 3}@example.test` : text, source: ['Website', 'Referral', null][index % 3], status: statuses[index % 3].toUpperCase(), createdAt: date },
        accounts: { industry: text, size: ['200+', '1-10', '51-200', '11-50', null][index % 5], address: text, createdAt: date },
        tasks: { dueDate: date, createdAt: date, updatedAt: date },
        workflows: { status: ['DRAFT', 'ACTIVE', 'PAUSED', 'ACTIVE'][index % 4], isActive: index % 4 === 1, createdAt: date },
        campaigns: { createdAt: date },
        users: { firstName: index % 2 ? 'search target' : 'Search Target', role: index % 2 ? 'Sales' : 'Support', status: ['ACTIVE', 'INACTIVE', 'PENDING'][index % 3], createdAt: date },
      };
      await prisma[module.model].update({ where: { id: row.id }, data: values[module.id] });
      if (module.id === 'users' && index % 3 !== 2) await prisma.tenantGroupMember.create({ data: { ...common, userId: row.id, groupId: groups[index % 2].id } });
    }
  }
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const displayedValue = (module, row, field) => {
    if (field === 'name' && ['leads', 'users'].includes(module)) return [row.firstName?.trim(), row.lastName?.trim()].filter(Boolean).join(' ');
    if (module === 'contacts' && field === 'companyName') return row.companyName;
    if (module === 'workflows' && field === 'status') return row.status === 'DRAFT' ? 'Draft' : row.isActive ? 'Active' : 'Paused';
    if (module === 'users' && field === 'groups') return (row.groups ?? []).map(group => group.name).sort().join(', ');
    if (['createdAt', 'updatedAt', 'dueDate'].includes(field)) return row[field] ? Date.parse(row[field]) : null;
    return typeof row[field] === 'string' ? row[field].trim() : row[field];
  };
  for (const module of modules) {
    for (const field of sortFields[module.id]) for (const direction of ['asc', 'desc']) {
      const query = `?search=${encodeURIComponent(module.search)}&${module.id === 'tasks' ? `sortBy=${field}&sortOrder=${direction}` : `sort=${field}:${direction}`}`;
      const full = await call(module.api + query + '&limit=100');
      assert.equal(full.status, 200, `${module.id} ${field}:${direction}`);
      const expected = [...full.body.data].sort((a, b) => {
        const av = displayedValue(module.id, a, field), bv = displayedValue(module.id, b, field);
        const missingA = av == null || av === '', missingB = bv == null || bv === '';
        const difference = missingA || missingB ? missingA === missingB ? 0 : missingA ? 1 : -1
          : (typeof av === 'number' ? av - bv : collator.compare(String(av), String(bv))) * (direction === 'asc' ? 1 : -1);
        return difference || a.id.localeCompare(b.id);
      });
      assert.deepEqual(full.body.data.map(row => row.id), expected.map(row => row.id), `${module.id} ${field}:${direction} matches displayed values`);
      const second = await call(module.api + query + '&limit=1&page=2');
      assert.equal(second.status, 200);
      assert.equal(second.body.meta.total, full.body.meta.total);
      assert.equal(second.body.data[0].id, full.body.data[1].id, `${module.id} sorted before pagination`);
      assert.ok(full.body.data.every(row => row.tenantId === tenant.id));
    }
    const denied = await call(`/preferences/columns/${module.id}`, 'GET', undefined, deniedToken);
    assert.ok([403, 404].includes(denied.status), `${module.id} denied preference access`);
    assert.ok([403, 404].includes((await call(module.api, 'GET', undefined, deniedToken)).status), `${module.id} denied list access`);
  }
  record('All 39 supported fields in both directions match displayed values, empty-last order and stable IDs before SQL pagination; restricted roles are denied');

  await page.setViewportSize({ width: 1440, height: 900 });
  const navigate = path => page.goto(base + path);
  for (const module of modules) {
    await navigate(module.path);
    const region = page.getByRole('region', { name: module.region, exact: true });
    await region.getByRole('grid').waitFor();
    const settings = page.getByRole('button', { name: 'Table settings', exact: true }).last();
    const manage = page.getByRole('menuitem', { name: 'Manage Columns', exact: true });
    assert.equal(await page.getByRole('button', { name: 'Manage Columns', exact: true }).count(), 0, `${module.id} no separate Manage Columns button`);
    assert.equal(await page.getByRole('button', { name: 'Table settings', exact: true }).count(), 1, `${module.id} one toolbar settings entry`);
    assert.equal(await region.getByRole('button', { name: 'Table settings', exact: true }).count(), 0);
    const refresh = page.getByRole('button', { name: module.id === 'tasks' ? 'Refresh tasks' : 'Refresh', exact: true }).last();
    assert.ok((await settings.boundingBox()).x > (await refresh.boundingBox()).x, module.id + ' control order');
    assert.equal(await settings.evaluate(element => element.parentElement.previousElementSibling?.getAttribute('aria-label')), module.id === 'tasks' ? 'Refresh tasks' : 'Refresh');
    await settings.focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await manage.count(), 1, `${module.id} one Manage Columns menu entry`);
    await until(async () => await manage.evaluate(element => document.activeElement === element), module.id + ' keyboard focus on Manage Columns');
    await page.screenshot({ path: resolve(output, `${module.id}-settings-menu.png`) });
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: `Manage Columns - ${module.id}`, exact: true });
    const hide = drawer.getByRole('switch', { name: new RegExp(`^Toggle ${module.hide} visibility$`, 'i') });
    // Module terminology can differ from its stored column ID.
    if (await hide.count()) { await hide.click(); await drawer.getByRole('button', { name: 'Save', exact: true }).click(); await drawer.getByRole('button', { name: 'Saved', exact: true }).waitFor(); }
    await drawer.getByRole('button', { name: 'Close drawer' }).click();
    assert.ok(await settings.evaluate(element => document.activeElement === element), module.id + ' drawer restores settings focus');

    const search = page.getByRole('textbox', { name: new RegExp(`^Search ${module.id}(?:\\.\\.\\.)?$`, 'i') });
    if (module.id === 'users') {
      await search.fill(module.search);
      await until(async () => await region.locator('tbody tr').evaluateAll((rows, term) => rows.length > 0 && rows.every(row => row.textContent.toLowerCase().includes(term.toLowerCase())), module.search), 'users local search');
    } else await Promise.all([
      page.waitForResponse(response => { const url = new URL(response.url()); return response.request().method() === 'GET' && url.pathname === `/api/proxy${module.api}` && url.searchParams.get('search') === module.search && response.ok(); }),
      search.fill(module.search),
    ]);
    await until(async () => !await refresh.isDisabled() && (await region.locator('tbody tr').count()) > 0, `${module.id} initial search`);
    const pageSize = page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Records per page' });
    const firstSize = (await pageSize.textContent()).trim() === '20' ? '50' : '20';
    const total = (await call(module.api + `?search=${encodeURIComponent(module.search)}`)).body.meta.total;
    // Selecting the current size is a no-op. Exercise two actual transitions.
    for (const size of [firstSize, '10']) {
      await pageSize.click();
      const option = page.getByRole('option', { name: size, exact: true });
      if (module.id === 'users') await option.click();
      else await Promise.all([
        page.waitForResponse(response => { const url = new URL(response.url()); return response.request().method() === 'GET' && url.pathname === `/api/proxy${module.api}` && url.searchParams.get('search') === module.search && (url.searchParams.get('limit') === size || url.searchParams.get('pageSize') === size) && response.ok(); }),
        option.click(),
      ]);
      await until(async () => await region.locator('tbody tr').count() === Math.min(Number(size), total) && !await refresh.isDisabled(), `${module.id} page size ${size} rendered`);
    }

    const primary = { leads: ['Name', 'name'], contacts: ['First Name', 'firstName'], accounts: ['Account Name', 'name'], tasks: ['Task title', 'title'], workflows: ['Name', 'name'], campaigns: ['Campaign', 'name'], users: ['User', 'name'] }[module.id];
    const primaryTrigger = region.getByRole('button', { name: `Column options for ${primary[0]}`, exact: true });
    await primaryTrigger.click();
    const menu = page.getByRole('menu', { name: `Options for ${primary[0]}`, exact: true });
    assert.equal(await menu.getByText('Sort field', { exact: true }).count(), 0);
    assert.equal(await menu.getByText(/^Current:/).count(), 0);
    await until(async () => await menu.getByRole('menuitemradio').count() === 2, module.id + ' sortable column menu rendered');
    await until(async () => await menu.evaluate(element => getComputedStyle(element).opacity) === '1', module.id + ' menu animation settled');
    await page.screenshot({ path: resolve(output, `${module.id}-column-menu.png`) });
    await menu.getByRole('menuitemradio', { name: 'Sort A–Z', exact: true }).click();
    await until(async () => (await call(`/preferences/table/${module.id}`)).body.data.sort?.field === primary[1] && !await refresh.isDisabled(), module.id + ' column-specific sort');
    assert.equal(await region.getByRole('columnheader', { name: primary[0], exact: true }).getAttribute('aria-sort'), 'ascending');
    await primaryTrigger.click();
    assert.equal(await page.getByRole('menuitemradio', { name: 'Sort A–Z' }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');

    const openSort = async () => { await settings.click(); await page.getByRole('menuitem', { name: 'Sort Table…', exact: true }).click(); };
    await openSort();
    const sortDialog = page.getByRole('dialog', { name: 'Sort Table', exact: true });
    const currentSort = (await call(`/preferences/table/${module.id}`)).body.data.sort;
    await sortDialog.getByRole('combobox', { name: 'Sort field', exact: true }).selectOption('createdAt');
    const options = await sortDialog.getByRole('combobox', { name: 'Sort field', exact: true }).locator('option').evaluateAll(items => items.map(item => ({ id: item.value, label: item.textContent })));
    assert.deepEqual(options.map(option => option.id), sortFields[module.id]);
    assert.equal(await sortDialog.getByRole('option', { name: 'Oldest first', exact: true }).count(), 1);
    await sortDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual((await call(`/preferences/table/${module.id}`)).body.data.sort, currentSort);
    assert.ok(await settings.evaluate(element => document.activeElement === element));
    for (const trigger of await region.getByRole('button', { name: /^Column options for / }).all()) {
      const label = (await trigger.getAttribute('aria-label')).replace('Column options for ', '');
      const option = options.find(option => option.label === label);
      await trigger.scrollIntoViewIfNeeded(); await trigger.click();
      const columnMenu = page.getByRole('menu').last();
      assert.equal(await columnMenu.getByRole('menuitemradio').count(), option ? 2 : 0, `${module.id} ${label} only supports its own field`);
      assert.equal(await columnMenu.getByText('Sort field', { exact: true }).count(), 0);
      assert.equal(await columnMenu.getByText(/^Current:/).count(), 0);
      if (option) {
        const checked = await columnMenu.locator('[role="menuitemradio"][aria-checked="true"]').count();
        assert.equal(checked, option.id === primary[1] ? 1 : 0);
      }
      await page.keyboard.press('Escape');
    }
    if (module.id === 'leads') {
      control.failPath = '/preferences/table/leads/sort'; control.failMethod = 'PUT';
      await openSort(); await sortDialog.getByRole('combobox', { name: 'Sort field', exact: true }).selectOption('firstName');
      await sortDialog.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.getByText('Unable to save sort preference. Please try again.', { exact: true }).waitFor();
      await until(async () => !await refresh.isDisabled(), 'failed sort write recovered');
      assert.deepEqual((await call('/preferences/table/leads')).body.data.sort, currentSort);
      await openSort();
      assert.equal(await sortDialog.getByRole('combobox', { name: 'Sort field', exact: true }).inputValue(), currentSort.field);
      await sortDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      control.failPath = module.api;
      await openSort(); await sortDialog.getByRole('combobox', { name: 'Sort field', exact: true }).selectOption('companyName');
      await sortDialog.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.getByText(/^Refresh unavailable/).last().waitFor();
      await until(async () => !await refresh.isDisabled(), 'failed sorted list ended');
      await refresh.click(); await until(async () => !await refresh.isDisabled(), 'sorted list retry completed');
      assert.deepEqual((await call('/preferences/table/leads')).body.data.sort, { field: 'companyName', direction: 'asc' });
      // Reproduce the supplied First Name screenshot with Company still active.
      await settings.click(); await manage.click();
      await drawer.getByRole('switch', { name: 'Toggle First Name visibility', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Switch Columns', exact: true }).click();
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await drawer.getByRole('button', { name: 'Saved', exact: true }).waitFor();
      await drawer.getByRole('button', { name: 'Close drawer' }).click();
      const toastClose = page.locator('[data-sonner-toast] [data-close-button]');
      while (await toastClose.count()) {
        const count = await toastClose.count(); await toastClose.first().click();
        await until(async () => await toastClose.count() < count, 'test error toast dismissed');
      }
      await region.getByRole('button', { name: 'Column options for First Name', exact: true }).click();
      const firstNameMenu = page.getByRole('menu').last();
      assert.equal(await firstNameMenu.getByText(/Current:|Company Name|Sort field/).count(), 0);
      assert.equal(await firstNameMenu.locator('[role="menuitemradio"][aria-checked="true"]').count(), 0);
      await until(async () => await firstNameMenu.evaluate(element => getComputedStyle(element).opacity) === '1', 'First Name menu animation settled');
      await page.screenshot({ path: resolve(output, 'leads-first-name-menu.png') });
      await firstNameMenu.getByRole('menuitemradio', { name: 'Sort A–Z', exact: true }).click();
      await until(async () => (await call('/preferences/table/leads')).body.data.sort?.field === 'firstName' && !await refresh.isDisabled(), 'First Name menu sorted its exact field');
      assert.equal(await region.getByRole('columnheader', { name: 'First Name', exact: true }).getAttribute('aria-sort'), 'ascending');
    }
    await openSort();
    await sortDialog.getByRole('combobox', { name: 'Sort field', exact: true }).selectOption('createdAt');
    await sortDialog.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('asc');
    await until(async () => await sortDialog.evaluate(element => getComputedStyle(element).opacity) === '1', module.id + ' dialog animation settled');
    assert.notEqual(await sortDialog.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', module.id + ' dialog has a surface');
    await page.screenshot({ path: resolve(output, `${module.id}-sort-dialog.png`) });
    await sortDialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await until(async () => (await call(`/preferences/table/${module.id}`)).body.data.sort?.field === 'createdAt' && (await call(`/preferences/table/${module.id}`)).body.data.sort?.direction === 'asc', `${module.id} saved sort`);
    await until(async () => !await refresh.isDisabled() && await page.getByRole('navigation', { name: 'Pagination' }).count() > 0, `${module.id} sorted list`);
    await page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Next page' }).click();
    await until(async () => await page.getByRole('navigation', { name: 'Pagination' }).getByText(/Page 2 of/).count() > 0, `${module.id} second page`);

    const header = region.getByRole('columnheader').filter({ has: page.locator('.cursor-col-resize') }).first();
    await header.scrollIntoViewIfNeeded();
    const headerLabel = await header.getAttribute('aria-label');
    const before = await header.boundingBox();
    // A short table stretches columns to fill its container. Persisted widths
    // follow the declared colgroup size, independently of that extra space.
    const declaredWidth = await header.evaluate(element => parseFloat(element.closest('table').querySelectorAll('col')[Array.from(element.parentElement.children).indexOf(element)].style.width));
    const resized = Math.round(declaredWidth + 65);
    await page.mouse.move(before.x + before.width - 2, before.y + 15); await page.mouse.down();
    await page.mouse.move(before.x + before.width + 63, before.y + 15); await page.mouse.up();
    await until(async () => (await call(`/preferences/columns/${module.id}`)).body.data.columns.some(column => column.width === resized), module.id + ' resize write');
    const savedLayout = (await call(`/preferences/columns/${module.id}`)).body.data.columns;
    const savedTable = (await call(`/preferences/table/${module.id}`)).body.data;
    if (module.id === 'leads') {
      control.failPath = '/preferences/columns/leads'; control.failMethod = 'PUT';
      await settings.click(); await page.getByRole('menuitem', { name: 'Reset Column Size', exact: true }).click();
      await page.getByText('Unable to reset column sizes. Please try again.', { exact: true }).waitFor();
      assert.deepEqual((await call('/preferences/columns/leads')).body.data.columns, savedLayout);
      await until(async () => !await settings.isDisabled(), 'failed width reset ended');
    }
    await settings.click(); await page.getByRole('menuitem', { name: 'Reset Column Size', exact: true }).click();
    await until(async () => (await call(`/preferences/columns/${module.id}`)).body.data.columns.every(column => column.width === undefined), module.id + ' width-only reset');
    const resetLayout = (await call(`/preferences/columns/${module.id}`)).body.data.columns;
    assert.deepEqual(resetLayout, savedLayout.map(({ width, ...column }) => column));
    assert.deepEqual((await call(`/preferences/table/${module.id}`)).body.data, savedTable);
    assert.equal(Math.round((await region.getByRole('columnheader', { name: headerLabel, exact: true }).boundingBox()).width), Math.round(before.width));
    assert.equal(await search.inputValue(), module.search);
    assert.equal(await page.getByRole('navigation', { name: 'Pagination' }).getByText(/Page 2 of/).count(), 1);

    const sorted = await call(module.api + `?search=${encodeURIComponent(module.search)}&${module.id === 'tasks' ? 'sortBy=createdAt&sortOrder=asc' : 'sort=createdAt:asc'}&limit=10&page=2`);
    const row = sorted.body.data[0];
    const current = await prisma[module.model].findUnique({ where: { id: row.id } });
    const newText = current[module.field] + ' Refreshed';
    await prisma[module.model].update({ where: { id: row.id }, data: { [module.field]: newText } });
    const freshRecord = {
      leads: { ...common, firstName: 'Josh Fresh Total', lastName: 'Acceptance', productsNormalized: true },
      contacts: { ...common, firstName: 'Search Target Fresh', lastName: 'Acceptance', productsNormalized: true },
      accounts: { ...common, name: 'Search Target Fresh Account' },
      tasks: { ...common, title: 'Search Target Fresh Task', assignedUserId: admin.id, dueDate: new Date(), createdById: admin.id },
      workflows: { ...common, name: 'Search Target Fresh Workflow', trigger: 'lead.created', actions: [] },
      campaigns: { ...common, name: 'Search Target Fresh Campaign', type: 'EMAIL' },
      users: { ...common, firstName: 'Search Target Fresh', lastName: 'Acceptance', role: 'Sales', status: 'ACTIVE', email: 'fresh-total@camxian.com', mustChangePassword: false, onboardingCompletedAt: new Date() },
    };
    await prisma[module.model].create({ data: freshRecord[module.id] });
    // Users refreshes its directory and applies the search locally.
    const count = () => reads.filter(read => read.path === module.api && read.method === 'GET' && new URLSearchParams(read.query).get('search') === (module.id === 'users' ? null : module.search)).length;
    const calls = count();
    control.holdPath = module.api;
    await refresh.click();
    await until(async () => control.pending >= 1, module.id + ' refresh reached HTTP');
    assert.equal(await refresh.isDisabled(), true);
    assert.ok(await refresh.locator('.animate-spin').count());
    const spinner = region.getByRole('status', { name: 'Refreshing data...' });
    assert.ok(await spinner.isVisible(), module.id + ' spinner is inside the affected table');
    assert.ok(await region.locator('tbody tr').first().isVisible(), module.id + ' rows remain visible during refresh');
    assert.equal(await region.getAttribute('aria-busy'), 'true');
    await refresh.evaluate(element => { element.click(); element.click(); });
    assert.equal(count(), calls + 1, module.id + ' repeated refresh shares one request');
    control.release();
    await until(async () => !await refresh.isDisabled(), module.id + ' refresh completed');
    assert.equal(await spinner.count(), 0, module.id + ' spinner clears after success');
    assert.equal(count(), calls + 1, module.id + ' one list refresh');
    assert.ok((await region.textContent()).includes(newText), module.id + ' fresh rows displayed');
    assert.equal(await search.inputValue(), module.search);
    assert.equal(await page.getByRole('navigation', { name: 'Pagination' }).getByText(/Page 2 of/).count(), 1);
    assert.deepEqual((await call(`/preferences/table/${module.id}`)).body.data, savedTable);
    const refreshedTotal = sorted.body.meta.total + 1;
    assert.equal((await call(module.api + `?search=${encodeURIComponent(module.search)}`)).body.meta.total, refreshedTotal);
    assert.ok((await region.textContent()).includes(`${refreshedTotal} total`), module.id + ' refreshed total displayed');

    control.failPath = module.api;
    await refresh.click();
    await until(async () => !await refresh.isDisabled(), module.id + ' failed refresh completed');
    assert.equal(await spinner.count(), 0, module.id + ' spinner clears after failure');
    assert.ok((await page.textContent('body')).includes('Refresh unavailable'), module.id + ' visible refresh error');
    assert.ok((await region.textContent()).includes(newText), module.id + ' failed refresh retains rows');
    await refresh.click(); await until(async () => !await refresh.isDisabled(), module.id + ' retry completed');
    await page.reload(); await region.getByRole('grid').waitFor();
    assert.equal((await call(`/preferences/columns/${module.id}`)).body.data.columns.some(column => column.width !== undefined), false);
    assert.deepEqual((await call(`/preferences/table/${module.id}`)).body.data.sort, { field: 'createdAt', direction: 'asc' });
    await openSort(); await sortDialog.getByRole('button', { name: 'Restore default sorting', exact: true }).click();
    await until(async () => (await call(`/preferences/table/${module.id}`)).body.data.sort?.direction !== 'asc', module.id + ' default sort saved');
    await region.getByRole('button', { name: /^Column options for / }).first().focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('menu').last().waitFor(); await page.keyboard.press('Escape');
    assert.ok(await region.getByRole('button', { name: /^Column options for / }).first().evaluate(element => document.activeElement === element));
    await page.screenshot({ path: resolve(output, `${module.id}-controls.png`) });
    for (const dark of [false, true]) for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(dark => {
        localStorage.setItem('app_theme', dark ? 'Dark' : 'Light');
        window.dispatchEvent(new StorageEvent('storage', { key: 'app_theme', storageArea: localStorage }));
      }, dark);
      await until(async () => await page.evaluate(() => document.documentElement.dataset.appTheme) === (dark ? 'dark' : 'light'), module.id + ' resolved theme');
      await settings.click(); await manage.click();
      const bounds = await drawer.boundingBox(); assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
      assert.equal(await drawer.evaluate(element => element.closest('[data-theme-container]').classList.contains('dark')), dark);
      await page.screenshot({ path: resolve(output, `${module.id}-${width}-${dark ? 'dark' : 'light'}.png`) });
      await page.keyboard.press('Escape');
      await openSort();
      const dialogBounds = await sortDialog.boundingBox(); assert.ok(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= width);
      assert.equal(await sortDialog.evaluate(element => element.closest('[data-theme-container]').classList.contains('dark')), dark);
      await page.keyboard.press('Escape');
      await region.getByRole('button', { name: /^Column options for / }).first().click();
      const menuBounds = await page.getByRole('menu').last().boundingBox();
      assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    // A valid page survives refresh; a page removed by an external deletion
    // must recover to the remaining page through the same data hook.
    const needsSearchRequest = module.id !== 'users' && await search.inputValue() !== module.search;
    const beforeSearch = reads.length;
    await search.fill(module.search);
    await until(async () => (!needsSearchRequest || reads.slice(beforeSearch).some(read => read.path === module.api && read.method === 'GET' && new URLSearchParams(read.query).get('search') === module.search)) && !await refresh.isDisabled() && (await region.textContent()).includes(`${refreshedTotal} total`), module.id + ' search restored');
    await page.getByRole('navigation', { name: 'Pagination' }).getByRole('button', { name: 'Next page' }).click();
    await until(async () => !await refresh.isDisabled() && await page.getByRole('navigation', { name: 'Pagination' }).getByText(/Page 2 of/).count() > 0, module.id + ' page before deletion');
    const remaining = await call(module.api + `?search=${encodeURIComponent(module.search)}&limit=100`);
    await prisma[module.model].deleteMany({ where: { tenantId: tenant.id, id: { in: remaining.body.data.slice(2).map(row => row.id) } } });
    await refresh.click();
    await until(async () => !await refresh.isDisabled() && await page.getByRole('navigation', { name: 'Pagination' }).getByText(/Page 1 of 1/).count() > 0 && (await region.textContent()).includes('2 total'), module.id + ' removed page recovered');
    assert.equal(await search.inputValue(), module.search);
    record(`${module.id}: column-specific sorting and settings dialog apply/cancel/defaults, drawer, width-only reset/reload, valid/removed-page refresh, one request, failure/retry and keyboard focus`);
  }
  assert.equal(await prisma.userPreference.count({ where: { tenantId: foreignTenant.id } }), 0, 'Writes did not touch another tenant');
}

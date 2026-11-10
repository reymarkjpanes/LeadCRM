import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PERMISSION_GROUPS, PERMISSION_MODULES, EMPTY_PERMISSION_FLAGS, permissionLabel } from '@leadcrm/shared';
import { DataProvider } from '@/store/DataContext';
import { RolesPermissions } from '../roles-permissions';
import { rolesService } from '@/features/tenant/administration/roles/services/roles.service';
import { usersService } from '@/features/tenant/administration/users/services/users.service';
const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), denied: [] as string[], tenantId: 'tenant-a' }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({
  tenant: { id: mocks.tenantId }, user: { id: 'admin', role: 'Client Admin', status: 'ACTIVE', onboardingCompletedAt: '2026-01-01' }, userCan: (module: string, action: string) => !mocks.denied.includes(`${module}.${action}`),
}) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/shared/utils/toast', () => ({ toast: mocks }));
const savedRoles: object[] = [];
let directoryUsers: object[] = [];
let directoryPending: Promise<void> | undefined;
let directoryDenied = false;
let failure = '';
let pending: Promise<void> | undefined;
let holdCrm = false;
let rolesPending: Promise<void> | undefined;
let permissionModules = PERMISSION_MODULES;
const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
  const path = url.split('?')[0];
  if (path.endsWith('/archive') && options?.method === 'PATCH') {
    if (pending) await pending;
    if (failure) return { ok: false, status: 409, json: async () => ({ error: failure }) };
    return { ok: true, json: async () => ({ success: true }) };
  }
  if (holdCrm && path.endsWith('/crm/accounts')) return new Promise<never>(() => {});
  if (path.endsWith('/administration/users')) {
    if (directoryPending) await directoryPending;
    if (directoryDenied) return { ok: false, status: 403, json: async () => ({ error: 'Users access denied' }) };
    return { ok: true, json: async () => ({ data: directoryUsers }) };
  }
  if (path.endsWith('/administration/permissions')) return { ok: true, json: async () => ({ data: permissionModules }) };
  if (path.includes('/administration/roles/') && options?.method === 'PUT') {
    if (pending) await pending;
    if (failure) return { ok: false, status: 409, json: async () => ({ error: failure }) };
    const id = path.split('/').pop();
    const index = savedRoles.findIndex(role => (role as { id: string }).id === id);
    const body = JSON.parse(String(options.body));
    const data = { ...savedRoles[index], ...body, permissions: body.permissions.map((row: object) => ({ ...row, id: 'database-permission', roleId: id })) };
    savedRoles[index] = data;
    return { ok: true, json: async () => ({ success: true, data }) };
  }
  if (path.endsWith('/administration/roles')) {
    if (options?.method === 'POST') {
      if (pending) await pending;
      if (failure) return { ok: false, status: 409, json: async () => ({ error: failure }) };
      const body = JSON.parse(String(options.body));
      const data = { ...body, id: 'database-role', tenantId: 'tenant-a', isSystemRole: false, isArchived: false, userCount: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', permissions: body.permissions.map((row: object) => ({ ...row, id: 'database-permission', roleId: 'database-role' })) };
      savedRoles.push(data);
      return { ok: true, json: async () => ({ success: true, data }) };
    }
    const data = [...savedRoles];
    if (rolesPending) await rolesPending;
    return { ok: true, json: async () => ({ data }) };
  }
  return { ok: true, json: async () => ({ data: [], meta: { total: 0, totalPages: 0 } }) };
});
beforeEach(() => { localStorage.clear(); mocks.denied = []; mocks.tenantId = 'tenant-a'; savedRoles.length = 0; directoryUsers = []; directoryPending = undefined; directoryDenied = false; failure = ''; pending = undefined; rolesPending = undefined; holdCrm = false; permissionModules = PERMISSION_MODULES; fetcher.mockClear(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<DataProvider><RolesPermissions /></DataProvider>);
async function open() { const view = mount(); const button = await screen.findByRole('button', { name: 'Create Custom Role' }); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button); return view; }
const posts = () => fetcher.mock.calls.filter(([url, options]) => url.endsWith('/administration/roles') && options?.method === 'POST');
const puts = () => fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT');
const deletes = () => fetcher.mock.calls.filter(([url, options]) => url.endsWith('/archive') && options?.method === 'PATCH');
const customRole = (userCount = 0) => ({ id: 'staff-role', name: 'Staff', tenantId: 'tenant-a', isSystemRole: false, isArchived: false, userCount, permissions: [] });
const permissionRows = (ids: string[]) => PERMISSION_MODULES.filter(module => ids.some(id => id.startsWith(`${module.key}.`)))
  .map(module => ({ ...EMPTY_PERMISSION_FLAGS, module: module.key, ...Object.fromEntries(module.actions.map(action => [action, ids.includes(`${module.key}.${action}`)])) }));
async function enterEdit(name = 'Staff') {
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));
  await screen.findByRole('heading', { name: 'Edit Role' });
}
async function openEdit(ids: string[] = [], userCount = 0) {
  savedRoles.push({ ...customRole(userCount), description: 'Saved description', permissions: permissionRows(ids) });
  const view = mount();
  await enterEdit();
  return view;
}
const openTable = (mode: 'create' | 'edit') => mode === 'create' ? open() : openEdit();
async function openDelete(userCount = 0) {
  savedRoles.push(customRole(userCount)); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Staff' }));
  expect(screen.queryByRole('menuitem', { name: 'Archive Role' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Role' }));
  return screen.getByRole('alertdialog');
}

it('saves and reloads independent Workflow capabilities without changing Lead grants', async () => {
  const view = await openEdit(['leads.canView', 'leads.canEdit', 'workflows.canView', 'workflows.canExecute', 'workflows.canViewRuns']);
  expect(screen.getByRole('checkbox', { name: 'Activate Workflows' })).toHaveProperty('checked', false);
  expect(screen.getByRole('checkbox', { name: 'Execute / Run Check Workflows' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pause / Resume Workflows' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(puts()).toHaveLength(1));
  await screen.findByRole('button', { name: 'Actions for Staff' });
  const submitted = JSON.parse(String(puts()[0][1]?.body));
  expect(submitted.permissions.find((permission: { module: string }) => permission.module === 'leads')).toEqual({ ...EMPTY_PERMISSION_FLAGS, module: 'leads', canView: true, canEdit: true });
  view.unmount(); mount(); await enterEdit();
  for (const name of ['Pause / Resume Workflows', 'Execute / Run Check Workflows', 'View Workflow Runs']) expect(screen.getByRole('checkbox', { name })).toHaveProperty('checked', true);
  for (const name of ['Activate Workflows', 'Create Workflows', 'Edit Workflows', 'Delete Workflows']) expect(screen.getByRole('checkbox', { name })).toHaveProperty('checked', false);
});

it('links RBAC guidance to the existing Roles & Permissions Help Center category in the same tab', () => {
  mount();
  const link = screen.getByRole('link', { name: 'Learn more about RBAC' });
  expect(link.getAttribute('href')).toBe('/help/category/roles');
  expect(link.hasAttribute('target')).toBe(false);
  expect(link.className).toContain('hover:underline');
  expect(link.className).toContain('focus-visible:ring-2');
  link.focus(); expect(document.activeElement).toBe(link);
  expect(screen.queryByRole('button', { name: 'Learn more about RBAC' })).toBeNull();
});

it.each([1, 5])('uses the server count to block deletion of a role assigned to %s users without a PATCH', async count => {
  const dialog = await openDelete(count);
  expect(within(dialog).getByText('Role cannot be deleted')).toBeTruthy();
  expect(within(dialog).getByText(`This role is currently assigned to ${count} user(s). Reassign them to another role before deleting this role.`)).toBeTruthy();
  expect(within(dialog).getByText('Users must have another role assigned before this role can be deleted.')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: 'Delete Role' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(deletes()).toHaveLength(0);
  expect(screen.getByText('Staff')).toBeTruthy();
});

it('confirms an unassigned role with its name and keeps it active on Cancel', async () => {
  const dialog = await openDelete();
  expect(within(dialog).getByText('Delete role?')).toBeTruthy();
  expect(within(dialog).getByText('Delete "Staff"? The role will be removed from active use.')).toBeTruthy();
  expect(within(dialog).getByText('This role will no longer be available for assignment after deletion.')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Delete Role' }).className).toContain('bg-red-600');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(deletes()).toHaveLength(0); expect(screen.getByText('Staff')).toBeTruthy();
});

it('submits deletion exactly once while pending, closes on success and removes the role', async () => {
  const dialog = await openDelete();
  let finish!: () => void; pending = new Promise(resolve => { finish = resolve; });
  const button = within(dialog).getByRole('button', { name: 'Delete Role' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button).toHaveProperty('disabled', true); expect(deletes()).toHaveLength(1);
  expect(mocks.success).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByText('Staff')).toBeNull());
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Role deleted.');
});

it('retains the role and displays a backend conflict when assignment counts become stale', async () => {
  const dialog = await openDelete();
  failure = 'Role has 1 assigned user(s). Reassign users to another role before deleting.';
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Role' }));
  expect((await screen.findByRole('alert')).textContent).toBe(failure);
  expect(screen.getByText('Staff')).toBeTruthy(); expect(mocks.success).not.toHaveBeenCalled();
});
it.each(['canCreate', 'canEdit'])('closes an open editor when %s is revoked without sending a mutation', async action => {
  savedRoles.push({ id: 'staff-role', name: 'Staff', tenantId: 'tenant-a', isSystemRole: false, isArchived: false, permissions: [] });
  const view = mount();
  await screen.findByText('Staff');
  if (action === 'canCreate') fireEvent.click(screen.getByRole('button', { name: 'Create Custom Role' }));
  else {
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Staff' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));
  }
  const oldForm = screen.getByLabelText('Role Name *').closest('form')!;
  mocks.denied = [`roles.${action}`];
  view.rerender(<DataProvider><RolesPermissions /></DataProvider>);
  expect(screen.queryByLabelText('Role Name *')).toBeNull();
  fireEvent.submit(oldForm);
  expect(fetcher.mock.calls.filter(([, options]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options?.method ?? ''))).toHaveLength(0);
});
it('dismisses a deletion confirmation when Archive is revoked and denies the section without View', async () => {
  savedRoles.push({ id: 'staff-role', name: 'Staff', tenantId: 'tenant-a', isSystemRole: false, isArchived: false, permissions: [] });
  const view = mount(); await screen.findByText('Staff');
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Staff' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Role' }));
  expect(screen.getByText('Delete role?')).toBeTruthy();
  mocks.denied = ['roles.canArchive']; view.rerender(<DataProvider><RolesPermissions /></DataProvider>);
  expect(screen.queryByText('Delete role?')).toBeNull();
  mocks.denied = ['roles.canView']; view.rerender(<DataProvider><RolesPermissions /></DataProvider>);
  expect(screen.getByRole('alert').textContent).toContain('permission');
  expect(screen.queryByText('Staff')).toBeNull();
});
it('blocks whitespace names with one inline error and no POST', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  expect(screen.getAllByText('Role name is required.')).toHaveLength(1);
  expect(posts()).toHaveLength(0); expect(mocks.error).not.toHaveBeenCalled();
});
it('synchronizes row/individual checkboxes, sends module flags through the real client, waits, and reloads the response', async () => {
  localStorage.setItem('leadcrm_roles', '[{"name":"Obsolete"}]');
  const view = await open();
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: ' Sales Assistant ' } });
  const contacts = screen.getByRole('checkbox', { name: 'Select all Contacts permissions' });
  expect(contacts.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(contacts);
  expect(screen.getByText('8/8')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Edit Contacts' }));
  expect(screen.getByText('7/8')).toBeTruthy(); expect(contacts).toHaveProperty('indeterminate', true);
  fireEvent.click(contacts); expect(screen.getByText('8/8')).toBeTruthy();
  fireEvent.click(contacts); expect(within(contacts.closest('tr')!).getByText('0/8')).toBeTruthy(); fireEvent.click(contacts);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all Deals permissions' }));
  let finish!: () => void; pending = new Promise(resolve => { finish = resolve; });
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(posts()).toHaveLength(1);
  expect(mocks.success).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).disabled)).toBe(true);
  const [url, options] = posts()[0];
  expect(url).toBe('/api/proxy/administration/roles'); expect(options?.credentials).toBe('include');
  expect(JSON.parse(String(options?.body))).toEqual({ name: 'Sales Assistant', description: '', permissions: ['contacts', 'deals'].map(module => ({ ...EMPTY_PERMISSION_FLAGS, module, ...Object.fromEntries(PERMISSION_MODULES.find(row => row.key === module)!.actions.map(action => [action, true])) })) });
  await act(async () => finish()); await screen.findByText('Sales Assistant');
  expect(mocks.success).toHaveBeenCalledTimes(1); expect(localStorage.getItem('leadcrm_roles')).toBeNull();
  view.unmount(); mount(); await screen.findByText('Sales Assistant');
});
it('keeps values and permissions on server failure and allows a zero-permission role', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: 'Sales Assistant' } });
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Retain this' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all Contacts permissions' }));
  failure = 'A role with this name already exists.';
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  await screen.findByText(failure); expect(screen.getByDisplayValue('Retain this')).toBeTruthy(); expect(screen.getByText('8/8')).toBeTruthy();
  expect(mocks.success).not.toHaveBeenCalled(); expect(savedRoles).toHaveLength(0);
  failure = ''; fireEvent.click(screen.getByRole('checkbox', { name: 'Select all Contacts permissions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  await waitFor(() => expect(savedRoles).toHaveLength(1));
  expect(JSON.parse(String(posts()[1][1]?.body)).permissions).toEqual([]);
});

const totalPermissions = () => permissionModules.reduce((total, module) => total + module.actions.length, 0);
const selectModule = (label: string) => screen.getByRole('checkbox', { name: `Select all ${label} permissions` });
const moduleRow = (label: string) => selectModule(label).closest('tr')!;

it.each(['create', 'edit'] as const)('configures CRM tab grants independently in the existing Additional Permissions column (%s)', async mode => {
  await openTable(mode);
  for (const name of ['All Leads', 'My Leads', 'Active Lead', 'All Contacts', 'My Contacts', 'Active Contacts', 'All Accounts', 'All Deals', 'My Deals']) {
    expect(screen.getByRole('checkbox', { name })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('checkbox', { name: 'My Leads' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Active Lead' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'All Leads' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'All Leads' }));
  expect(screen.getByRole('checkbox', { name: 'All Leads' })).toHaveProperty('checked', false);
  expect(screen.getByRole('checkbox', { name: 'My Leads' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'Active Lead' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'View Leads' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'My Contacts' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('checkbox', { name: 'View Leads' }));
  expect(screen.getByRole('checkbox', { name: 'My Leads' })).toHaveProperty('checked', false);
  expect(screen.getByRole('checkbox', { name: 'Active Lead' })).toHaveProperty('checked', false);
  expect(screen.queryByRole('checkbox', { name: 'Manage Pipeline Stages' })).toBeNull();
});
async function filterModules(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Filter modules' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: label }));
}

it.each(['create', 'edit'] as const)('renders every configured permission once, groups Users/Groups, and uses dashes only for unsupported cells (%s)', async mode => {
  await openTable(mode);
  expect(screen.getByRole('button', { name: `All Modules ${PERMISSION_GROUPS.length}` })).toBeTruthy();
  expect(screen.getByText(`0 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1 + PERMISSION_GROUPS.length + totalPermissions());
  for (const group of PERMISSION_GROUPS) {
    const row = moduleRow(group.label);
    const modules = permissionModules.filter(module => group.modules.includes(module.key));
    expect(within(row).getByText(`0/${modules.reduce((total, module) => total + module.actions.length, 0)}`)).toBeTruthy();
    expect(row.querySelector('svg')).toBeTruthy();
    for (const module of modules) for (const action of module.actions) {
      expect(within(row).getByRole('checkbox', { name: permissionLabel(module, action) })).toBeTruthy();
    }
    const cells = row.querySelectorAll('td');
    (['canView', 'canCreate', 'canEdit', 'canArchive', 'canImport'] as const).forEach((action, index) => {
      const available = modules.filter(module => module.actions.includes(action));
      expect(within(cells[index + 2]).queryAllByRole('checkbox')).toHaveLength(available.length);
      if (!available.length) expect(cells[index + 2].textContent).toBe('—');
    });
  }
  expect(within(moduleRow('Team Management')).getByText('0/9')).toBeTruthy();
});

it.each(['create', 'edit'] as const)('updates row/global mixed states and counts while retaining View prerequisites (%s)', async mode => {
  await openTable(mode);
  const contacts = selectModule('Contacts');
  const all = screen.getByRole('checkbox', { name: 'Select all permissions' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Edit Contacts' }));
  expect(screen.getByRole('checkbox', { name: 'View Contacts' })).toHaveProperty('checked', true);
  expect(contacts).toHaveProperty('indeterminate', true);
  expect(contacts.getAttribute('aria-checked')).toBe('mixed');
  expect(all).toHaveProperty('indeterminate', true);
  expect(within(moduleRow('Contacts')).getByText('2/8')).toBeTruthy();
  expect(screen.getByText(`2 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  fireEvent.click(contacts);
  expect(contacts).toHaveProperty('checked', true);
  expect(contacts).toHaveProperty('indeterminate', false);
  fireEvent.click(screen.getByRole('checkbox', { name: 'View Contacts' }));
  expect(within(moduleRow('Contacts')).getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true);
  expect(all).toHaveProperty('indeterminate', false);
  fireEvent.click(all);
  expect(screen.getByText(`${totalPermissions()} / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(all);
  expect(screen.getByText(`0 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
});

it('keeps Users and Groups independent, including additional actions, and submits their existing flags', async () => {
  await open();
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: 'Team Coordinator' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Create Groups' }));
  expect(screen.getByRole('checkbox', { name: 'View Groups' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'View Users' })).toHaveProperty('checked', false);
  expect(within(moduleRow('Team Management')).getByText('2/9')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Activate / Deactivate Users' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Delete Groups' }));
  expect(within(moduleRow('Team Management')).getByText('5/9')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  await screen.findByText('Team Coordinator');
  const body = JSON.parse(String(posts()[0][1]?.body));
  expect(body.permissions).toEqual([
    { ...EMPTY_PERMISSION_FLAGS, module: 'groups', canView: true, canCreate: true, canDelete: true },
    { ...EMPTY_PERMISSION_FLAGS, module: 'users', canView: true, canActivate: true },
  ]);
});

it.each(['create', 'edit'] as const)('searches display names only and selects/clears all permissions even while most rows are hidden (%s)', async mode => {
  await openTable(mode);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Edit Contacts' }));
  const search = screen.getByRole('textbox', { name: 'Search modules' });
  fireEvent.change(search, { target: { value: ' LEADS ' } });
  expect(screen.queryByRole('checkbox', { name: 'Select all Contacts permissions' })).toBeNull();
  expect(selectModule('Leads')).toBeTruthy();
  const all = screen.getByRole('checkbox', { name: 'Select all permissions' });
  expect(all).toHaveProperty('indeterminate', true);
  fireEvent.click(all);
  expect(screen.getByText(`${totalPermissions()} / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  fireEvent.click(all);
  expect(screen.getByText(`0 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  fireEvent.click(selectModule('Leads'));
  fireEvent.change(search, { target: { value: 'import' } });
  expect(screen.getByText('No modules found')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(selectModule('Leads')).toHaveProperty('checked', true);
  expect(selectModule('Contacts')).toHaveProperty('checked', false);
  expect(puts()).toHaveLength(0);
  expect(posts()).toHaveLength(0);
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['create', 'edit'] as const)('filters selected/empty modules live and restores dropdown focus without changing grants (%s)', async mode => {
  await openTable(mode);
  await filterModules('Has Permissions Selected');
  expect(screen.getByText('No modules found')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filter modules' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all permissions' }));
  expect(selectModule('Dashboard')).toBeTruthy();
  fireEvent.click(selectModule('Contacts'));
  expect(screen.queryByRole('checkbox', { name: 'Select all Contacts permissions' })).toBeNull();
  await filterModules('No Permissions Selected');
  expect(selectModule('Contacts')).toHaveProperty('checked', false);
  expect(screen.queryByRole('checkbox', { name: 'Select all Leads permissions' })).toBeNull();
  await filterModules('All Modules');
  expect(selectModule('Leads')).toHaveProperty('checked', true);
  expect(selectModule('Contacts')).toHaveProperty('checked', false);
});

it.each(['create', 'edit'] as const)('paginates locally without losing grants, clamps after filter changes, and selects across pages (%s)', async mode => {
  await openTable(mode);
  fireEvent.click(screen.getByRole('button', { name: 'Records per page' }));
  fireEvent.click(screen.getByRole('option', { name: '10' }));
  expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  fireEvent.click(selectModule('Contacts'));
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all permissions' }));
  expect(screen.getByText(`${totalPermissions()} / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  await filterModules('Has Permissions Selected');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  for (const group of PERMISSION_GROUPS.slice(10)) fireEvent.click(selectModule(group.label));
  expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  expect(selectModule('Contacts')).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all permissions' }));
  expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search modules' }), { target: { value: 'Dashboard' } });
  expect(screen.getByText('Page 1 of 1')).toBeTruthy();
});

it('uses loaded availability for totals and never enables or submits an unsupported grant', async () => {
  permissionModules = PERMISSION_MODULES.map(module => module.key === 'leads' ? { ...module, actions: module.actions.filter(action => action !== 'canImport') } : module);
  await open();
  expect(screen.queryByRole('checkbox', { name: 'Import Leads' })).toBeNull();
  expect(screen.getByText(`0 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: 'Catalog Role' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all permissions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  await screen.findByText('Catalog Role');
  const rows = JSON.parse(String(posts()[0][1]?.body)).permissions;
  for (const row of rows) for (const [action, value] of Object.entries(row)) {
    if (value === true) expect(permissionModules.find(module => module.key === row.module)?.actions).toContain(action);
  }
  expect(rows.find((row: { module: string }) => row.module === 'leads').canImport).toBe(false);
});

it('uses the table in Edit and preserves both create-view exit actions without posting', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Back to roles' }));
  expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Create Custom Role' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(posts()).toHaveLength(0);
  cleanup(); savedRoles.push(customRole()); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Staff' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));
  expect(within(screen.getByRole('region', { name: 'Module permissions' })).getByRole('grid')).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
});


it.each(['empty', 'partial', 'full'])('loads saved role fields, assigned users, checkboxes and counts (%s)', async selection => {
  const ids = PERMISSION_MODULES.filter(module => selection === 'full' || selection === 'partial' && module.key !== 'forms')
    .flatMap(module => module.actions.map(action => `${module.key}.${action}`));
  directoryUsers = [
    { id: 'active-staff', role: 'Staff', status: 'ACTIVE' },
    { id: 'archived-staff', role: 'Staff', status: 'INACTIVE' },
    { id: 'other-staff', role: 'Other', status: 'ACTIVE' },
  ];
  await openEdit(ids, 1);
  expect(screen.getByLabelText('Role Name *')).toHaveProperty('value', 'Staff');
  expect(screen.getByLabelText('Description — Optional')).toHaveProperty('value', 'Saved description');
  expect(screen.getByText('Custom Role')).toBeTruthy();
  await screen.findByText('1 user assigned');
  expect(screen.getByText(`${ids.length} of ${totalPermissions()}`)).toBeTruthy();
  expect(screen.getByText(`${ids.length} / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  const checkboxes = new Map(screen.getAllByRole('checkbox').map(input => [input.getAttribute('aria-label'), input]));
  for (const module of permissionModules) for (const action of module.actions) {
    expect(checkboxes.get(permissionLabel(module, action))).toHaveProperty('checked', ids.includes(`${module.key}.${action}`));
  }
  for (const group of PERMISSION_GROUPS) {
    const moduleIds = permissionModules.filter(module => group.modules.includes(module.key)).flatMap(module => module.actions.map(action => `${module.key}.${action}`));
    expect(within(moduleRow(group.label)).getByText(`${moduleIds.filter(id => ids.includes(id)).length}/${moduleIds.length}`)).toBeTruthy();
  }
  expect(puts()).toHaveLength(0);
  expect(screen.queryByRole('switch')).toBeNull();
});

it('saves the complete edited permission payload once, including hidden and additional grants, and reopens the response', async () => {
  await openEdit(['leads.canView', 'contacts.canView', 'contacts.canEdit', 'roles.canView', 'roles.canEdit'], 2);
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: ' Staff Updated ' } });
  fireEvent.change(screen.getByLabelText('Description — Optional'), { target: { value: ' Updated description ' } });
  fireEvent.click(screen.getByLabelText('View Leads'));
  fireEvent.click(screen.getByLabelText('Select all Contacts permissions'));
  fireEvent.click(screen.getByLabelText('View Workflow Runs'));
  fireEvent.click(screen.getByLabelText('Delete Groups'));
  expect(screen.getByLabelText('View Groups')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('View Users')).toHaveProperty('checked', false);
  expect(within(moduleRow('Team Management')).getByText('2/9')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search modules'), { target: { value: 'Contacts' } });
  let finish!: () => void; pending = new Promise(resolve => { finish = resolve; });
  const submit = screen.getByRole('button', { name: 'Save Changes' });
  const form = submit.closest('form')!;
  fireEvent.click(submit); fireEvent.submit(form);
  await waitFor(() => expect(puts()).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).disabled)).toBe(true);
  for (const label of ['Role Name *', 'Description — Optional', 'Search modules']) expect(screen.getByLabelText(label)).toHaveProperty('disabled', true);
  for (const name of ['Cancel', 'Back to roles', 'Filter modules', 'Records per page']) expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
  expect(mocks.success).not.toHaveBeenCalled();
  const [url, options] = puts()[0];
  expect(url).toMatch(/\/administration\/roles\/staff-role$/);
  const body = JSON.parse(String(options?.body));
  expect(body).toEqual({ name: 'Staff Updated', description: 'Updated description', permissions: expect.any(Array) });
  expect(body.permissions).toHaveLength(4);
  expect(body.permissions).toEqual(expect.arrayContaining([
    { ...EMPTY_PERMISSION_FLAGS, module: 'contacts', canView: true, canViewAll: true, canViewMy: true, canViewActive: true, canCreate: true, canEdit: true, canArchive: true, canImport: true },
    { ...EMPTY_PERMISSION_FLAGS, module: 'roles', canView: true, canEdit: true },
    { ...EMPTY_PERMISSION_FLAGS, module: 'workflows', canView: true, canViewRuns: true },
    { ...EMPTY_PERMISSION_FLAGS, module: 'groups', canView: true, canDelete: true },
  ]));
  await act(async () => finish());
  await screen.findByRole('heading', { name: 'Roles & Permissions' });
  expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Role updated.');
  expect(savedRoles[0]).toMatchObject({ id: 'staff-role', tenantId: 'tenant-a', userCount: 2, isSystemRole: false, isArchived: false });
  await enterEdit('Staff Updated');
  expect(screen.getByLabelText('Role Name *')).toHaveProperty('value', body.name);
  expect(screen.getByLabelText('Description — Optional')).toHaveProperty('value', body.description);
  expect(screen.getByText(`14 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
  expect(screen.getByLabelText('Select all Contacts permissions')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('Delete Groups')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('View Leads')).toHaveProperty('checked', false);
  expect(screen.getByLabelText('Search modules')).toHaveProperty('value', '');
});

it('validates edits, retains the draft on failure, and supports saving an empty permission replacement', async () => {
  await openEdit(['contacts.canView', 'contacts.canEdit']);
  const name = screen.getByLabelText('Role Name *');
  for (const [value, message] of [['   ', 'Role name is required.'], ['X', 'Name must be at least 2 characters']]) {
    fireEvent.change(name, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(puts()).toHaveLength(0);
  }
  fireEvent.change(name, { target: { value: 'Retain edited draft' } });
  failure = 'A role with this name already exists.';
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await screen.findByText(failure);
  expect(name).toHaveProperty('value', 'Retain edited draft');
  expect(screen.getByRole('checkbox', { name: 'Edit Contacts' })).toHaveProperty('checked', true);
  expect(mocks.success).not.toHaveBeenCalled();
  failure = '';
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all permissions' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all permissions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await screen.findByRole('heading', { name: 'Roles & Permissions' });
  expect(JSON.parse(String(puts()[1][1]?.body)).permissions).toEqual([]);
  await enterEdit('Retain edited draft');
  expect(screen.getByText(`0 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
});

it.each(['Cancel', 'Back to roles'])('discards only the edit draft with %s and opens Create with its empty selection', async action => {
  await openEdit(['contacts.canView', 'contacts.canEdit']);
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: 'Unsaved name' } });
  fireEvent.click(selectModule('Contacts'));
  fireEvent.click(screen.getByRole('button', { name: action }));
  expect(puts()).toHaveLength(0);
  await enterEdit();
  expect(screen.getByLabelText('Role Name *')).toHaveProperty('value', 'Staff');
  expect(screen.getByRole('checkbox', { name: 'Edit Contacts' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'Create Contacts' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Custom Role' }));
  expect(screen.getByLabelText('Role Name *')).toHaveProperty('value', '');
  expect(screen.getByText(`0 / ${totalPermissions()} permissions enabled`)).toBeTruthy();
});

it('keeps protected actions visible and disabled without navigation or requests', async () => {
  savedRoles.push({ id: 'admin-role', name: 'Client Admin', tenantId: 'tenant-a', isSystemRole: true, isArchived: false, permissions: [] });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Client Admin' }));
  const callsBefore = fetcher.mock.calls.length;
  for (const name of ['Edit Permissions', 'Delete Role']) {
    const action = screen.getByRole('menuitem', { name });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(action);
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.keyDown(action, { key: ' ' });
  }
  expect(screen.queryByText('Edit Role')).toBeNull();
  expect(screen.queryByText('Delete role?')).toBeNull();
  expect(fetcher.mock.calls.length).toBe(callsBefore);
  expect(screen.getByRole('menuitem', { name: 'Duplicate Role' }).getAttribute('aria-disabled')).toBe('false');
  expect(screen.queryByText('perms')).toBeNull();
  expect(screen.getByText('permissions')).toBeTruthy();
});

it('toggles a role menu with a full pointer sequence, dismisses it, and opens only one role at a time', async () => {
  savedRoles.push(...['First', 'Second'].map(name => ({ id: name, name, tenantId: 'tenant-a', isSystemRole: false, isArchived: false, permissions: [] })));
  mount();
  const first = await screen.findByRole('button', { name: 'Actions for First' });
  const second = screen.getByRole('button', { name: 'Actions for Second' });
  const click = (element: HTMLElement) => { fireEvent.mouseDown(element); fireEvent.mouseUp(element); fireEvent.click(element); };
  click(first); expect(screen.getAllByRole('menu')).toHaveLength(1);
  click(first); expect(screen.queryByRole('menu')).toBeNull();
  click(first); click(second);
  expect(screen.getAllByRole('menu')).toHaveLength(1);
  expect(screen.getByRole('menu', { name: 'Actions for Second' })).toBeTruthy();
  expect(first.getAttribute('aria-expanded')).toBe('false');
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(second);
  click(first); fireEvent.mouseDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  click(first); fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Permissions' }));
  expect(screen.getByText('Edit Role')).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
});

it('shows card-shaped skeletons while loading, then roles or the empty state', async () => {
  let finish!: () => void; rolesPending = new Promise(resolve => { finish = resolve; });
  mount();
  const skeleton = await screen.findByRole('status', { name: 'Loading roles and permissions' });
  expect(skeleton.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  expect(skeleton.querySelectorAll('button')).toHaveLength(0);
  expect(screen.queryByText('Loading roles and permissions…')).toBeNull();
  await act(async () => finish()); await screen.findByText('No roles yet.');
  expect(screen.queryByRole('status', { name: 'Loading roles and permissions' })).toBeNull();
});

it.each([0, 1, 7])('uses the same persisted count of %s on the card and editor with an empty directory', async count => {
  savedRoles.push(customRole(count));
  mount();
  await screen.findByText(count === 0 ? 'No users' : `${count} ${count === 1 ? 'user' : 'users'}`);
  await enterEdit();
  expect(screen.getByText(`${count} user${count === 1 ? '' : 's'} assigned`)).toBeTruthy();
});

it.each(['pending', 'denied', 'different primary role'] as const)('shows assigned users independently of a directory that is %s', async state => {
  savedRoles.push(customRole(7));
  let finish!: () => void;
  if (state === 'pending') directoryPending = new Promise(resolve => { finish = resolve; });
  if (state === 'denied') directoryDenied = true;
  directoryUsers = [{ id: 'secondary-role-user', role: 'Other primary role', status: 'ACTIVE' }];
  mount();
  await enterEdit();
  expect(screen.getByText('7 users assigned')).toBeTruthy();
  expect(screen.queryByText('0 users assigned')).toBeNull();
  if (state === 'pending') await act(async () => finish());
  expect(screen.getByText('7 users assigned')).toBeTruthy();
});

it('preserves a system role count and its protected actions', async () => {
  savedRoles.push({ ...customRole(2), id: 'admin-role', name: 'Client Admin', isSystemRole: true });
  mount();
  await screen.findByText('2 users');
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Client Admin' }));
  expect(screen.getByRole('menuitem', { name: 'Edit Permissions' }).getAttribute('aria-disabled')).toBe('true');
  expect(screen.queryByText('Edit Role')).toBeNull();
});

it('refreshes both role counts after Team Management reassigns a user while preserving the edit draft', async () => {
  savedRoles.push(customRole(7), { ...customRole(1), id: 'other-role', name: 'Other' });
  mount(); await enterEdit();
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: 'Unsaved rename' } });
  fireEvent.change(screen.getByLabelText('Description — Optional'), { target: { value: 'Unsaved description' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'View Contacts' }));
  savedRoles[0] = customRole(6);
  savedRoles[1] = { ...customRole(2), id: 'other-role', name: 'Other' };
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: { id: 'assigned-user', tenantId: 'tenant-a', role: 'Other', status: 'ACTIVE' } }) });
  await act(async () => { await usersService.update('assigned-user', { role: 'Other' }); });
  await screen.findByText('6 users assigned');
  expect(screen.getByLabelText('Role Name *')).toHaveProperty('value', 'Unsaved rename');
  expect(screen.getByLabelText('Description — Optional')).toHaveProperty('value', 'Unsaved description');
  expect(screen.getByRole('checkbox', { name: 'View Contacts' })).toHaveProperty('checked', true);
  expect(puts()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('6 users')).toBeTruthy(); expect(screen.getByText('2 users')).toBeTruthy();
  await enterEdit('Other'); expect(screen.getByText('2 users assigned')).toBeTruthy();
});

it('refreshes role counts after successful direct assignment and removal', async () => {
  await openEdit([], 7);
  savedRoles[0] = customRole(8);
  await act(async () => { await rolesService.assign('assigned-user', 'staff-role'); });
  await screen.findByText('8 users assigned');
  savedRoles[0] = customRole(7);
  await act(async () => { await rolesService.unassign('assigned-user', 'staff-role'); });
  await screen.findByText('7 users assigned');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('7 users')).toBeTruthy();
});

it('keeps the persisted count after rename, reopening and remounting', async () => {
  const view = await openEdit([], 7);
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: 'Renamed staff' } });
  expect(screen.getByText('7 users assigned')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await screen.findByText('Renamed staff'); expect(screen.getByText('7 users')).toBeTruthy();
  await enterEdit('Renamed staff'); expect(screen.getByText('7 users assigned')).toBeTruthy();
  view.unmount(); mount();
  await enterEdit('Renamed staff'); expect(screen.getByText('7 users assigned')).toBeTruthy();
});

it('keeps the last confirmed count during initial loading and background refresh without a zero placeholder', async () => {
  savedRoles.push(customRole(7));
  let finish!: () => void; rolesPending = new Promise(resolve => { finish = resolve; });
  mount();
  expect(screen.getByRole('status', { name: 'Loading roles and permissions' })).toBeTruthy();
  expect(screen.queryByText(/^0 users/)).toBeNull();
  await act(async () => finish()); await enterEdit();
  rolesPending = new Promise(resolve => { finish = resolve; });
  savedRoles[0] = customRole(8);
  act(() => { window.dispatchEvent(new Event('leadcrm:users-changed')); });
  expect(screen.getByText('7 users assigned')).toBeTruthy(); expect(screen.queryByText('0 users assigned')).toBeNull();
  await act(async () => finish()); await screen.findByText('8 users assigned');
});

it.each(['resolve', 'reject'] as const)('ignores an older role refresh that finishes with %s after the latest response', async outcome => {
  await openEdit([], 7);
  let finish!: () => void;
  rolesPending = new Promise<void>((resolve, reject) => { finish = outcome === 'resolve' ? resolve : () => reject(new Error('Stale refresh failed')); });
  act(() => { window.dispatchEvent(new Event('leadcrm:users-changed')); });
  rolesPending = undefined;
  savedRoles[0] = customRole(8);
  act(() => { window.dispatchEvent(new Event('leadcrm:users-changed')); });
  await screen.findByText('8 users assigned');
  await act(async () => finish());
  expect(screen.getByText('8 users assigned')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('8 users')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
});

it('discards a pending role response after changing tenant', async () => {
  savedRoles.push(customRole(7));
  let finish!: () => void; rolesPending = new Promise(resolve => { finish = resolve; });
  const view = mount();
  mocks.tenantId = 'tenant-b'; rolesPending = undefined;
  savedRoles[0] = { ...customRole(2), tenantId: 'tenant-b', name: 'Tenant B staff' };
  view.rerender(<DataProvider><RolesPermissions /></DataProvider>);
  await screen.findByText('Tenant B staff');
  await act(async () => finish());
  expect(screen.getByText('2 users')).toBeTruthy(); expect(screen.queryByText('7 users')).toBeNull();
});

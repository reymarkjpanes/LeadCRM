import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PERMISSION_MODULES, EMPTY_PERMISSION_FLAGS } from '@leadcrm/shared';
import { DataProvider } from '@/store/DataContext';
import { RolesPermissions } from '../roles-permissions';
const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({
  tenant: { id: 'tenant-a' }, user: { id: 'admin', role: 'Client Admin', status: 'ACTIVE', onboardingCompletedAt: '2026-01-01' }, userCan: () => true,
}) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('sonner', () => ({ toast: mocks }));
const savedRoles: object[] = [];
let failure = '';
let pending: Promise<void> | undefined;
let holdCrm = false;
const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
  const path = url.split('?')[0];
  if (holdCrm && path.endsWith('/crm/accounts')) return new Promise<never>(() => {});
  if (path.endsWith('/administration/permissions')) return { ok: true, json: async () => ({ data: PERMISSION_MODULES }) };
  if (path.endsWith('/administration/roles')) {
    if (options?.method === 'POST') {
      if (pending) await pending;
      if (failure) return { ok: false, status: 409, json: async () => ({ error: failure }) };
      const body = JSON.parse(String(options.body));
      const data = { ...body, id: 'database-role', tenantId: 'tenant-a', isSystemRole: false, isArchived: false, userCount: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', permissions: body.permissions.map((row: object) => ({ ...row, id: 'database-permission', roleId: 'database-role' })) };
      savedRoles.push(data);
      return { ok: true, json: async () => ({ success: true, data }) };
    }
    return { ok: true, json: async () => ({ data: savedRoles }) };
  }
  return { ok: true, json: async () => ({ data: [], meta: { total: 0, totalPages: 0 } }) };
});
beforeEach(() => { localStorage.clear(); savedRoles.length = 0; failure = ''; pending = undefined; holdCrm = false; fetcher.mockClear(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<DataProvider><RolesPermissions /></DataProvider>);
async function open() { const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Create Custom Role' })); return view; }
const posts = () => fetcher.mock.calls.filter(([url, options]) => url.endsWith('/administration/roles') && options?.method === 'POST');
it('blocks whitespace names with one inline error and no POST', async () => {
  await open(); fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  expect(screen.getAllByText('Role name is required.')).toHaveLength(1);
  expect(posts()).toHaveLength(0); expect(mocks.error).not.toHaveBeenCalled();
});
it('synchronizes group/individual switches, sends module flags through the real client, waits, and reloads the response', async () => {
  localStorage.setItem('leadcrm_roles', '[{"name":"Obsolete"}]');
  const view = await open();
  fireEvent.change(screen.getByLabelText('Role Name *'), { target: { value: ' Sales Assistant ' } });
  const contacts = screen.getByRole('switch', { name: 'Contacts' });
  expect(contacts.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(contacts);
  expect(screen.getByText('5/5')).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: 'Edit Contacts' }));
  expect(screen.getByText('4/5')).toBeTruthy(); expect(screen.getByText('Partially enabled')).toBeTruthy();
  fireEvent.click(contacts); expect(within(contacts.parentElement!.parentElement!).getByText('0/5')).toBeTruthy(); fireEvent.click(contacts);
  fireEvent.click(screen.getByRole('switch', { name: 'Deals' }));
  let finish!: () => void; pending = new Promise(resolve => { finish = resolve; });
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  expect(mocks.success).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
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
  fireEvent.click(screen.getByRole('switch', { name: 'Contacts' }));
  failure = 'A role with this name already exists.';
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  await screen.findByText(failure); expect(screen.getByDisplayValue('Retain this')).toBeTruthy(); expect(screen.getByText('5/5')).toBeTruthy();
  expect(mocks.success).not.toHaveBeenCalled(); expect(savedRoles).toHaveLength(0);
  failure = ''; fireEvent.click(screen.getByRole('switch', { name: 'Contacts' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Role' }));
  await waitFor(() => expect(savedRoles).toHaveLength(1));
  expect(JSON.parse(String(posts()[1][1]?.body)).permissions).toEqual([]);
});


it('keeps protected actions visible and disabled without navigation or requests', async () => {
  savedRoles.push({ id: 'admin-role', name: 'Client Admin', tenantId: 'tenant-a', isSystemRole: true, isArchived: false, permissions: [] });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for Client Admin' }));
  const callsBefore = fetcher.mock.calls.length;
  for (const name of ['Edit Permissions', 'Archive Role']) {
    const action = screen.getByRole('menuitem', { name });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(action);
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.keyDown(action, { key: ' ' });
  }
  expect(screen.queryByText('Edit Role')).toBeNull();
  expect(screen.queryByText('Archive Role?')).toBeNull();
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
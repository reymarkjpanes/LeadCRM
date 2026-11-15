import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { clearPageCache, invalidatePageCache } from '@/shared/cache/page-cache';
import { clearNotificationTracking } from '@/features/tenant/notifications/hooks/notification-requests';
import { useNotifications } from '@/features/tenant/notifications/hooks/use-notifications';
import { toast } from '@/shared/utils/toast';
import type { NotificationRecord, UnreadNotificationRecord } from '@leadcrm/shared';
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), archive: vi.fn(), impact: vi.fn(), deactivate: vi.fn(), unlock: vi.fn(), groups: vi.fn(), counts: vi.fn(), notificationList: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), delete: vi.fn(), refreshPermissions: vi.fn(), permissionsLoaded: true, permissionsError: null as string | null, rolesLoading: false, rolesError: '', denied: new Set<string>(), role: 'Client Admin' }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 't' }, isLoading: false, authError: null, isPermissionsLoaded: mocks.permissionsLoaded, permissionsError: mocks.permissionsError, refreshPermissions: mocks.refreshPermissions, user: { id: 'admin', tenantId: 't', role: mocks.role, status: 'ACTIVE' }, userCan: (module: string, action: string) => !mocks.denied.has(`${module}.${action}`) }) }));
vi.mock('@/shared/services/groups.api', () => ({ groupsApi: { getAll: mocks.groups } }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ roles: [
  { id: 'r', name: 'Sales', isArchived: false, isSystemRole: false },
  { id: 'sales-admin', name: 'Sales Admin', isArchived: false, isSystemRole: false },
  { id: 'sales-associate', name: 'Sales Associate', isArchived: false, isSystemRole: false },
  { id: 'admin-role', name: 'Client Admin', isArchived: false, isSystemRole: true },
  { id: 'retired-role', name: 'Guest', isArchived: false, isSystemRole: true },
  { id: 'archived-role', name: 'Archived Staff', isArchived: true, isSystemRole: false },
], rolesLoading: mocks.rolesLoading, rolesError: mocks.rolesError, refreshRoles: vi.fn() }) }));
vi.mock('@/features/tenant/administration/users/services/users.service', () => ({ usersService: { getAll: mocks.list, update: mocks.update, archive: mocks.archive, deactivationImpact: mocks.impact, deactivate: mocks.deactivate, unlock: mocks.unlock } }));
vi.mock('@/shared/services/notifications.api', () => ({ notificationsApi: { counts: mocks.counts, list: mocks.notificationList, markRead: mocks.markRead, markAllRead: mocks.markAllRead, delete: mocks.delete } }));
vi.mock('@/shared/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { UsersSubTab } from '../team-management-users';
let notifications: NotificationRecord[];
function notificationSummary() {
  const records = new Map<string, UnreadNotificationRecord>();
  for (const notification of notifications.filter(row => !row.isRead && row.entityType === 'User' && row.entityId)) {
    const previous = records.get(notification.entityId!);
    records.set(notification.entityId!, { entityType: 'User', entityId: notification.entityId!, count: (previous?.count ?? 0) + 1 });
  }
  return { success: true, totalCount: notifications.length, unreadCount: notifications.filter(row => !row.isRead).length,
    unreadRecords: [...records.values()] };
}
beforeEach(() => {
  clearPageCache(); clearNotificationTracking(); vi.resetAllMocks(); mocks.denied.clear(); mocks.role = 'Client Admin'; notifications = [];
  mocks.permissionsLoaded = true; mocks.permissionsError = null;
  mocks.rolesLoading = false; mocks.rolesError = '';
  mocks.groups.mockResolvedValue({ data: [] }); mocks.counts.mockImplementation(async () => notificationSummary());
  mocks.markRead.mockImplementation(async (id: string) => { notifications = notifications.map(row => row.id === id ? { ...row, isRead: true } : row); return notificationSummary(); });
  mocks.markAllRead.mockImplementation(async (before, record) => {
    notifications = notifications.map(row => !record || row.entityType === record.entityType && row.entityId === record.entityId ? { ...row, isRead: true } : row);
    return { ...notificationSummary(), readBefore: before, readRecord: record };
  });
  mocks.delete.mockImplementation(async (ids: string[]) => { notifications = notifications.filter(row => !ids.includes(row.id)); return notificationSummary(); });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); clearPageCache(); clearNotificationTracking(); });
it.each(['Client Admin', 'Sales'])('offers Client Admin creation only to an existing admin: %s', async actor => {
  mocks.role = actor; mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  const create = await screen.findByRole('button', { name: 'New User' });
  await act(async () => { fireEvent.click(create); });
  const role = screen.getByLabelText('Role', { exact: false });
  expect(within(role).queryByRole('option', { name: 'Client Admin' }) !== null).toBe(actor === 'Client Admin');
  expect(within(role).getByRole('option', { name: 'Sales' })).toBeTruthy();
  expect(within(role).getByRole('option', { name: 'Sales Admin' })).toBeTruthy();
  expect(within(role).getByRole('option', { name: 'Sales Associate' })).toBeTruthy();
  expect(within(role).queryByRole('option', { name: 'Guest' })).toBeNull();
  expect(within(role).queryByRole('option', { name: 'Archived Staff' })).toBeNull();
});
it.each(['Sales Admin', 'Sales Associate'])('promotes and reassigns %s in the open detail panel', async role => {
  let saved = { id: 'staff', tenantId: 't', firstName: 'Staff', lastName: 'User', email: 'staff@camxian.com', role, status: 'active' };
  mocks.list.mockImplementation(async () => ({ data: [saved], meta: { hasMore: false } }));
  mocks.update.mockImplementation(async (_id, update) => {
    saved = { ...saved, ...update };
    return { data: saved };
  });
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Staff User' }));
  const panel = within(screen.getByRole('dialog', { name: 'User Details' }));
  fireEvent.click(panel.getByRole('button', { name: 'Edit Role' }));
  const select = panel.getByLabelText('Role');
  expect(select).toHaveProperty('value', role);
  expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(expect.arrayContaining([
    'Client Admin', 'Sales Admin', 'Sales Associate',
  ]));
  fireEvent.change(select, { target: { value: 'Client Admin' } });
  fireEvent.click(panel.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('staff', { role: 'Client Admin' });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(panel.getAllByText('Client Admin')).toHaveLength(2);
  });
  fireEvent.click(panel.getByRole('button', { name: 'Edit Role' }));
  expect(panel.getByLabelText('Role')).toHaveProperty('value', 'Client Admin');
  fireEvent.change(panel.getByLabelText('Role'), { target: { value: role } });
  fireEvent.click(panel.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(mocks.update).toHaveBeenLastCalledWith('staff', { role });
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(panel.getAllByText(role)).toHaveLength(2);
  });
});
it('waits for resolved permissions before reading the Users table during startup invalidation', async () => {
  mocks.permissionsLoaded = false;
  mocks.list.mockResolvedValue({ data: [{ id: 'staff', tenantId: 't', firstName: 'Staff', lastName: 'User', status: 'active', role: 'Sales' }], meta: { hasMore: false } });
  const view = render(<UsersSubTab />);
  expect(screen.getByText('Loading users...')).toBeTruthy();
  expect(mocks.list).not.toHaveBeenCalled();
  act(() => { invalidatePageCache('users', 't', false); mocks.permissionsLoaded = true; });
  view.rerender(<UsersSubTab />);
  expect(await screen.findByRole('button', { name: 'View Staff User' })).toBeTruthy();
  expect(mocks.list).toHaveBeenCalledTimes(1);
});

it('reports permission loading errors and retries through the existing permission reader', async () => {
  mocks.permissionsLoaded = false; mocks.permissionsError = 'Unable to load your permissions.';
  render(<UsersSubTab />);
  expect(await screen.findByText('Unable to load your permissions.')).toBeTruthy();
  expect(mocks.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Retry'));
  expect(mocks.refreshPermissions).toHaveBeenCalledOnce();
});
it('offers task-only replacement staff according to the responsibilities being transferred', async () => {
  const active = { id: 'a', tenantId: 't', firstName: 'Ana', lastName: 'Sales', role: 'Sales', status: 'active', email: 'a@example.com' };
  mocks.list.mockResolvedValue({ data: [active,
    { ...active, id: 'task', firstName: 'Task', lastName: 'Staff', assignableAgent: false, assignableModules: ['tasks'] },
    { ...active, id: 'crm', firstName: 'CRM', lastName: 'Staff', assignableAgent: true, assignableModules: ['leads', 'deals'] },
    { ...active, id: 'admin', firstName: 'Admin', lastName: 'Staff', role: 'Client Admin', assignableAgent: true, assignableModules: ['tasks'] },
  ], meta: { hasMore: false } });
  mocks.impact.mockResolvedValue({ data: { userId: 'a', total: 1, counts: { leads: 0, contacts: 0, accounts: 0, deals: 0, tasks: 1 } } });
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Ana Sales' }));
  const select = await screen.findByRole('combobox', { name: /Assigned Agent/ });
  expect(within(select).getByRole('option', { name: 'Task Staff' })).toBeTruthy();
  expect(within(select).queryByRole('option', { name: 'CRM Staff' })).toBeNull();
  expect(within(select).queryByRole('option', { name: 'Admin Staff' })).toBeNull();
});
it('retains failed deactivation for retry and lets cancellation end the reassignment flow', async () => {
  const active = { id: 'a', tenantId: 't', firstName: 'Ana', lastName: 'Sales', role: 'Sales', status: 'active', email: 'a@example.com' };
  mocks.list.mockResolvedValue({ data: [active], meta: { hasMore: false } });
  mocks.impact.mockResolvedValue({ data: { userId: 'a', total: 0, counts: { leads: 0, contacts: 0, accounts: 0, deals: 0, tasks: 0 } } });
  mocks.deactivate.mockRejectedValue(new Error('Permission denied. Contact your administrator.'));
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review deactivation' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
  expect(screen.getByRole('alertdialog', { name: 'Deactivate this user?' })).toBeTruthy();
  expect(mocks.deactivate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('confirms activation and deactivation, updates the persisted row immediately, and confirms bulk archive', async () => {
  const active = { id: 'a', tenantId: 't', firstName: 'Ana', lastName: 'Sales', role: 'Sales', status: 'active', email: 'a@example.com' };
  mocks.list.mockResolvedValue({ data: [active], meta: { hasMore: false } });
  mocks.impact.mockResolvedValue({ data: { userId: 'a', total: 0, counts: { leads: 0, contacts: 0, accounts: 0, deals: 0, tasks: 0 } } });
  mocks.deactivate.mockResolvedValue({ user: { ...active, status: 'inactive' }, impact: { total: 0 } });
  mocks.update.mockResolvedValueOnce({ data: { ...active, status: 'active' } });
  mocks.archive.mockResolvedValue(undefined);
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  expect(screen.getByRole('menuitem', { name: 'View' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Activate' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Review deactivation' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' }));
  await waitFor(() => expect(mocks.deactivate).toHaveBeenCalledWith('a', null));
  expect(await screen.findByText('inactive')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Activate Ana Sales' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith('a', { status: 'active' }));
  expect(await screen.findByText('active')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(mocks.archive).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('a'));
  await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
});
it('renders saved avatars through the tenant endpoint and falls back on missing or broken images', async () => {
  mocks.list.mockResolvedValue({ data: [
    { id: 'photo', tenantId: 't', firstName: 'Ana', lastName: 'Photo', avatarUrl: '/api/proxy/auth/profile/avatar/saved-image', role: 'Sales' },
    { id: 'missing', tenantId: 't', firstName: 'Ben', lastName: 'Missing', role: 'Sales' },
  ] });
  render(<UsersSubTab />);
  const image = await screen.findByRole('img', { name: 'Ana Photo' });
  expect(image.getAttribute('src')).toBe('/api/proxy/administration/users/photo/avatar/saved-image');
  expect(screen.getByText('BM')).toBeTruthy();
  fireEvent.error(image);
  expect(screen.queryByRole('img', { name: 'Ana Photo' })).toBeNull();
  expect(screen.getByText('AP')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Filter users' }).title).toBe('Filter users');
  expect(screen.getByRole('button', { name: 'New User' }).title).toBe('New User');
});
it('keeps the toolbar/header, shows a spinner until API rows arrive and opens readonly details', async () => {
  let resolve!: (value: unknown) => void;
  mocks.list.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<UsersSubTab />);
  expect(screen.getByPlaceholderText('Search users...')).toBeTruthy();
  expect(screen.getByText('Loading users...').querySelector('.animate-spin')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'No users yet' })).toBeNull();
  resolve({ data: [{ id: 'u', tenantId: 't', firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@camxian.com', role: 'Sales', status: 'active' }], meta: { hasMore: false } });
  fireEvent.click(await screen.findByRole('button', { name: 'View Juan Dela Cruz' }));
  expect(await screen.findByRole('dialog', { name: 'User Details' })).toBeTruthy();
  expect(screen.queryByText('Save Changes')).toBeNull();
  expect(screen.queryByText('Edit User')).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit First Name' })).toBeTruthy();
});

const savedUser = { id: 'a', tenantId: 't', firstName: 'Ana', lastName: 'Sales', role: 'Sales', status: 'active', email: 'a@camxian.com' };
it.each(['View', 'Edit'])('%s opens the same inline details and synchronizes a saved field with the table', async action => {
  mocks.list.mockResolvedValue({ data: [savedUser], meta: { hasMore: false } });
  const updated = { ...savedUser, firstName: 'Maria' };
  mocks.update.mockResolvedValue({ data: updated });
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  for (const [label, icon] of [['View', 'eye'], ['Edit', 'pencil'], ['Deactivate', 'user-x'], ['Archive', 'archive']]) {
    expect(screen.getByRole('menuitem', { name: label }).querySelector(`svg.lucide-${icon}`)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('menuitem', { name: action }));
  const panel = screen.getByRole('dialog', { name: 'User Details' });
  expect(within(panel).queryByRole('tablist')).toBeNull();
  expect(within(panel).queryByRole('button', { name: 'Edit User' })).toBeNull();
  fireEvent.click(within(panel).getByRole('button', { name: 'Edit First Name' }));
  fireEvent.change(within(panel).getByRole('textbox', { name: 'First Name' }), { target: { value: 'Maria' } });
  mocks.list.mockResolvedValue({ data: [updated], meta: { hasMore: false } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('a', { firstName: 'Maria' }));
  expect(await screen.findByRole('button', { name: 'View Maria Sales' })).toBeTruthy();
  expect(within(panel).getByRole('heading', { name: 'Maria Sales' })).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'User Details' })).toBe(panel);
});

it('the header reuses impact, replacement, confirmation, mutation and immediate status updates', async () => {
  const replacement = { ...savedUser, id: 'replacement', firstName: 'Replacement', assignableModules: ['tasks'], assignableAgent: true };
  mocks.list.mockResolvedValue({ data: [savedUser, replacement], meta: { hasMore: false } });
  const impact = { userId: 'a', total: 1, counts: { leads: 0, contacts: 0, accounts: 0, deals: 0, tasks: 1 } };
  mocks.impact.mockResolvedValue({ data: impact });
  mocks.deactivate.mockResolvedValue({ user: { ...savedUser, status: 'inactive' }, impact });
  render(<UsersSubTab />); fireEvent.click(await screen.findByRole('button', { name: 'View Ana Sales' }));
  fireEvent.click(screen.getByRole('button', { name: 'User actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Reassign Records and Tasks' });
  expect(within(dialog).queryByText('accounts')).toBeNull();
  expect(mocks.impact).toHaveBeenCalledExactlyOnceWith('a');
  expect(within(dialog).getByRole('button', { name: 'Review deactivation' })).toHaveProperty('disabled', true);
  fireEvent.change(within(dialog).getByRole('combobox', { name: /Assigned Agent/ }), { target: { value: 'replacement' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Review deactivation' }));
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Deactivate this user?' })).getByRole('button', { name: 'Deactivate' }));
  await waitFor(() => expect(mocks.deactivate).toHaveBeenCalledExactlyOnceWith('a', 'replacement'));
  const panel = screen.getByRole('dialog', { name: 'User Details' });
  await waitFor(() => expect(within(panel).getByText('Inactive', { exact: true })).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Activate Ana Sales' })).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('the inactive header uses existing Activate confirmation and both menu locations supply icons', async () => {
  const inactive = { ...savedUser, status: 'inactive', isArchived: true };
  mocks.list.mockResolvedValue({ data: [inactive], meta: { hasMore: false } });
  mocks.update.mockResolvedValue({ data: savedUser });
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  expect(screen.getByRole('menuitem', { name: 'Activate' }).querySelector('svg.lucide-user-check')).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  fireEvent.click(screen.getByRole('button', { name: 'User actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Activate' }));
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Activate this user?' })).getByRole('button', { name: 'Activate' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('a', { status: 'active' }));
  await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'User Details' })).getByText('Active', { exact: true })).toBeTruthy());
  expect(mocks.impact).not.toHaveBeenCalled();
});

it('header Archive opens the parent confirmation and preserves backend errors without closing details', async () => {
  mocks.list.mockResolvedValue({ data: [savedUser], meta: { hasMore: false } });
  mocks.archive.mockRejectedValue(new Error('Reassign owned records before archiving.'));
  render(<UsersSubTab />); fireEvent.click(await screen.findByRole('button', { name: 'View Ana Sales' }));
  fireEvent.click(screen.getByRole('button', { name: 'User actions' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
  expect(mocks.archive).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Archive User?' })).getByRole('button', { name: 'Archive' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Reassign owned records before archiving.');
  expect(screen.getByRole('dialog', { name: 'User Details' })).toBeTruthy();
  expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('a');
});

it('disables protected self and Client Admin actions, while delegated actors cannot deactivate', async () => {
  const admin = { ...savedUser, id: 'admin', role: 'Client Admin' };
  mocks.list.mockResolvedValue({ data: [admin], meta: { hasMore: false } }); render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  for (const label of ['Deactivate', 'Archive']) {
    const item = screen.getByRole('menuitem', { name: label }); expect(item).toHaveProperty('disabled', true);
    expect(document.getElementById(item.getAttribute('aria-describedby')!)).toBeTruthy(); fireEvent.click(item);
  }
  expect(mocks.impact).not.toHaveBeenCalled(); expect(mocks.archive).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' })); fireEvent.click(screen.getByRole('button', { name: 'User actions' }));
  for (const label of ['Deactivate', 'Archive']) expect(screen.getByRole('menuitem', { name: label })).toHaveProperty('disabled', true);
});

it('keeps unavailable row actions disabled and hides header actions when their grants are absent', async () => {
  mocks.role = 'Sales'; mocks.denied.add('users.canArchive');
  mocks.list.mockResolvedValue({ data: [savedUser], meta: { hasMore: false } }); render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  expect(screen.getByRole('menuitem', { name: 'Deactivate' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' })); fireEvent.click(screen.getByRole('button', { name: 'User actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Deactivate' })).toHaveProperty('disabled', true);
});
it('shows retry on fetch failure and a genuine empty state after retry', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByText('Network unavailable');
  expect(screen.queryByRole('heading', { name: 'No users yet' })).toBeNull();
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByRole('heading', { name: 'No users yet' })).toBeTruthy();
});

function expectNoUserTable() {
  expect(screen.queryByRole('grid')).toBeNull();
  expect(screen.queryByRole('columnheader')).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
}

it('reuses the Leads empty card and opens the existing New User form from both creation actions', async () => {
  mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  const heading = await screen.findByRole('heading', { name: 'No users yet' });
  const card = heading.closest('.border-dashed')!;
  expect(card.querySelector('.lucide-users')).toBeTruthy();
  expect(card.querySelector('.lucide-plus')).toBeTruthy();
  expect(screen.getByText('Add your first user to manage your team.')).toBeTruthy();
  expectNoUserTable();
  expect(screen.getByPlaceholderText('Search users...')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Filter users' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
  expect(await screen.findByRole('dialog', { name: 'New User' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'New User' }));
  expect(await screen.findByRole('dialog', { name: 'New User' })).toBeTruthy();
});

it.each(['users.canCreate', 'roles.canAssign'])('hides empty-state creation when %s is absent', async permission => {
  mocks.denied.add(permission); mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByRole('heading', { name: 'No users yet' });
  expect(screen.queryByRole('button', { name: 'Add User' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New User' })).toBeNull();
  expectNoUserTable();
});

it.each(['loading', 'error'])('disables both creation actions while roles have a %s state', async state => {
  mocks.rolesLoading = state === 'loading'; mocks.rolesError = state === 'error' ? 'Roles unavailable' : '';
  mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByRole('heading', { name: 'No users yet' });
  for (const label of ['Add User', 'New User']) {
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveProperty('disabled', true); fireEvent.click(button);
  }
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('distinguishes unmatched search from an empty directory and ignores whitespace', async () => {
  mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByRole('heading', { name: 'No users yet' });
  const search = screen.getByPlaceholderText('Search users...');
  fireEvent.change(search, { target: { value: '   ' } });
  expect(screen.getByRole('heading', { name: 'No users yet' })).toBeTruthy();
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(screen.getByRole('heading', { name: 'No matching records' })).toBeTruthy();
  expect(screen.getByText('Try a different search term or clear your filters.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add User' })).toBeNull();
  expect(screen.getByRole('button', { name: 'New User' })).toBeTruthy();
  expectNoUserTable();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByRole('heading', { name: 'No users yet' })).toBeTruthy();
});

it.each([['Inactive'], ['Sales'], ['Field', 'Inactive']])('keeps filters usable with no matches and restores rows when cleared: %j', async (...filters: string[]) => {
  mocks.list.mockResolvedValue({ data: [{ ...savedUser, role: 'Support', groups: [{ id: 'field', name: 'Field' }] }], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByRole('button', { name: 'View Ana Sales' });
  fireEvent.click(screen.getByRole('button', { name: 'Filter users' }));
  for (const filter of filters) fireEvent.click(screen.getByLabelText(`Filter by ${filter}`));
  expect(screen.getByRole('heading', { name: 'No matching records' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add User' })).toBeNull();
  expectNoUserTable();
  for (const filter of filters) fireEvent.click(screen.getByLabelText(`Filter by ${filter}`));
  expect(screen.getByRole('grid')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'View Ana Sales' })).toBeTruthy();
});

it('retains the empty card during refresh, then replaces it with populated rows', async () => {
  mocks.list.mockResolvedValue({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  const heading = await screen.findByRole('heading', { name: 'No users yet' });
  const card = heading.closest('.border-dashed')!;
  let finish!: (response: unknown) => void;
  mocks.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(screen.getByRole('status', { name: 'Refreshing data...' })).toBeTruthy();
  expect(card).toHaveProperty('isConnected', true);
  expect(card.getAttribute('aria-busy')).toBe('true');
  expect(screen.queryByRole('heading', { name: 'No users yet' })).toBeNull();
  expectNoUserTable();
  await act(async () => { finish({ data: [], meta: { hasMore: false } }); });
  expect(screen.getByRole('heading', { name: 'No users yet' })).toBe(heading);
  expect(screen.queryByRole('status', { name: 'Refreshing data...' })).toBeNull();
  mocks.list.mockResolvedValueOnce({ data: [savedUser], meta: { hasMore: false } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('button', { name: 'View Ana Sales' })).toBeTruthy();
  expect(screen.getByRole('grid')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'No users yet' })).toBeNull();
});

it('combines persisted group, status, and role filters', async () => {
  mocks.list.mockResolvedValue({ data: [
    { id: 'a', tenantId: 't', firstName: 'Ana', lastName: 'Sales', role: 'Sales', status: 'active', groups: [{ id: 'field', name: 'Field' }], email: 'a@camxian.com' },
    { id: 'b', tenantId: 't', firstName: 'Ben', lastName: 'Sales', role: 'Sales', status: 'inactive', isArchived: true, groups: [{ id: 'field', name: 'Field' }], email: 'b@camxian.com' },
    { id: 'c', tenantId: 't', firstName: 'Cal', lastName: 'Sales', role: 'Sales', status: 'active', groups: [{ id: 'office', name: 'Office' }], email: 'c@camxian.com' },
    { id: 'd', tenantId: 't', firstName: 'Deleted', lastName: 'User', role: 'Sales', isArchived: true, groups: [{ id: 'old', name: 'Former group' }], email: 'd@camxian.com' },
  ], meta: { hasMore: false } });
  render(<UsersSubTab />); await screen.findByRole('button', { name: 'View Ana Sales' });
  for (const label of ['Show archived', 'Export', 'Invite']) expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filter users' }));
  expect(screen.getByRole('complementary', { name: 'User filters' })).toBeTruthy();
  expect(screen.queryByLabelText('Filter by Pending')).toBeNull();
  expect(screen.getByLabelText('Filter by Former group')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Filter by Active'));
  expect(screen.queryByRole('button', { name: 'View Ben Sales' })).toBeNull();
  fireEvent.click(screen.getByLabelText('Filter by Field'));
  fireEvent.click(screen.getByLabelText('Filter by Sales'));
  expect(screen.getByRole('button', { name: 'View Ana Sales' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'View Cal Sales' })).toBeNull();
  fireEvent.click(screen.getByLabelText('Filter by Inactive'));
  expect(screen.getByRole('button', { name: 'View Ben Sales' })).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Close filters'));
  await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
});

it('shows Leads pagination on a single page and pages the complete API-backed user set', async () => {
  const users = Array.from({ length: 27 }, (_, index) => ({ id: String(index), tenantId: 't', firstName: 'Saved', lastName: `User ${index}`, email: `user${index}@example.com`, role: 'Sales', status: 'active', createdAt: new Date((26 - index) * 86_400_000).toISOString() }));
  mocks.list.mockResolvedValue({ data: users, meta: { total: 27, page: 1, limit: 100, hasMore: false } });
  render(<UsersSubTab />); await screen.findByText('Page 1 of 2');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Saved User 26');
  expect(screen.queryByText('Saved User 0')).toBeNull();
  fireEvent.click(screen.getByLabelText('Records per page'));
  fireEvent.click(screen.getByRole('option', { name: '50' }));
  await screen.findByText('Page 1 of 1');
  expect(screen.getByText('27 total records')).toBeTruthy();
  expect((screen.getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText('Search users...'), { target: { value: 'user26@' } });
  await waitFor(() => expect(screen.queryByText('Saved User 0')).toBeNull());
  expect(screen.getByText('Saved User 26')).toBeTruthy();
});

it('preserves a valid page and search through refresh', async () => {
  const users = Array.from({ length: 30 }, (_, index) => ({ id: `refresh-${index}`, tenantId: 't', firstName: 'User', lastName: String(index), email: `user${index}@example.com`, role: 'Sales', status: 'active' }));
  mocks.list.mockResolvedValue({ data: users, meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByRole('button', { name: 'Next page' });
  fireEvent.change(screen.getByPlaceholderText('Search users...'), { target: { value: 'example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(screen.getByLabelText('Pagination').textContent).toContain('Page 2 of 2'));
  let resolve!: (response: unknown) => void;
  mocks.list.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
  resolve({ data: users, meta: { hasMore: false } });
  await waitFor(() => expect(screen.queryByText('Loading users...')).toBeNull());
  expect((screen.getByPlaceholderText('Search users...') as HTMLInputElement).value).toBe('example.com');
  expect(screen.getByLabelText('Pagination').textContent).toContain('Page 2 of 2');
});

it('matches unread dots by user ID across pages and synchronizes reads, read-all and deletion without reading on module load', async () => {
  const users = Array.from({ length: 27 }, (_, index) => ({ ...savedUser,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, email: `user${index}@camxian.com`,
    firstName: 'Same', lastName: 'Name',
  }));
  const event = (id: string, entityId?: string, isRead = false, entityType = 'User'): NotificationRecord => ({
    id, entityType, entityId, isRead, userId: 'admin', tenantId: 't', type: 'user_status_changed', title: 'Account Locked', createdAt: '2026-10-27T00:00:00Z',
  });
  notifications = [event('first', users[0].id), event('second', users[0].id), event('last-page', users[26].id),
    event('already-read', users[1].id, true), event('other-type', users[2].id, false, 'RoleDefinition'),
    { ...event('recipient-only'), userId: users[3].id }, event('no-association')];
  mocks.list.mockResolvedValue({ data: users, meta: { hasMore: false } });
  render(<UsersSubTab />);
  const reader = renderHook(() => useNotifications('all', { countsOnly: true }));
  const row = (index: number) => screen.getByText(users[index].email).closest('tr')!;
  const dot = (index: number) => within(row(index)).queryByRole('status', { name: 'Unread User notifications' });
  await waitFor(() => expect(dot(0)).toBeTruthy());
  for (const index of [1, 2, 3, 4]) expect(dot(index)).toBeNull();
  expect(screen.getAllByRole('status', { name: 'Unread User notifications' })).toHaveLength(1);
  expect(mocks.notificationList).not.toHaveBeenCalled();
  expect(mocks.markRead).not.toHaveBeenCalled(); expect(mocks.markAllRead).not.toHaveBeenCalled();
  await act(async () => { await reader.result.current.markAsRead('first'); });
  expect(dot(0)).toBeTruthy();
  await act(async () => { await reader.result.current.markAsRead('second'); });
  expect(dot(0)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(dot(26)).toBeTruthy());
  await act(async () => { await reader.result.current.deleteNotifications(['last-page']); });
  expect(dot(26)).toBeNull();
  notifications.push(event('fresh', users[26].id));
  await act(async () => { window.dispatchEvent(new CustomEvent('notifications-changed', { detail: { ...notificationSummary(), tenantId: 't', userId: 'admin', action: 'read', ids: [] } })); });
  expect(dot(26)).toBeTruthy();
  await act(async () => { await reader.result.current.markAllAsRead(); });
  expect(dot(26)).toBeNull();
  expect(screen.getByLabelText('Pagination').textContent).toContain('Page 2 of 2');
  fireEvent.change(screen.getByPlaceholderText('Search users...'), { target: { value: users[0].email } });
  await waitFor(() => expect(screen.getByText(users[0].email)).toBeTruthy());
  expect(dot(0)).toBeNull();
});

it('reads only the opened user and skips repeated requests after close and reopen', async () => {
  const target = { ...savedUser, id: '00000000-0000-4000-8000-000000000001' };
  const other = { ...target, id: '00000000-0000-4000-8000-000000000002', firstName: 'Other' };
  notifications = [target, target, other].map((user, index) => ({ id: String(index), tenantId: 't', userId: 'admin', type: 'user_created',
    title: 'User event', entityType: 'User', entityId: user.id, isRead: false, createdAt: '2026-01-01T00:00:00Z' }));
  mocks.list.mockResolvedValue({ data: [target, other], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findAllByRole('status', { name: 'Unread User notifications' });
  fireEvent.click(screen.getByRole('button', { name: 'View Ana Sales' }));
  await screen.findByRole('dialog', { name: 'User Details' });
  await waitFor(() => expect(mocks.markAllRead).toHaveBeenCalledExactlyOnceWith(undefined, { entityType: 'User', entityId: target.id }));
  await waitFor(() => expect(screen.getAllByRole('status', { name: 'Unread User notifications' })).toHaveLength(1));
  expect(notifications.map(row => row.isRead)).toEqual([true, true, false]);
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'View Ana Sales' }));
  await screen.findByRole('dialog', { name: 'User Details' });
  expect(mocks.markAllRead).toHaveBeenCalledTimes(1);
});

it('shows unlock only for permanent locks, including inactive accounts', async () => {
  const users = [
    { ...savedUser, id: 'locked-active', securityLockedAt: '2026-10-27T00:00:00Z' },
    { ...savedUser, id: 'locked-inactive', status: 'inactive', securityLockedAt: '2026-10-27T00:00:00Z' },
    { ...savedUser, id: 'active', securityLockedAt: null },
    { ...savedUser, id: 'inactive', status: 'inactive', securityLockedAt: null },
    { ...savedUser, id: 'temporary', securityLockedAt: null, lockedUntil: '2099-01-01T00:00:00Z' },
  ];
  mocks.list.mockResolvedValue({ data: users, meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findAllByRole('button', { name: 'Unlock account' });
  for (const user of users) {
    const row = document.querySelector(`tr[data-row-id="${user.id}"]`)!;
    const unlock = within(row as HTMLElement).queryByRole('button', { name: 'Unlock account' });
    expect(!!unlock).toBe(!!user.securityLockedAt);
    if (unlock) {
      expect(unlock.title).toBe('Unlock account');
      expect(unlock.closest('td')).toBe(within(row as HTMLElement).getByRole('button', { name: /^(Activate|Deactivate) Ana Sales$/ }).closest('td'));
    }
  }
  expect(screen.getAllByRole('button', { name: 'Unlock account' })).toHaveLength(2);
});

it.each(['users.canView', 'users.canActivate', 'staff'])('hides unlock without the required administrator access: %s', async denial => {
  if (denial === 'staff') mocks.role = 'Sales'; else mocks.denied.add(denial);
  mocks.list.mockResolvedValue({ data: [{ ...savedUser, securityLockedAt: '2026-10-27T00:00:00Z' }], meta: { hasMore: false } });
  render(<UsersSubTab />);
  if (denial !== 'users.canView') {
    fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Unlock account' })).toBeNull();
  }
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Unlock account' })).toBeNull();
  expect(mocks.unlock).not.toHaveBeenCalled();
});

it('unlocks only the selected security lock, prevents duplicate submissions and preserves inactive status while revalidating', async () => {
  const locked = { ...savedUser, status: 'inactive', securityLockedAt: '2026-10-27T00:00:00Z' };
  const other = { ...locked, id: 'other', firstName: 'Other' };
  mocks.list.mockResolvedValue({ data: [locked, other], meta: { hasMore: false } });
  let finish!: () => void;
  mocks.unlock.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<UsersSubTab />);
  fireEvent.change(screen.getByPlaceholderText('Search users...'), { target: { value: savedUser.email } });
  const row = (await screen.findByRole('button', { name: 'Activate Ana Sales' })).closest('tr')!;
  const unlock = within(row).getByRole('button', { name: 'Unlock account' });
  fireEvent.click(unlock); fireEvent.click(unlock);
  expect(mocks.unlock).toHaveBeenCalledExactlyOnceWith('a');
  expect(unlock).toHaveProperty('disabled', true);
  let refresh!: (value: unknown) => void;
  mocks.list.mockReturnValueOnce(new Promise(resolve => { refresh = resolve; }));
  await act(async () => { finish(); });
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(within(row).queryByRole('button', { name: 'Unlock account' })).toBeNull();
  expect(within(row).getByText('inactive')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Unlock account' })).toHaveLength(1);
  await act(async () => { refresh({ data: [{ ...locked, securityLockedAt: null }, other], meta: { hasMore: false } }); });
  expect(screen.getByPlaceholderText('Search users...')).toHaveProperty('value', savedUser.email);
  expect(screen.getByRole('button', { name: 'Activate Ana Sales' })).toBeTruthy();
  expect(toast.success).toHaveBeenCalledWith('Account security lock removed.');
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.deactivate).not.toHaveBeenCalled();
  expect(mocks.markRead).not.toHaveBeenCalled(); expect(mocks.markAllRead).not.toHaveBeenCalled();
});

it('retains the security lock and reports a failed unlock from the existing menu', async () => {
  mocks.list.mockResolvedValue({ data: [{ ...savedUser, securityLockedAt: '2026-10-27T00:00:00Z' }], meta: { hasMore: false } });
  mocks.unlock.mockRejectedValue(new Error('Unlock denied.'));
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unlock account' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unlock denied.'));
  expect(screen.getByRole('button', { name: 'Unlock account' })).toHaveProperty('disabled', false);
  expect(mocks.list).toHaveBeenCalledTimes(1);
});

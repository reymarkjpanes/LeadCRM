import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), archive: vi.fn(), impact: vi.fn(), deactivate: vi.fn(), role: 'Client Admin' }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin', tenantId: 't', role: mocks.role }, userCan: () => true }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ roles: [{ id: 'r', name: 'Sales', isArchived: false, isSystemRole: false }], refreshRoles: vi.fn() }) }));
vi.mock('@/features/tenant/administration/users/services/users.service', () => ({ usersService: { getAll: mocks.list, update: mocks.update, archive: mocks.archive, deactivationImpact: mocks.impact, deactivate: mocks.deactivate } }));
import { UsersSubTab } from '../team-management-users';
beforeEach(() => { vi.resetAllMocks(); mocks.role = 'Client Admin'; vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(cleanup);
it('retains failed deactivation for retry and lets cancellation end the reassignment flow', async () => {
  const active = { id: 'a', tenantId: 't', firstName: 'Ana', lastName: 'Sales', role: 'Sales', status: 'active', email: 'a@example.com' };
  mocks.list.mockResolvedValue({ data: [active], meta: { hasMore: false } });
  mocks.impact.mockResolvedValue({ data: { userId: 'a', total: 0, counts: { leads: 0, contacts: 0, accounts: 0, deals: 0, tasks: 0 } } });
  mocks.deactivate.mockRejectedValue(new Error('Permission denied. Contact your administrator.'));
  render(<UsersSubTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
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
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
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
  expect(screen.queryByText('No users found')).toBeNull();
  resolve({ data: [{ id: 'u', tenantId: 't', firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@camxian.com', role: 'Sales', status: 'active' }], meta: { hasMore: false } });
  fireEvent.click(await screen.findByRole('button', { name: 'View Juan Dela Cruz' }));
  expect(await screen.findByText('User Details')).toBeTruthy();
  expect(screen.queryByText('Save Changes')).toBeNull();
  expect(screen.getByText('Edit User')).toBeTruthy();
});
it('shows retry on fetch failure and a genuine empty state after retry', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ data: [], meta: { hasMore: false } });
  render(<UsersSubTab />);
  await screen.findByText('Network unavailable');
  fireEvent.click(screen.getByText('Retry'));
  expect(await screen.findByText('No users found')).toBeTruthy();
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
  expect(screen.queryByText('27 total records')).toBeNull();
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

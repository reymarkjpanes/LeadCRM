import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearPageCache } from '@/shared/cache/page-cache';
import { RefreshButton } from '@/shared/components/crm/refresh-button';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import ContactsPage from './contacts-page';

const mocks = vi.hoisted(() => ({ list: vi.fn(), toast: vi.fn(), persist: vi.fn(), updateParams: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast, success: vi.fn() } }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent', role: 'Client Admin' }, tenant: { id: 'tenant' }, userCan: () => true }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ organizations: [], users: [], deals: [] }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/services/contacts-v2.api', () => ({ contactsV2Api: { list: mocks.list } }));
vi.mock('@/shared/hooks/use-column-preferences', () => ({ useColumnPreferences: () => ({ effectiveColumns: [], saveColumns: vi.fn(), resetColumns: vi.fn() }) }));
vi.mock('@/shared/hooks/use-table-preferences', () => ({ useTablePreferences: () => ({ pageSize: 25, viewMode: 'wrap', sort: null, persistFilters: mocks.persist }) }));
vi.mock('@/shared/hooks/use-filter-url-sync', () => ({ useFilterUrlSync: () => ({ getParam: () => '', getArrayParam: () => [], updateParams: mocks.updateParams }) }));
vi.mock('@/shared/components/crm', () => ({
  ContactPanel: () => null, StatusBadge: () => null,
  ModuleWorkspace: ({ loading, loadingLabel, onRefresh, refreshDisabled, searchTerm, onSearch, totalRecords, children }: any) => <div>
    <h1>Contacts</h1><input aria-label="Search contacts" value={searchTerm} onChange={event => onSearch(event.target.value)} />
    <output aria-label="Contact count">{totalRecords}</output>
    <RefreshButton onClick={onRefresh} disabled={refreshDisabled} />
    {loading ? <TableLoadingState label={loadingLabel} /> : children}
  </div>,
}));
vi.mock('./contacts-data-grid', () => ({ ContactsDataGrid: ({ contacts }: any) => <div data-testid="contacts">{contacts.map((c: any) => c.firstName).join(',')}</div> }));
vi.mock('./contact-form', () => ({ ContactFormSheet: () => null }));
vi.mock('@/shared/components/manage-columns-drawer', () => ({ ManageColumnsDrawer: () => null }));

const response = (name: string, total = 1) => ({ success: true, data: [{ id: 'one', firstName: name, lastName: 'Contact', status: 'Warm', createdAt: '2026-10-01T00:00:00Z' }], meta: { total, page: 1, limit: 25, hasMore: false } });
beforeEach(() => { vi.clearAllMocks(); clearPageCache(); mocks.list.mockResolvedValue(response('Original')); });
afterEach(() => { cleanup(); clearPageCache(); });

it.each(['success', 'failure'])('keeps rows, page structure and search during manual refresh %s and allows retry', async outcome => {
  render(<ContactsPage />);
  await waitFor(() => expect(screen.getByTestId('contacts').textContent).toBe('Original'));
  fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'Contact' } });
  await waitFor(() => expect(mocks.updateParams).toHaveBeenCalledWith(expect.objectContaining({ search: 'Contact' })));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.list.mock.lastCall?.[0]).toEqual(expect.objectContaining({ page: 1, limit: 25, search: 'Contact', filters: [] }));
  expect(screen.getByTestId('contacts').textContent).toBe('Original');
  const originalTable = screen.getByTestId('contacts');
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  mocks.list.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Loading contacts...')).toBeTruthy();
  expect(screen.getByTestId('contacts').textContent).toBe('Original');
  expect(screen.getByTestId('contacts')).toBe(originalTable);
  expect(screen.getByLabelText('Contact count').textContent).toBe('1');
  expect(originalTable.closest('[hidden]')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Contacts' })).toBeTruthy();
  expect((screen.getByLabelText('Search contacts') as HTMLInputElement).value).toBe('Contact');
  expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(mocks.list).toHaveBeenCalledTimes(3);
  expect(mocks.list.mock.lastCall?.[0]).toEqual(expect.objectContaining({ page: 1, limit: 25, search: 'Contact', filters: [] }));
  await act(async () => { if (outcome === 'success') resolve(response('Updated', 3)); else reject(new Error('Refresh unavailable')); });
  await waitFor(() => expect(screen.queryByText('Loading contacts...')).toBeNull());
  expect(screen.getByTestId('contacts').textContent).toBe(outcome === 'success' ? 'Updated' : 'Original');
  expect(screen.getByTestId('contacts')).toBe(originalTable);
  expect(originalTable.closest('[hidden]')).toBeNull();
  expect(screen.getByLabelText('Contact count').textContent).toBe(outcome === 'success' ? '3' : '1');
  if (outcome === 'failure') expect(mocks.toast).toHaveBeenCalledWith('Refresh unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(4));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(false));
});

it('keeps automatic synchronization quiet and replaces the rows when it resolves', async () => {
  render(<ContactsPage />);
  await screen.findByTestId('contacts');
  let resolve!: (value: unknown) => void;
  mocks.list.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('contacts').textContent).toBe('Original');
  expect(screen.queryByText('Loading contacts...')).toBeNull();
  expect(screen.getByTestId('contacts').closest('[hidden]')).toBeNull();
  await act(async () => resolve(response('Synchronized')));
  await waitFor(() => expect(screen.getByTestId('contacts').textContent).toBe('Synchronized'));
});

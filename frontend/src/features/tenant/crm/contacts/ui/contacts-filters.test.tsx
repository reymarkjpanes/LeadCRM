import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ContactsPage from './contacts-page';

const mocks = vi.hoisted(() => ({
  persist: vi.fn(), updateParams: vi.fn(), query: vi.fn(),
  users: [{ id: 'agent', firstName: 'Sam', lastName: 'Agent', role: 'Sales', status: 'active', assignableAgent: true }],
  deals: [{ id: 'deal', contactIds: ['one'] }],
  contacts: [
    { id: 'one', firstName: 'One', contactPerson: 'One', assignedUserId: 'agent', customerType: 'Prospect', lastUpdated: '2026-10-01', status: 'Warm' },
    { id: 'two', firstName: 'Two', contactPerson: 'Two', assignedUserId: 'other', customerType: 'Evaluator', status: 'Warm' },
  ],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent' }, tenant: { id: 'tenant' } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ organizations: [], users: mocks.users, deals: mocks.deals }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: ({ params }: any) => {
  mocks.query(params);
  const filters = params.filters ?? [];
  const filtered = mocks.contacts.filter(contact => filters.every((filter: any) => {
    if (filter.field === 'assignedUserId') return filter.value.includes(contact.assignedUserId);
    if (filter.field === 'system') return filter.value.includes('touched') ? Boolean(contact.lastUpdated) : !contact.lastUpdated;
    if (filter.field === 'related') return mocks.deals.some(deal => deal.contactIds.includes(contact.id));
    return true;
  }));
  return { data: { data: filtered, meta: { total: filtered.length, facets: { touched: 1, untouched: 1, has_deals: 1 } } }, refetch: vi.fn() };
} }));
vi.mock('@/shared/hooks/use-column-preferences', () => ({ useColumnPreferences: () => ({ effectiveColumns: [], saveColumns: vi.fn(), resetColumns: vi.fn() }) }));
vi.mock('@/shared/hooks/use-table-preferences', () => ({ useTablePreferences: () => ({ pageSize: 25, viewMode: 'wrap', sort: null, persistFilters: mocks.persist }) }));
vi.mock('@/shared/hooks/use-filter-url-sync', () => ({ useFilterUrlSync: () => ({ getParam: () => '', getArrayParam: (key: string) => key === 'types' ? ['Prospect'] : [], updateParams: mocks.updateParams }) }));
vi.mock('@/shared/components/crm', () => ({
  ContactPanel: () => null, StatusBadge: () => null,
  ModuleWorkspace: ({ filterGroups, onFilterToggle, children }: any) => <div>{filterGroups.map((group: any) => <section key={group.id}>{group.items.map((item: any) => <button key={item.id} onClick={() => onFilterToggle(group.id, item.id)}>{item.label}</button>)}</section>)}{children}</div>,
}));
vi.mock('./contacts-data-grid', () => ({ ContactsDataGrid: ({ contacts }: any) => <div data-testid="contacts">{contacts.map((c: any) => c.id).join(',')}</div> }));
vi.mock('./contact-form', () => ({ ContactFormSheet: () => null }));
vi.mock('@/shared/components/manage-columns-drawer', () => ({ ManageColumnsDrawer: () => null }));
afterEach(cleanup);

it('removes obsolete types and saved criteria while preserving agent, update and deal filters', () => {
  render(<ContactsPage />);
  expect(screen.queryByText(/Type:|Active Customer|Prospect|Evaluator/)).toBeNull();
  expect(screen.getByTestId('contacts').textContent).toBe('one,two');
  expect(mocks.updateParams).toHaveBeenCalledWith(expect.objectContaining({ types: null }));
  expect(mocks.persist).toHaveBeenCalledWith([]);
  expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 25, filters: [] }));
  for (const label of ['Assigned Agent: Sam Agent', 'Updated Records', 'Contacts with Deals']) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByTestId('contacts').textContent).toBe('one');
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByTestId('contacts').textContent).toBe('one,two');
  }
  expect(mocks.persist.mock.calls.every(([conditions]) => conditions.every((c: { field: string }) => c.field !== 'customerType'))).toBe(true);
});

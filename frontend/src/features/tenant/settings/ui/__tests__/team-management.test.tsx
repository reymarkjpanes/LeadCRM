import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ role: 'Sales', tenantId: 'tenant', users: false, groups: true }));
vi.mock('@/store/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'current', tenantId: mocks.tenantId, role: mocks.role }, userCan: (module: string) => mocks.role === 'Client Admin' || (module === 'users' ? mocks.users : mocks.groups) }),
}));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [] }) }));
vi.mock('../team-management-users', () => ({ UsersSubTab: ({ renderHeader }: { renderHeader: (action: React.ReactNode) => React.ReactNode }) => <>{renderHeader(null)}<div>Users tab content</div></> }));
vi.mock('../team-management-groups', () => ({ GroupsSubTab: ({ renderHeader }: { renderHeader: (action: React.ReactNode) => React.ReactNode }) => {
  const [draft, setDraft] = React.useState('');
  return <>{renderHeader(null)}<div>Groups tab content</div><input aria-label="Group draft" value={draft} onChange={event => setDraft(event.target.value)} /></>;
} }));

import { TeamManagement } from '../team-management';

afterEach(() => { cleanup(); mocks.role = 'Sales'; mocks.tenantId = 'tenant'; mocks.users = false; mocks.groups = true; });

it('shows only Groups when a custom role has only groups view access', async () => {
  render(<TeamManagement />);
  expect(screen.queryByRole('button', { name: 'Users' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Groups' })).toBeTruthy();
  expect(await screen.findByText('Groups tab content')).toBeTruthy();
  expect(screen.queryByText('Users tab content')).toBeNull();
});

it('allows Users-only custom staff to open Users without querying Groups', async () => {
  mocks.users = true; mocks.groups = false;
  render(<TeamManagement />);
  expect(await screen.findByText('Users tab content')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
  expect(screen.queryByText('Groups tab content')).toBeNull();
});

it('removes revoked tabs immediately and clears Group drafts across tenant changes', async () => {
  const view = render(<TeamManagement />);
  fireEvent.change(screen.getByLabelText('Group draft'), { target: { value: 'Old account draft' } });
  mocks.tenantId = 'other'; view.rerender(<TeamManagement />);
  await screen.findByDisplayValue('');
  expect(screen.queryByDisplayValue('Old account draft')).toBeNull();
  mocks.groups = false; view.rerender(<TeamManagement />);
  expect(screen.getByRole('alert').textContent).toContain('permission');
  expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
});

it('shows Users and Groups to Client Admin', async () => {
  mocks.role = 'Client Admin';
  render(<TeamManagement />);
  expect(screen.getByRole('button', { name: 'Users' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Groups' })).toBeTruthy();
  expect(await screen.findByText('Users tab content')).toBeTruthy();
});

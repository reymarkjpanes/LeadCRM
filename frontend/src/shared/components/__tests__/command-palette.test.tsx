import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ role: 'Client Admin' }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ roles: [{ name: 'Sales', permissions: ['contacts.view', 'deals.view'] }] }) }));
vi.mock('@/shared/hooks/use-debounce', () => ({ useDebounce: () => '' }));
import CommandPalette from '../command-palette';
beforeEach(() => { state.role = 'Client Admin'; });
afterEach(cleanup);
const show = () => render(<CommandPalette navigate={vi.fn()} isOpen setIsOpen={vi.fn()} />);
it('keeps CRM and team navigation without retired administrative destinations', () => {
  show();
  for (const label of ['Leads', 'Accounts', 'Deals', 'Workflows', 'Users', 'Settings']) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText('Audit Trail')).toBeNull();
  expect(screen.queryByText('Admin Console')).toBeNull();
});
it('respects custom role grants', () => {
  state.role = 'Sales'; show();
  expect(screen.queryByText('Leads')).toBeNull();
  expect(screen.getByText('Client Profiles')).toBeTruthy();
  expect(screen.getByText('Deals')).toBeTruthy();
  expect(screen.queryByText('Users')).toBeNull();
  expect(screen.queryByText('Campaigns')).toBeNull();
});
it('filters navigation by the entered query', () => {
  show(); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'WORK' } });
  expect(screen.getByText('Workflows')).toBeTruthy();
  expect(screen.queryByText('Leads')).toBeNull();
});

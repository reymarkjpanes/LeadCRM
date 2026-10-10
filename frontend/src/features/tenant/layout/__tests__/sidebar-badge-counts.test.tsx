import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Users } from 'lucide-react';
const mocks = vi.hoisted(() => ({ counts: { leads: 0, contacts: 0, accounts: 0, deals: 0 } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { firstName: 'Test', role: 'Client Admin' }, tenant: { name: 'Test' } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ contacts: [], deals: [], organizations: [] }) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false, USE_MOCK_AUTH: false }));
vi.mock('@/shared/hooks/use-module-counts', () => ({ useModuleCounts: () => ({ counts: mocks.counts }) }));
vi.mock('../use-layout', () => ({ useLayout: () => ({ currentPath: 'contacts', filteredNav: ['leads', 'contacts', 'accounts', 'pipeline'].map(path => ({ path, name: path, icon: Users, group: 'CRM' })) }) }));
import SidebarNav from '../sidebar-nav';
afterEach(cleanup);
it.each([[1, 0], [0, 5], [3, 5]])('renders independent leads=%s and contacts=%s totals, hiding zero', (leads, contacts) => {
  mocks.counts = { leads, contacts, accounts: 7, deals: 9 };
  render(<SidebarNav sidebarOpen onCloseSidebar={() => {}} navigate={() => {}} isAccountDropdownOpen={false} onToggleAccountDropdown={() => {}} isCollapsed={false} onToggleCollapse={() => {}} />);
  for (const [path, count] of Object.entries({ leads, contacts, accounts: 7, pipeline: 9 })) {
    const button = screen.getByRole('button', { name: new RegExp(`^${path}`) });
    if (count) expect(within(button).getByText(String(count))).toBeTruthy();
    else expect(within(button).queryByText('0')).toBeNull();
  }
});

it('closes a mobile drawer on a horizontal swipe without treating vertical scrolling as a swipe', () => {
  const close = vi.fn();
  render(<SidebarNav mode="mobile" sidebarOpen onCloseSidebar={close} navigate={() => {}} isAccountDropdownOpen={false} onToggleAccountDropdown={() => {}} isCollapsed={false} onToggleCollapse={() => {}} />);
  const drawer = screen.getByRole('dialog', { name: 'Main navigation' });
  const touch = (type: string, x: number, y: number) => fireEvent(drawer, Object.assign(new Event(type, { bubbles: true }), { pointerType: 'touch', clientX: x, clientY: y }));
  touch('pointerdown', 200, 80); touch('pointerup', 100, 160);
  expect(close).not.toHaveBeenCalled();
  touch('pointerdown', 200, 80); touch('pointerup', 100, 90);
  expect(close).toHaveBeenCalledTimes(1);
});

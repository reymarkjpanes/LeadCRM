import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { UserProfileDropdown } from '../../layout/user-profile-dropdown';
import { useLayout } from '../../layout/use-layout';

const mocks = vi.hoisted(() => ({ pathname: '/help', push: vi.fn(), toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => mocks.pathname }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { firstName: 'Preview', lastName: 'User', role: 'User' }, tenant: { name: 'Test workspace' }, logout: vi.fn() }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ usePermissions: () => ['contacts.view'], PERMISSION_BRIDGE: {} }));
vi.mock('@/shared/components/user-avatar', () => ({ UserAvatar: () => <span>PU</span> }));
vi.mock('sonner', () => ({ toast: { info: mocks.toast } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('opens an internal Help Center link and closes the dropdown without a placeholder toast', async () => {
  render(<UserProfileDropdown />);
  fireEvent.click(screen.getByRole('button', { name: 'User profile menu' }));
  const help = screen.getByRole('menuitem', { name: 'Help Center' });
  expect(help.getAttribute('href')).toBe('/help');
  expect(help.hasAttribute('target')).toBe(false);
  // Prevent jsdom from performing document navigation; the real Link handler
  // still runs so menu dismissal and the removed placeholder can be checked.
  help.addEventListener('click', event => event.preventDefault());
  fireEvent.click(help);
  await waitFor(() => expect(screen.getByRole('button', { name: 'User profile menu' }).getAttribute('aria-expanded')).toBe('false'));
  expect(mocks.toast).not.toHaveBeenCalled();
});

it.each(['/help', '/help/articles/creating-leads', '/help/category/leads'])('recognizes %s without selecting Dashboard', pathname => {
  mocks.pathname = pathname;
  const { result } = renderHook(useLayout);
  expect(result.current.currentPath).toBe('help');
  result.current.navigate('help');
  expect(mocks.push).toHaveBeenCalledWith('/help');
});

it('preserves normal CRM navigation and permission filtering', () => {
  mocks.pathname = '/crm/leads';
  const { result } = renderHook(useLayout);
  expect(result.current.currentPath).toBe('leads');
  // Settings contains personal preferences and is available to every user;
  // individual administration pages enforce their own permissions.
  expect(result.current.filteredNav.some(item => item.path === 'settings')).toBe(true);
  expect(result.current.filteredNav.some(item => item.path === 'contacts')).toBe(true);
  expect(result.current.filteredNav.some(item => item.path === 'leads')).toBe(false);
  result.current.navigate('leads');
  expect(mocks.push).toHaveBeenCalledWith('/crm/leads');
});

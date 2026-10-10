import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ tab: 'profile', canView: true, replace: vi.fn(), redirect: vi.fn() }));
vi.mock('next/navigation', () => {
  const router = { replace: state.replace };
  return { useSearchParams: () => new URLSearchParams({ tab: state.tab }), useRouter: () => router, redirect: state.redirect };
});
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, userCan: () => state.canView }) }));
vi.mock('../organization-settings-form', () => ({ OrganizationSettingsForm: () => <p>Authoritative organization</p> }));
vi.mock('../profile-form', () => ({ ProfileForm: () => <p>Personal profile</p> }));
vi.mock('../security-settings', () => ({ SecuritySettings: () => <p>Personal security</p> }));
vi.mock('../products-page', () => ({ ProductsPage: () => <p>Products content</p> }));
vi.mock('../product-interests-settings', () => ({ ProductInterestsSettings: () => <p>Custom fields content</p> }));
vi.mock('../archived-data', () => ({ ArchivedData: () => <p>Archived content</p> }));
vi.mock('../team-management', () => ({ TeamManagement: () => <p>Team content</p> }));
vi.mock('../roles-permissions', () => ({ RolesPermissions: () => <p>Roles content</p> }));
vi.mock('../forms-tab', () => ({ FormsTab: () => <p>Forms content</p> }));
import SettingsPage from '../settings-page';
import LegacyAccountPage from '../../../../../../app/(tenant)/settings/account/page';
import { PATH_TO_PATHNAME, resolveModulePath } from '@/lib/route-map';

beforeEach(() => { vi.clearAllMocks(); state.tab = 'profile'; state.canView = true; localStorage.clear(); });
afterEach(cleanup);

it('keeps the required groups and sections with no Account category or Details item', () => {
  render(<SettingsPage />);
  const select = screen.getByLabelText('Settings section') as HTMLSelectElement;
  expect([...select.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['GENERAL', 'ORGANIZATION', 'CUSTOMIZATION', 'CONNECT']);
  expect([...select.options].map(option => option.text)).toEqual(['Profile Settings', 'Appearance', 'General', 'Team Management', 'Roles & Permissions', 'Custom Fields', 'Products', 'Archived Data', 'Forms']);
  expect(screen.queryByText('Account Details')).toBeNull(); expect(screen.queryByText('ACCOUNT')).toBeNull();
  fireEvent.change(select, { target: { value: 'org-general' } });
  expect(screen.getByText('Authoritative organization')).toBeTruthy();
});

it.each([true, false])('normalizes the legacy tab and enforces General view access (%s)', async canView => {
  state.tab = 'account-details'; state.canView = canView;
  const breadcrumbs: unknown[] = [];
  const listener = (event: Event) => breadcrumbs.push((event as CustomEvent).detail);
  window.addEventListener('settings-tab-change', listener);
  try {
    render(<SettingsPage />);
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/settings?tab=org-general'));
    expect(Boolean(screen.queryByText('Authoritative organization'))).toBe(canView);
    if (!canView) expect(screen.getByRole('alert')).toBeTruthy();
    expect(breadcrumbs).not.toContainEqual({ group: 'Account', tab: 'Account Details' });
    if (canView) expect(breadcrumbs).toContainEqual({ group: 'Organization', tab: 'General' });
  } finally { window.removeEventListener('settings-tab-change', listener); }
});

it('redirects the old route and navigation alias to General without an Account breadcrumb', () => {
  LegacyAccountPage();
  expect(state.redirect).toHaveBeenCalledWith('/settings?tab=org-general');
  expect(PATH_TO_PATHNAME['account-details']).toBe('/settings?tab=org-general');
  expect(resolveModulePath('/settings/account')).toBe('settings');
});

it.each([
  ['profile', 'Personal profile'], ['appearance', 'System Appearance'], ['users', 'Team content'],
  ['roles', 'Roles content'], ['custom-fields', 'Custom fields content'], ['products', 'Products content'],
  ['archived', 'Archived content'], ['forms', 'Forms content'],
])('retains the existing %s section', async (tab, content) => {
  state.tab = tab; render(<SettingsPage />); expect(await screen.findByText(content)).toBeTruthy();
});

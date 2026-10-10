import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { EMPTY_PERMISSION_FLAGS, hasModulePermission, type ResolvedPermissions, type PermissionAction } from '@leadcrm/shared';
const state = vi.hoisted(() => ({ path: '/crm/leads', permissions: {} as ResolvedPermissions, loaded: true, role: 'Sales Staff' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'qa', role: state.role }, permissions: state.permissions, isPermissionsLoaded: state.loaded,
  userCan: (module: string, action: PermissionAction) => state.role === 'Client Admin' || hasModulePermission(state.permissions, module, action),
}) }));
import { ModuleAccessGuard } from './module-access-guard';
import { useLayout } from '@/features/tenant/layout/use-layout';
import { useHasPermission } from '@/shared/hooks/use-permissions';
beforeEach(() => { state.path = '/crm/leads'; state.permissions = {}; state.loaded = true; state.role = 'Sales Staff'; });
afterEach(cleanup);
it('protects legacy reporting with Dashboard View', () => {
  state.path = '/reporting';
  const page = render(<ModuleAccessGuard><p>Reports</p></ModuleAccessGuard>);
  expect(screen.getByRole('alert')).toBeTruthy();
  state.permissions.dashboard = { ...EMPTY_PERMISSION_FLAGS, canView: true };
  page.rerender(<ModuleAccessGuard><p>Reports</p></ModuleAccessGuard>);
  expect(screen.getByText('Reports')).toBeTruthy();
});
it('hides modules without View, retains personal Settings, and blocks direct routes', () => {
  const nav = renderHook(() => useLayout());
  expect(nav.result.current.filteredNav.map(item => item.name)).toEqual(['Settings']);
  render(<ModuleAccessGuard><p>Protected module</p></ModuleAccessGuard>);
  expect(screen.queryByText('Protected module')).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
});
it.each(['/settings','/settings/profile'])('keeps own personal settings available at %s', path => {
  state.path = path;
  render(<ModuleAccessGuard><p>Personal settings</p></ModuleAccessGuard>);
  expect(screen.getByText('Personal settings')).toBeTruthy();
});
it('does not infer Send, Reports or pipeline management from editing', () => {
  state.permissions = { campaigns: { ...EMPTY_PERMISSION_FLAGS, canView: true, canEdit: true }, deals: { ...EMPTY_PERMISSION_FLAGS, canView: true, canEdit: true } };
  const hook = renderHook(() => [useHasPermission('campaigns.edit'), useHasPermission('campaigns.send'), useHasPermission('campaigns.view_reports'), useHasPermission('deals.manage_stages')]);
  expect(hook.result.current).toEqual([true,false,false,false]);
});
it('requires View on direct import/create routes and fails closed until grants load', () => {
  state.path = '/crm/leads/import';
  state.permissions = { leads: { ...EMPTY_PERMISSION_FLAGS, canImport: true } };
  const view = render(<ModuleAccessGuard><p>Import Leads</p></ModuleAccessGuard>);
  expect(screen.getByRole('alert')).toBeTruthy();
  state.permissions.leads.canView = true;
  state.loaded = false;
  view.rerender(<ModuleAccessGuard><p>Import Leads</p></ModuleAccessGuard>);
  expect(screen.getByRole('status')).toBeTruthy();
  state.loaded = true;
  view.rerender(<ModuleAccessGuard><p>Import Leads</p></ModuleAccessGuard>);
  expect(screen.getByText('Import Leads')).toBeTruthy();
});

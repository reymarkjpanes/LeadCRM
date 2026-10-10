import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_USE_MOCK_AUTH = 'false';
  return { me: vi.fn(), login: vi.fn(), logout: vi.fn(), permissions: vi.fn(), signOut: vi.fn() };
});
vi.mock('@/shared/services/auth.api', () => ({ authApi: mocks }));
vi.mock('@/shared/services/roles.api', () => ({
  rolesApi: { getUserPermissions: mocks.permissions },
}));
vi.mock('@/store/mockData', () => ({ MOCK_USERS: [], MOCK_TENANTS: [] }));
import { AuthProvider, useAuth } from '../AuthContext';
let auth: ReturnType<typeof useAuth>;
const user = {
  id: 'user', tenantId: 'tenant', role: 'Sales', firstName: 'Alice', lastName: 'Owner',
  email: 'alice@example.com', status: 'ACTIVE', emailVerified: '2026-01-01',
  onboardingStep: 0, onboardingCompletedAt: null, isTenantOwner: true,
  tenantName: 'Workspace', tenantStatus: 'SANDBOX',
  avatarUrl: null,
};
function Probe() { auth = useAuth(); return null; }
function PermissionEditor() {
  const context = useAuth();
  return context.userCan('workflows', 'canView') ? <input aria-label="Workflow draft" defaultValue="" /> : null;
}
const show = () => render(<AuthProvider><Probe /></AuthProvider>);
beforeEach(() => {
  cleanup(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.me.mockRejectedValue(Object.assign(new Error('Session revoked'), { status: 401 }));
  mocks.login.mockResolvedValue({ data: { user } });
  mocks.logout.mockResolvedValue({ success: true });
  mocks.signOut.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({ data: { dashboard: { canView: true } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('synchronizes saved organization metadata and ignores another tenant response', async () => {
  show(); await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'password'); });
  const saved = { id: 'tenant', status: 'SANDBOX' as const, name: 'Saved workspace', industry: 'Technology', email: 'info@camxian.com', phone: '+63281233488', domain: 'camxian.com', address: 'Manila' };
  act(() => auth.applyOrganizationSettings(saved));
  expect(auth.tenant).toMatchObject({ id: 'tenant', name: saved.name, domain: saved.domain });
  expect(auth.user?.tenantName).toBe(saved.name);
  act(() => auth.applyOrganizationSettings({ ...saved, id: 'other', name: 'Another tenant' }));
  expect(auth.tenant?.name).toBe(saved.name); expect(auth.user?.tenantName).toBe(saved.name);
});
it('does not let a late restore overwrite a successful login', async () => {
  let restore!: (value: unknown) => void;
  mocks.me.mockReturnValue(new Promise(resolve => { restore = resolve; }));
  show();
  await act(async () => { await auth.login(user.email, 'password'); });
  await act(async () => { restore({ data: { user: { ...user, id: 'old-user' } } }); });
  expect(auth.user?.id).toBe('user');
  expect(mocks.me).toHaveBeenCalledOnce();
});
it('applies login state immediately and fetches permissions once without another /me', async () => {
  show();
  await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'password'); });
  await waitFor(() => expect(auth.isPermissionsLoaded).toBe(true));
  expect(auth.user?.onboardingStep).toBe(0);
  expect(mocks.me).toHaveBeenCalledOnce();
  expect(mocks.permissions).toHaveBeenCalledOnce();
});
it('clears permissions on logout and ignores a late permissions response', async () => {
  let permissions!: (value: unknown) => void;
  mocks.permissions.mockReturnValue(new Promise(resolve => { permissions = resolve; }));
  show();
  await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'password'); });
  await act(async () => { await auth.logout(); });
  await act(async () => { permissions({ data: { users: { canDelete: true } } }); });
  expect(auth.user).toBeNull();
  expect(auth.tenant).toBeNull();
  expect(auth.permissions).toEqual({});
});
it('retains account state and reports logout failure so the user can retry', async () => {
  show();
  await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'password'); });
  mocks.logout.mockRejectedValue(new Error('network unavailable'));
  await act(async () => { await expect(auth.logout()).rejects.toThrow('network unavailable'); });
  expect(auth.user?.id).toBe('user');
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it('treats a revoked 401 session as signed out rather than a transport failure', async () => {
  show();
  await waitFor(() => expect(auth.isLoading).toBe(false));
  expect(auth.user).toBeNull();
  expect(auth.authError).toBeNull();
});

it('preserves an allowed editor during Group revision refresh and removes it when permissions are revoked', async () => {
  class AccessEvents {
    static current: AccessEvents;
    listeners = new Map<string, ((event: MessageEvent) => void)[]>();
    constructor() { AccessEvents.current = this; }
    addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    close() {}
    emit(revision: string) { for (const listener of this.listeners.get('authorization-change') ?? []) listener(new MessageEvent('authorization-change', { data: revision })); }
  }
  vi.stubGlobal('EventSource', AccessEvents);
  const grants = { workflows: { canView: true } };
  mocks.me.mockResolvedValue({ data: { user } }); mocks.permissions.mockResolvedValue({ data: grants });
  render(<AuthProvider><Probe /><PermissionEditor /></AuthProvider>);
  const editor = await screen.findByLabelText('Workflow draft');
  fireEvent.change(editor, { target: { value: 'Unsaved assignment workflow' } });
  await act(async () => { AccessEvents.current.emit('1'); });
  let finish!: (value: unknown) => void;
  mocks.permissions.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => { AccessEvents.current.emit('2'); });
  expect(screen.getByDisplayValue('Unsaved assignment workflow')).toBe(editor);
  await act(async () => { finish({ data: grants }); });
  expect(screen.getByDisplayValue('Unsaved assignment workflow')).toBe(editor);
  mocks.permissions.mockResolvedValueOnce({ data: {} });
  await act(async () => { AccessEvents.current.emit('3'); });
  expect(screen.queryByLabelText('Workflow draft')).toBeNull();
});

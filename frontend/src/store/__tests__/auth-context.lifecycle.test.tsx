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
import { clearPageCache, getPageCacheGeneration, getPageCacheSize, setPageCache } from '@/shared/cache/page-cache';
import { PASSWORD_CHANGE_REQUIRED_EVENT } from '@/shared/auth/auth-events';
import { getAccountDestination } from '@/shared/auth/auth-routing';
import { REMEMBERED_EMAIL_KEY } from '@/shared/auth/remembered-login';
let auth: ReturnType<typeof useAuth>;
const user = {
  id: 'user', tenantId: 'tenant', role: 'Sales', firstName: 'Alice', lastName: 'Owner',
  email: 'alice@example.com', status: 'ACTIVE', emailVerified: '2026-01-01',
  onboardingStep: 0, onboardingCompletedAt: '2026-01-01', isTenantOwner: true,
  tenantName: 'Workspace', tenantStatus: 'SANDBOX',
  avatarUrl: null,
};
function Probe() { auth = useAuth(); return null; }
function PermissionEditor() {
  const context = useAuth();
  return context.userCan('workflows', 'canView') ? <input aria-label="Workflow draft" defaultValue="" /> : null;
}
const show = (initialHasSessionCookie?: boolean) => render(<AuthProvider initialHasSessionCookie={initialHasSessionCookie}><Probe /></AuthProvider>);
beforeEach(() => {
  cleanup(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.me.mockRejectedValue(Object.assign(new Error('Session revoked'), { status: 401 }));
  mocks.login.mockResolvedValue({ data: { user } });
  mocks.logout.mockResolvedValue({ success: true });
  mocks.signOut.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({ data: { dashboard: { canView: true } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('deduplicates logout, preserves the remembered email and rejects stale session refreshes', async () => {
  mocks.me.mockResolvedValue({ data: { user } });
  show(); await waitFor(() => expect(auth.user?.id).toBe(user.id));
  localStorage.setItem(REMEMBERED_EMAIL_KEY, user.email);
  setPageCache('logout-fixture', 'tenant', {}, { private: 'data' });
  let finish!: () => void;
  mocks.logout.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = auth.logout(); second = auth.logout(); });
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(auth.user?.id).toBe(user.id);
  await act(async () => { await auth.refreshUser(); });
  await act(async () => { finish(); await Promise.all([first, second]); });
  expect(auth.user).toBeNull(); expect(auth.permissions).toEqual({}); expect(getPageCacheSize()).toBe(0);
  expect(localStorage.getItem(REMEMBERED_EMAIL_KEY)).toBe(user.email);
});

it('keeps the session active after failed manual logout and permits retry with blocked storage', async () => {
  mocks.me.mockResolvedValue({ data: { user } }); show();
  await waitFor(() => expect(auth.user?.id).toBe(user.id));
  mocks.logout.mockRejectedValueOnce(new Error('Database unavailable'));
  await act(async () => { await expect(auth.logout()).rejects.toThrow('Database unavailable'); });
  expect(auth.user?.id).toBe(user.id);
  const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  try { await act(async () => { await auth.logout(); }); expect(auth.user).toBeNull(); }
  finally { spy.mockRestore(); }
});

it('clears a peer-expired session immediately without making a duplicate revocation request', async () => {
  mocks.me.mockResolvedValue({ data: { user } }); show();
  await waitFor(() => expect(auth.user?.id).toBe(user.id));
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'leadcrm:session-activity', newValue: JSON.stringify({ userId: user.id, logout: true, idle: true, at: Date.now() }) })));
  expect(auth.user).toBeNull(); expect(mocks.logout).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('leadcrm:idle-expired')).toBe('1');
});

it('skips anonymous startup even in Strict Mode and does not reuse the hint on prop changes', async () => {
  const view = render(<React.StrictMode><AuthProvider initialHasSessionCookie={false}><Probe /></AuthProvider></React.StrictMode>);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  expect(auth.user).toBeNull();
  expect(auth.tenant).toBeNull();
  expect(auth.authError).toBeNull();
  expect(auth.isPermissionsLoaded).toBe(true);
  view.rerender(<React.StrictMode><AuthProvider initialHasSessionCookie><Probe /></AuthProvider></React.StrictMode>);
  expect(mocks.me).not.toHaveBeenCalled();
  expect(mocks.permissions).not.toHaveBeenCalled();
});

it('keeps an idle-expiration redirect on Login even when revocation or session restoration is offline', async () => {
  window.history.replaceState({}, '', '/login?reason=idle');
  mocks.me.mockRejectedValue(new TypeError('Offline'));
  try {
    show(true); await waitFor(() => expect(auth.isLoading).toBe(false));
    expect(auth.user).toBeNull(); expect(auth.authError).toBeNull(); expect(mocks.me).not.toHaveBeenCalled();
  } finally { window.history.replaceState({}, '', '/'); }
});

it.each([true, undefined])('validates and restores a possible session when the initial cookie hint is %s', async hint => {
  mocks.me.mockResolvedValue({ data: { user } });
  show(hint);
  await waitFor(() => expect(auth.user?.id).toBe(user.id));
  expect(mocks.me).toHaveBeenCalledOnce();
  expect(auth.authError).toBeNull();
});

it('treats an expired cookie as signed out without logging or retrying', async () => {
  const errorLog = vi.spyOn(console, 'error');
  try {
    show(true);
    await waitFor(() => expect(auth.isLoading).toBe(false));
    expect(auth.user).toBeNull();
    expect(auth.authError).toBeNull();
    expect(mocks.me).toHaveBeenCalledOnce();
    expect(mocks.permissions).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  } finally { errorLog.mockRestore(); }
});

it.each(['restoreSession', 'retryAuthInit'] as const)('allows %s after anonymous startup was skipped', async action => {
  show(false);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  mocks.me.mockResolvedValue({ data: { user } });
  await act(async () => { await auth[action](); });
  expect(auth.user?.id).toBe(user.id);
  expect(mocks.me).toHaveBeenCalledOnce();
});

it('preserves recovery for a transport failure with a possible cookie session', async () => {
  mocks.me.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  show(true);
  await waitFor(() => expect(auth.authError).toMatch(/network connection/i));
  expect(auth.user).toBeNull();
  mocks.me.mockResolvedValue({ data: { user } });
  await act(async () => { await auth.retryAuthInit(); });
  expect(auth.user?.id).toBe(user.id);
  expect(auth.authError).toBeNull();
  expect(mocks.me).toHaveBeenCalledTimes(2);
});

it('logs in and out normally after skipping anonymous startup', async () => {
  show(false);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'password', true); });
  await waitFor(() => expect(auth.isPermissionsLoaded).toBe(true));
  expect(auth.user?.id).toBe(user.id);
  expect(mocks.login).toHaveBeenCalledWith({ email: user.email, password: 'password', rememberMe: true });
  expect(mocks.me).not.toHaveBeenCalled();
  await act(async () => { await auth.logout(); });
  expect(auth.user).toBeNull();
  expect(auth.authError).toBeNull();
  expect(auth.permissions).toEqual({});
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(mocks.me).not.toHaveBeenCalled();
});

it('deduplicates password-required signals, refreshes the canonical user and clears workspace data', async () => {
  const established = { ...user, mustChangePassword: false, onboardingCompletedAt: '2026-01-01' };
  mocks.me.mockResolvedValue({ data: { user: established } });
  show(); await waitFor(() => { expect(auth.user?.id).toBe(user.id); expect(auth.isPermissionsLoaded).toBe(true); });
  setPageCache('expired-workspace', 'tenant', {}, { secret: 'workspace data' });
  mocks.me.mockClear();
  let finish!: (value: unknown) => void;
  mocks.me.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  act(() => {
    window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
    window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
    window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
  });
  expect(mocks.me).toHaveBeenCalledOnce();
  await act(async () => { finish({ data: { user: { ...established, mustChangePassword: true } } }); });
  expect(auth.user?.id).toBe(user.id);
  expect(getAccountDestination(auth.user)).toBe('/change-password');
  expect(auth.permissions).toEqual({});
  expect(getPageCacheSize()).toBe(0);
  act(() => auth.applyAuthUser(established as never, user.id));
  expect(getAccountDestination(auth.user)).toBe('/dashboard');
});
it('refreshes a password-required SSE event without signing out and stops reconnection', async () => {
  class AccessEvents {
    static instances: AccessEvents[] = [];
    listeners = new Map<string, (event: MessageEvent) => void>();
    close = vi.fn();
    constructor() { AccessEvents.instances.push(this); }
    addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, listener); }
    emit(data: unknown) { this.listeners.get('authorization-access-changed')?.(new MessageEvent('authorization-access-changed', { data: JSON.stringify(data) })); }
  }
  vi.stubGlobal('EventSource', AccessEvents);
  const established = { ...user, mustChangePassword: false, onboardingCompletedAt: '2026-01-01' };
  mocks.me.mockResolvedValue({ data: { user: established } });
  show(); await waitFor(() => expect(AccessEvents.instances).toHaveLength(1));
  const source = AccessEvents.instances[0];
  mocks.me.mockResolvedValue({ data: { user: { ...established, mustChangePassword: true } } });
  await act(async () => source.emit({ code: 'PASSWORD_CHANGE_REQUIRED' }));
  expect(auth.user?.id).toBe(user.id);
  expect(getAccountDestination(auth.user)).toBe('/change-password');
  expect(source.close).toHaveBeenCalled();
  expect(AccessEvents.instances).toHaveLength(1);
  expect(mocks.logout).not.toHaveBeenCalled();
});
it('keeps ordinary authorization access-loss behavior', async () => {
  class AccessEvents {
    static current: AccessEvents;
    listeners = new Map<string, (event: MessageEvent) => void>();
    close = vi.fn();
    constructor() { AccessEvents.current = this; }
    addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, listener); }
  }
  vi.stubGlobal('EventSource', AccessEvents);
  mocks.me.mockResolvedValue({ data: { user } });
  show(); await waitFor(() => expect(auth.isLoading).toBe(false));
  act(() => AccessEvents.current.listeners.get('authorization-access-changed')?.(new MessageEvent('authorization-access-changed', { data: '{}' })));
  expect(auth.user).toBeNull();
  expect(AccessEvents.current.close).toHaveBeenCalled();
});
it('ignores a recovery response that arrives after logout', async () => {
  mocks.me.mockResolvedValue({ data: { user } });
  show(); await waitFor(() => expect(auth.isLoading).toBe(false));
  let finish!: (value: unknown) => void;
  mocks.me.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  act(() => window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT)));
  await act(async () => { await auth.logout(); });
  await act(async () => { finish({ data: { user: { ...user, mustChangePassword: true } } }); });
  expect(auth.user).toBeNull();
});
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
it('waits for password setup and onboarding before initializing permissions and authorization events', async () => {
  class AccessEvents {
    static instances: AccessEvents[] = [];
    constructor() { AccessEvents.instances.push(this); }
    addEventListener() {}
    close() {}
  }
  vi.stubGlobal('EventSource', AccessEvents);
  const fresh = { ...user, mustChangePassword: true, onboardingCompletedAt: null };
  mocks.login.mockResolvedValue({ data: { user: fresh } });
  show();
  await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'temporary'); });
  expect(auth.isPermissionsLoaded).toBe(false);
  expect(mocks.permissions).not.toHaveBeenCalled();
  expect(AccessEvents.instances).toHaveLength(0);
  act(() => auth.applyAuthUser({ ...fresh, mustChangePassword: false } as never, user.id));
  expect(getAccountDestination(auth.user)).toBe('/onboarding');
  expect(auth.isPermissionsLoaded).toBe(false);
  expect(mocks.permissions).not.toHaveBeenCalled();
  expect(AccessEvents.instances).toHaveLength(0);
  act(() => auth.applyAuthUser({ ...user, mustChangePassword: false } as never, user.id));
  await waitFor(() => expect(auth.isPermissionsLoaded).toBe(true));
  expect(auth.userCan('dashboard', 'canView')).toBe(true);
  expect(mocks.permissions).toHaveBeenCalledOnce();
  expect(AccessEvents.instances).toHaveLength(1);
});

it('marks the first authenticated render uninitialized before the permission effect runs', async () => {
  const frames: boolean[] = [];
  function CaptureReadiness() {
    const context = useAuth();
    if (context.user) frames.push(context.isPermissionsLoaded);
    return null;
  }
  mocks.permissions.mockReturnValue(new Promise(() => {}));
  render(<AuthProvider><Probe /><CaptureReadiness /></AuthProvider>);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  await act(async () => { await auth.login(user.email, 'password'); });
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(loaded => !loaded)).toBe(true);
});

it.each([new TypeError('Failed to fetch'), Object.assign(new Error('Unavailable'), { status: 503 })])('keeps an initial permission failure retryable (%s)', async error => {
  mocks.me.mockResolvedValue({ data: { user } });
  mocks.permissions.mockRejectedValueOnce(error);
  show();
  await waitFor(() => expect(auth.permissionsError).toBeTruthy());
  expect(auth.isPermissionsLoaded).toBe(false);
  expect(auth.userCan('dashboard', 'canView')).toBe(false);
  let finish!: (value: unknown) => void;
  mocks.permissions.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let retry!: Promise<void>;
  act(() => { retry = auth.refreshPermissions(); });
  expect(auth.permissionsError).toBeNull();
  expect(auth.isPermissionsLoaded).toBe(false);
  await act(async () => { finish({ data: { dashboard: { canView: true } } }); await retry; });
  expect(auth.isPermissionsLoaded).toBe(true);
  expect(auth.userCan('dashboard', 'canView')).toBe(true);
});

it.each([null, 401, 403, 404])('settles confirmed empty grants or access loss without a retry error (%s)', async status => {
  mocks.me.mockResolvedValue({ data: { user } });
  if (status) mocks.permissions.mockRejectedValue(Object.assign(new Error('Access denied'), { status }));
  else mocks.permissions.mockResolvedValue({ data: {} });
  show();
  await waitFor(() => expect(auth.user?.id === user.id && auth.isPermissionsLoaded).toBe(true));
  expect(auth.permissions).toEqual({});
  expect(auth.permissionsError).toBeNull();
  expect(auth.userCan('dashboard', 'canView')).toBe(false);
});

it.each(['PASSWORD_CHANGE_REQUIRED', 'ONBOARDING_REQUIRED'])('resynchronizes canonical setup instead of treating %s as an RBAC denial', async code => {
  mocks.me.mockResolvedValue({ data: { user } });
  show();
  await waitFor(() => expect(auth.userCan('dashboard', 'canView')).toBe(true));
  mocks.me.mockResolvedValueOnce({ data: { user: { ...user, mustChangePassword: code === 'PASSWORD_CHANGE_REQUIRED', onboardingCompletedAt: null } } });
  mocks.permissions.mockRejectedValueOnce(Object.assign(new Error('Finish setup'), { status: 403, code }));
  await act(async () => { await auth.refreshPermissions(); });
  expect(auth.isPermissionsLoaded).toBe(false);
  expect(auth.permissionsError).toBeNull();
  expect(auth.permissions).toEqual({});
  expect(getAccountDestination(auth.user)).toBe(code === 'PASSWORD_CHANGE_REQUIRED' ? '/change-password' : '/onboarding');
});

it('exposes Retry if canonical setup resynchronization fails', async () => {
  mocks.me.mockResolvedValue({ data: { user } });
  show();
  await waitFor(() => expect(auth.userCan('dashboard', 'canView')).toBe(true));
  mocks.me.mockRejectedValueOnce(new TypeError('Offline'));
  mocks.permissions.mockRejectedValueOnce(Object.assign(new Error('Finish setup'), { status: 403, code: 'ONBOARDING_REQUIRED' }));
  await act(async () => { await auth.refreshPermissions(); });
  expect(auth.isPermissionsLoaded).toBe(false);
  expect(auth.permissionsError).toBeTruthy();
  expect(auth.permissions).toEqual({});
});

it.each(['grants', 'setup error'])('ignores late %s across onboarding transitions', async outcome => {
  mocks.me.mockResolvedValue({ data: { user } });
  show();
  await waitFor(() => expect(auth.userCan('dashboard', 'canView')).toBe(true));
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  mocks.permissions.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
  let oldRequest!: Promise<void>;
  act(() => { oldRequest = auth.refreshPermissions(); });
  expect(mocks.permissions).toHaveBeenCalledTimes(2);
  act(() => auth.applyAuthUser({ ...user, onboardingCompletedAt: null } as never, user.id));
  expect(auth.isPermissionsLoaded).toBe(false);
  mocks.permissions.mockResolvedValue({ data: {} });
  act(() => auth.applyAuthUser(user as never, user.id));
  await waitFor(() => expect(auth.isPermissionsLoaded).toBe(true));
  await act(async () => {
    if (outcome === 'grants') resolve({ data: { dashboard: { canView: true } } });
    else reject(Object.assign(new Error('Stale setup response'), { status: 403, code: 'ONBOARDING_REQUIRED' }));
    await oldRequest;
  });
  expect(auth.permissions).toEqual({});
  expect(auth.permissionsError).toBeNull();
  expect(auth.user?.onboardingCompletedAt).toBe(user.onboardingCompletedAt);
  expect(mocks.me).toHaveBeenCalledOnce();
});

it('ignores late permissions after switching accounts and tenants', async () => {
  mocks.me.mockResolvedValue({ data: { user } });
  let finish!: (value: unknown) => void;
  mocks.permissions.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  show();
  await waitFor(() => expect(mocks.permissions).toHaveBeenCalledOnce());
  mocks.permissions.mockResolvedValue({ data: { workflows: { canView: true } } });
  act(() => auth.applyAuthUser({ ...user, id: 'other-user', tenantId: 'other-tenant' } as never));
  await waitFor(() => expect(auth.userCan('workflows', 'canView')).toBe(true));
  await act(async () => finish({ data: { dashboard: { canView: true } } }));
  expect(auth.user?.id).toBe('other-user');
  expect(auth.tenant?.id).toBe('other-tenant');
  expect(auth.userCan('dashboard', 'canView')).toBe(false);
  expect(auth.userCan('workflows', 'canView')).toBe(true);
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

it('retains the inactivity message when restoring an idle-expired session', async () => {
  mocks.me.mockRejectedValue(Object.assign(new Error('Idle session expired'), { status: 401, code: 'SESSION_IDLE_EXPIRED' }));
  show();
  await waitFor(() => expect(auth.isLoading).toBe(false));
  expect(auth.user).toBeNull();
  expect(auth.authError).toBeNull();
  expect(sessionStorage.getItem('leadcrm:idle-expired')).toBe('1');
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

it('refreshes Roles and Organization access for an unchanged Sales identity after an authorization revision', async () => {
  class AccessEvents {
    static current: AccessEvents;
    listeners = new Map<string, ((event: MessageEvent) => void)[]>();
    constructor() { AccessEvents.current = this; }
    addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    close() {}
    emit() { for (const listener of this.listeners.get('authorization-change') ?? []) listener(new MessageEvent('authorization-change', { data: 'role-revision' })); }
  }
  vi.stubGlobal('EventSource', AccessEvents);
  mocks.me.mockResolvedValue({ data: { user } });
  mocks.permissions.mockResolvedValue({ data: { roles: { canView: true, canEdit: true }, settings: { canView: true, canEdit: true }, leads: { canView: true } } });
  show(); await waitFor(() => expect(auth.userCan('settings', 'canEdit')).toBe(true));
  setPageCache('settings', 'tenant', {}, { private: 'Restricted organization' });
  mocks.permissions.mockResolvedValue({ data: { roles: { canView: false, canEdit: false }, settings: { canView: false, canEdit: false }, leads: { canView: true } } });
  await act(async () => AccessEvents.current.emit());
  expect(auth.user?.role).toBe('Sales');
  expect(auth.userCan('roles', 'canView')).toBe(false); expect(auth.userCan('roles', 'canEdit')).toBe(false);
  expect(auth.userCan('settings', 'canView')).toBe(false); expect(auth.userCan('settings', 'canEdit')).toBe(false);
  expect(auth.userCan('leads', 'canView')).toBe(true);
  expect(getPageCacheSize()).toBe(0); expect(mocks.logout).not.toHaveBeenCalled();
});

it('keeps drafts through reconnects and evicts cached records when membership or grants change', async () => {
  class AccessEvents {
    static current: AccessEvents;
    listeners = new Map<string, ((event: MessageEvent) => void)[]>();
    constructor() { AccessEvents.current = this; }
    addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    close() {}
    emit(type: string, revision = '') { for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: revision })); }
  }
  vi.stubGlobal('EventSource', AccessEvents);
  clearPageCache();
  const grants = { workflows: { canView: true } };
  mocks.me.mockResolvedValue({ data: { user } }); mocks.permissions.mockResolvedValue({ data: grants });
  render(<AuthProvider><Probe /><PermissionEditor /></AuthProvider>);
  const editor = await screen.findByLabelText('Workflow draft');
  fireEvent.change(editor, { target: { value: 'Reconnect draft' } });
  setPageCache('leads', 'tenant', { recordId: 'lead' }, { private: 'Loaded record' });
  const generation = getPageCacheGeneration();
  await act(async () => { AccessEvents.current.emit('open'); });
  expect(getPageCacheGeneration()).toBe(generation); expect(getPageCacheSize()).toBe(1);
  expect(screen.getByDisplayValue('Reconnect draft')).toBe(editor);

  mocks.me.mockResolvedValue({ data: { user: { ...user, groups: [{ id: 'first', name: 'First Group' }] } } });
  await act(async () => { AccessEvents.current.emit('authorization-change', '1'); });
  expect(getPageCacheGeneration()).toBeGreaterThan(generation); expect(getPageCacheSize()).toBe(0);
  expect(screen.getByDisplayValue('Reconnect draft')).toBe(editor);
  const membershipGeneration = getPageCacheGeneration();
  setPageCache('leads', 'tenant', { recordId: 'lead' }, { private: 'Refreshed authorized record' });
  mocks.permissions.mockResolvedValue({ data: { workflows: { canEdit: false, canView: true }, tasks: { canView: false } } });
  await act(async () => { AccessEvents.current.emit('open'); AccessEvents.current.emit('authorization-change', '1'); });
  expect(getPageCacheGeneration()).toBe(membershipGeneration); expect(getPageCacheSize()).toBe(1);
  expect(screen.getByDisplayValue('Reconnect draft')).toBe(editor);

  mocks.me.mockResolvedValue({ data: { user: { ...user, groups: [{ id: 'second', name: 'Second Group' }] } } });
  await act(async () => { AccessEvents.current.emit('authorization-change', '2'); });
  expect(getPageCacheGeneration()).toBeGreaterThan(membershipGeneration); expect(getPageCacheSize()).toBe(0);
  expect(screen.getByDisplayValue('Reconnect draft')).toBe(editor);
  const refreshedGeneration = getPageCacheGeneration();
  setPageCache('leads', 'tenant', { recordId: 'lead' }, { private: 'Current authorized record' });
  mocks.permissions.mockResolvedValue({ data: {} });
  await act(async () => { AccessEvents.current.emit('authorization-change', '3'); });
  expect(getPageCacheGeneration()).toBeGreaterThan(refreshedGeneration); expect(getPageCacheSize()).toBe(0);
  expect(screen.queryByLabelText('Workflow draft')).toBeNull();
});

it('clears previous-role grants immediately and reloads permissions after a same-user role refresh', async () => {
  mocks.me.mockResolvedValue({ data: { user } });
  mocks.permissions.mockResolvedValue({ data: { workflows: { canView: true } } });
  render(<AuthProvider><Probe /><PermissionEditor /></AuthProvider>);
  await screen.findByLabelText('Workflow draft');
  let finish!: (value: unknown) => void;
  mocks.permissions.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let oldRequest!: Promise<void>;
  act(() => { oldRequest = auth.refreshPermissions(); });
  mocks.permissions.mockResolvedValue({ data: {} });
  mocks.me.mockResolvedValueOnce({ data: { user: { ...user, role: 'Restricted' } } });
  await act(async () => { await auth.refreshUser(); });
  expect(screen.queryByLabelText('Workflow draft')).toBeNull();
  await waitFor(() => expect(auth.isPermissionsLoaded).toBe(true));
  expect(auth.permissions).toEqual({});
  await act(async () => { finish({ data: { workflows: { canView: true } } }); await oldRequest; });
  expect(auth.permissions).toEqual({});
  expect(screen.queryByLabelText('Workflow draft')).toBeNull();
});

it('retains a loaded authorized view on a transient background session refresh failure', async () => {
  mocks.me.mockResolvedValue({ data: { user } });
  mocks.permissions.mockResolvedValue({ data: { workflows: { canView: true } } });
  render(<AuthProvider><Probe /><PermissionEditor /></AuthProvider>);
  const editor = await screen.findByLabelText('Workflow draft');
  fireEvent.change(editor, { target: { value: 'Offline draft' } });
  const generation = getPageCacheGeneration();
  mocks.me.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async () => { await expect(auth.refreshUser()).rejects.toThrow('Failed to fetch'); });
  expect(auth.user?.id).toBe(user.id); expect(auth.authError).toBeNull();
  expect(auth.userCan('workflows', 'canView')).toBe(true);
  expect(getPageCacheGeneration()).toBe(generation);
  expect(screen.getByDisplayValue('Offline draft')).toBe(editor);
  mocks.permissions.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }));
  await act(async () => { await auth.refreshPermissions(); });
  expect(auth.userCan('workflows', 'canView')).toBe(true);
  expect(getPageCacheGeneration()).toBe(generation);
  expect(screen.getByDisplayValue('Offline draft')).toBe(editor);
  mocks.permissions.mockRejectedValueOnce(Object.assign(new Error('Access denied'), { status: 403 }));
  await act(async () => { await auth.refreshPermissions(); });
  expect(auth.userCan('workflows', 'canView')).toBe(false);
  expect(screen.queryByLabelText('Workflow draft')).toBeNull();
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, act, waitFor, screen } from '@testing-library/react';
import React from 'react';

/**
 * Integration Tests — Full Auth Login Flow Parity
 *
 * Feature: auth-login-blank-screen-fix (Task 4 — integration tests for full flow parity)
 *
 * These tests exercise the REAL `AuthProvider` (`@/store/AuthContext`) composed with the
 * REAL `AuthGuard` (`@/shared/providers/auth-guard`) end-to-end, mocking only the
 * transport/edge boundaries (`authApi`, `next/navigation`). They verify
 * the fixed flow at the integration level:
 *
 *   1. Full credentials-login flow (real-API mode): a verified, onboarded user logs in →
 *      AuthContext hydrates from the canonical /auth/me payload → AuthGuard settles on
 *      /dashboard with no blank frame. A refresh (fresh AuthProvider mount → restoreSession
 *      via /auth/me) produces the SAME /dashboard outcome.
 *      **Property 3: login and refresh produce identical routing.**
 *
 *   2. Auth-init failure flow: `authApi.me()` fails with a transport error during session
 *      restore → AuthContext sets `authError` → AuthGuard renders the explicit error UI with
 *      a retry action, NOT a silent blank screen. `retryAuthInit` (with `me()` now succeeding)
 *      recovers to the authenticated state.
 *
 *
 * **Validates: Requirements 2.1, 2.3, 2.4, 3.7, 3.8**
 *
 * EXPECTED OUTCOME: all pass on the fixed code.
 *
 * NOTE (harness): `AuthContext` reads `NEXT_PUBLIC_USE_MOCK_AUTH` into a module-level constant
 * at import time. To exercise real-API mode we stub the env to 'false' BEFORE importing, then
 * `vi.resetModules()` and dynamically import BOTH `AuthContext` and `AuthGuard` so they resolve
 * the SAME freshly-evaluated module instances (AuthGuard's `useAuth` must be the provider we
 * render). This mirrors `auth-context.preservation.test.tsx`.
 */

// ─────────────────────────────────────────────────────
// MOCKS — transport / edge boundaries only
// ─────────────────────────────────────────────────────

const loginApiMock = vi.fn();
const meApiMock = vi.fn();
const logoutApiMock = vi.fn();
const changePasswordApiMock = vi.fn();
const completeOnboardingApiMock = vi.fn();
const permissionsApiMock = vi.fn();

vi.mock('@/shared/services/auth.api', () => ({
  authApi: {
    login: (payload: unknown) => loginApiMock(payload),
    me: () => meApiMock(),
    logout: () => logoutApiMock(),
    changePassword: (payload: unknown) => changePasswordApiMock(payload),
    completeOnboarding: () => completeOnboardingApiMock(),
  },
}));
vi.mock('@/shared/services/roles.api', () => ({
  rolesApi: { getUserPermissions: (id: string) => permissionsApiMock(id) },
}));


const routerReplace = vi.fn();
let currentPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => currentPathname,
}));

vi.mock('@/store/mockData', () => ({
  MOCK_USERS: [],
  MOCK_TENANTS: [],
}));

// ─────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────

// The canonical /auth/me + aligned /auth/login user payload for a verified,
// onboarded, staff user (carries the complete gate fields).
const VERIFIED_ONBOARDED_USER = {
  id: 'user-1',
  email: 'alice@democorp.com',
  role: 'Client Admin',
  firstName: 'Alice',
  lastName: 'Admin',
  tenantId: 'tenant-1',
  status: 'ACTIVE',
  emailVerified: '2026-01-01T00:00:00.000Z',
  tenantName: 'Demo Corp Solutions',
  industry: 'IT Services',
  companySize: '11-50',
  onboardingStep: 3,
  onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
};

function authResponse(user: unknown): { data: { user: unknown } } {
  return { data: { user } };
}

// ─────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────

interface AuthModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAuth: any;
}

interface GuardModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthGuard: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let captured: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeProbe(useAuthHook: () => any): () => null {
  return function Probe(): null {
    captured = useAuthHook();
    return null;
  };
}

/**
 * Stub env to real-API mode, reset the module registry, then dynamically import
 * BOTH AuthContext and AuthGuard so they share the same freshly-evaluated
 * AuthContext module instance.
 */
async function loadRealApiModules(): Promise<{ auth: AuthModule; guard: GuardModule }> {
  vi.stubEnv('NEXT_PUBLIC_USE_MOCK_AUTH', 'false');
  vi.resetModules();
  const authMod = await import('@/store/AuthContext');
  const guardMod = await import('../auth-guard');
  return {
    auth: { AuthProvider: authMod.AuthProvider, useAuth: authMod.useAuth },
    guard: { AuthGuard: guardMod.AuthGuard },
  };
}

function resetAllMocks(): void {
  loginApiMock.mockReset();
  meApiMock.mockReset();
  logoutApiMock.mockReset();
  changePasswordApiMock.mockReset();
  completeOnboardingApiMock.mockReset();
  permissionsApiMock.mockReset().mockResolvedValue({ data: { dashboard: { canView: true } } });
  routerReplace.mockReset();
  currentPathname = '/dashboard';
  captured = null;
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* jsdom provides storage; ignore if unavailable */
  }
}

function redirectTargets(): string[] {
  return routerReplace.mock.calls.map((call) => String(call[0]));
}

// ─────────────────────────────────────────────────────
// TEST 1 — Full credentials-login flow + refresh parity (Property 3)
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Integration — credentials login flow parity (real API)', () => {
  let auth: AuthModule;
  let guard: GuardModule;

  beforeEach(async () => {
    resetAllMocks();
    ({ auth, guard } = await loadRealApiModules());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderApp(): void {
    const Probe = makeProbe(auth.useAuth);
    const { AuthProvider } = auth;
    const { AuthGuard } = guard;
    render(
      <AuthProvider>
        <Probe />
        <AuthGuard>
          <div data-testid="dashboard-content">CRM Dashboard</div>
        </AuthGuard>
      </AuthProvider>,
    );
  }

  it.each(['/dashboard', '/crm/deals'])('redirects anonymous %s without a startup session request', async pathname => {
    currentPathname = pathname;
    const Probe = makeProbe(auth.useAuth);
    const { AuthProvider } = auth;
    const { AuthGuard } = guard;
    render(<AuthProvider initialHasSessionCookie={false}><Probe /><AuthGuard>Protected content</AuthGuard></AuthProvider>);
    await waitFor(() => expect(redirectTargets()).toContain('/login'));
    expect(screen.queryByText('Protected content')).toBeNull();
    expect(captured?.authError).toBeNull();
    expect(meApiMock).not.toHaveBeenCalled();
  });

  it('renders public login normally when the server confirms no cookie session', async () => {
    currentPathname = '/login';
    const { AuthProvider } = auth;
    const { AuthGuard } = guard;
    render(<AuthProvider initialHasSessionCookie={false}><AuthGuard allowAnonymous>Login form</AuthGuard></AuthProvider>);
    await screen.findByText('Login form');
    expect(redirectTargets()).toEqual([]);
    expect(meApiMock).not.toHaveBeenCalled();
  });

  it.each(['login', 'restore'])('routes an expired returning user to change-password after %s', async mode => {
    const expired = { ...VERIFIED_ONBOARDED_USER, mustChangePassword: true };
    if (mode === 'restore') meApiMock.mockResolvedValue(authResponse(expired));
    else meApiMock.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
    loginApiMock.mockResolvedValue(authResponse(expired));
    renderApp();
    await waitFor(() => expect(captured?.isLoading).toBe(false));
    if (mode === 'login') await act(async () => { await captured!.login(expired.email, 'CorrectExpired1!'); });
    await waitFor(() => expect(redirectTargets()).toContain('/change-password'));
    expect(redirectTargets()).not.toContain('/onboarding');
  });

  it('logs in a verified, onboarded user → settles on /dashboard with no blank frame (login path)', async () => {
    // On mount there is no session yet (401 → not an error, user = null).
    meApiMock.mockRejectedValueOnce(new Error('401 authentication required'));
    // login() succeeds, then re-hydrates from the canonical /auth/me payload.
    loginApiMock.mockResolvedValueOnce(authResponse(VERIFIED_ONBOARDED_USER));
    meApiMock.mockResolvedValueOnce(authResponse(VERIFIED_ONBOARDED_USER));

    renderApp();

    // Session-restore settles: no session → redirect to /login (visible loading, not blank).
    await waitFor(() => expect(captured?.isLoading).toBe(false));

    // Perform the credentials login.
    let loginOk = false;
    await act(async () => {
      loginOk = await captured!.login('alice@democorp.com', 'correct-password');
    });
    expect(loginOk).toBe(true);

    // AuthContext hydrated with the complete gate fields (via /auth/me re-hydrate).
    await waitFor(() => expect(captured?.user?.id).toBe('user-1'));
    expect(captured?.user?.emailVerified).toBe(VERIFIED_ONBOARDED_USER.emailVerified);
    expect(captured?.user?.onboardingCompletedAt).toBe(VERIFIED_ONBOARDED_USER.onboardingCompletedAt);
    expect(captured?.authError).toBeNull();

    // AuthGuard settles on /dashboard and does NOT misroute to verify-email / onboarding.
    await waitFor(() => expect(screen.getByTestId('dashboard-content')).toBeTruthy());
    expect(redirectTargets()).not.toContain('/dashboard');
    const misroutes = redirectTargets().filter(
      (target) => target.startsWith('/verify-email') || target.startsWith('/onboarding'),
    );
    expect(misroutes).toEqual([]);

    // No silent blank screen: the dashboard content renders (guard passed children through).
    await waitFor(() => expect(screen.getByTestId('dashboard-content')).toBeTruthy());
  });

  it('refresh (fresh AuthProvider mount → restoreSession via /auth/me) settles on the SAME /dashboard (Property 3)', async () => {
    // Simulate a page refresh: the HttpOnly cookie is valid, so /auth/me succeeds on mount.
    meApiMock.mockResolvedValueOnce(authResponse(VERIFIED_ONBOARDED_USER));

    renderApp();

    await waitFor(() => expect(captured?.isLoading).toBe(false));
    await waitFor(() => expect(captured?.user?.id).toBe('user-1'));

    // Same routing outcome as the login path: settles on /dashboard, no misroute, no blank.
    await waitFor(() => expect(screen.getByTestId('dashboard-content')).toBeTruthy());
    expect(redirectTargets()).not.toContain('/dashboard');
    const misroutes = redirectTargets().filter(
      (target) => target.startsWith('/verify-email') || target.startsWith('/onboarding'),
    );
    expect(misroutes).toEqual([]);
    expect(screen.getByTestId('dashboard-content')).toBeTruthy();
  });

  it('an authenticated, verified, onboarded user on /dashboard is NOT redirected to /login or /onboarding (Req 3.8)', async () => {
    currentPathname = '/dashboard';
    meApiMock.mockResolvedValueOnce(authResponse(VERIFIED_ONBOARDED_USER));

    renderApp();

    await waitFor(() => expect(captured?.user?.id).toBe('user-1'));
    await waitFor(() => expect(screen.getByTestId('dashboard-content')).toBeTruthy());

    const badRedirects = redirectTargets().filter(
      (target) => target === '/login' || target.startsWith('/onboarding'),
    );
    expect(badRedirects).toEqual([]);
  });
});

describe('first-login permission initialization with the real AuthProvider and module guard', () => {
  beforeEach(() => { resetAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function renderWorkspace() {
    const { auth, guard } = await loadRealApiModules();
    const { ModuleAccessGuard } = await import('../module-access-guard');
    const { default: ChangePasswordPage } = await import('@/features/tenant/auth/ui/change-password-page');
    const { default: OnboardingPage } = await import('@/features/tenant/onboarding/ui/onboarding-page');
    const { LogoutConfirmationProvider } = await import('../logout-confirmation-provider');
    const Probe = makeProbe(auth.useAuth);
    function Workspace() {
      return <guard.AuthGuard>{currentPathname === '/change-password' ? <ChangePasswordPage />
        : currentPathname === '/onboarding' ? <OnboardingPage />
          : <ModuleAccessGuard><p>CRM Dashboard</p></ModuleAccessGuard>}</guard.AuthGuard>;
    }
    const tree = <auth.AuthProvider><LogoutConfirmationProvider><Probe /><Workspace /></LogoutConfirmationProvider></auth.AuthProvider>;
    const view = render(tree);
    return (path: string) => {
      currentPathname = path;
      view.rerender(<auth.AuthProvider><LogoutConfirmationProvider><Probe /><Workspace /></LogoutConfirmationProvider></auth.AuthProvider>);
    };
  }

  it.each(['Skip', 'Finish'])('loads assigned-role permissions after password change and onboarding %s without a reload', async completion => {
    let canonical = { ...VERIFIED_ONBOARDED_USER, role: 'Sales', mustChangePassword: true, onboardingCompletedAt: null as string | null };
    let finishPermissions!: (value: unknown) => void;
    const pendingPermissions = new Promise(resolve => { finishPermissions = resolve; });
    meApiMock.mockRejectedValueOnce(Object.assign(new Error('No session'), { status: 401 }))
      .mockImplementation(() => Promise.resolve(authResponse(canonical)));
    loginApiMock.mockResolvedValue(authResponse(canonical));
    changePasswordApiMock.mockImplementation(async () => {
      canonical = { ...canonical, mustChangePassword: false };
      return authResponse(canonical);
    });
    completeOnboardingApiMock.mockImplementation(async () => {
      canonical = { ...canonical, onboardingCompletedAt: '2026-10-19T10:00:00.000Z' };
      return authResponse(canonical);
    });
    permissionsApiMock.mockImplementation(() => canonical.onboardingCompletedAt ? pendingPermissions
      : Promise.reject(Object.assign(new Error('Complete onboarding'), { status: 403, code: 'ONBOARDING_REQUIRED' })));
    const navigate = await renderWorkspace();
    await waitFor(() => expect(captured.isLoading).toBe(false));
    await act(async () => { await captured.login(canonical.email, 'Temporary1!'); });
    expect(redirectTargets()).toContain('/change-password');
    navigate('/change-password');
    expect(permissionsApiMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^Old Password/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^New Password/), { target: { value: 'PermanentPassword1!' } });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password/), { target: { value: 'PermanentPassword1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(redirectTargets()).toContain('/onboarding'));
    expect(changePasswordApiMock).toHaveBeenCalledExactlyOnceWith({ password: 'PermanentPassword1!' });
    navigate('/onboarding');
    expect(permissionsApiMock).not.toHaveBeenCalled();
    if (completion === 'Finish') for (let step = 1; step < 8; step++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: completion }));
    await waitFor(() => expect(redirectTargets()).toContain('/dashboard'));
    navigate('/dashboard');
    expect(completeOnboardingApiMock).toHaveBeenCalledOnce();
    expect(permissionsApiMock).toHaveBeenCalledExactlyOnceWith(canonical.id);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('CRM Dashboard')).toBeNull();
    expect(screen.queryByText('You do not have permission to access this module.')).toBeNull();
    await act(async () => finishPermissions({ data: { dashboard: { canView: true } } }));
    expect(screen.getByText('CRM Dashboard')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('You do not have permission to access this module.')).toBeNull();
    expect(loginApiMock).toHaveBeenCalledOnce();
  });

  it.each([new TypeError('Failed to fetch'), Object.assign(new Error('Unavailable'), { status: 503 })])('retries a failed initial permission request from the module error state (%s)', async error => {
    meApiMock.mockResolvedValue(authResponse({ ...VERIFIED_ONBOARDED_USER, role: 'Sales' }));
    permissionsApiMock.mockRejectedValueOnce(error);
    await renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByText('CRM Dashboard');
    expect(permissionsApiMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('You do not have permission to access this module.')).toBeNull();
  });

  it('denies Dashboard access after a successful empty permission response', async () => {
    meApiMock.mockResolvedValue(authResponse({ ...VERIFIED_ONBOARDED_USER, role: 'Sales' }));
    permissionsApiMock.mockResolvedValue({ data: {} });
    await renderWorkspace();
    await screen.findByText('You do not have permission to access this module.');
    expect(screen.queryByText('CRM Dashboard')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('restores and revokes the active module through existing authorization-change events', async () => {
    class AccessEvents {
      static current: AccessEvents;
      listeners = new Map<string, (event: MessageEvent) => void>();
      constructor() { AccessEvents.current = this; }
      addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, listener); }
      close() {}
      emit(revision: string) { this.listeners.get('authorization-change')?.(new MessageEvent('authorization-change', { data: revision })); }
    }
    vi.stubGlobal('EventSource', AccessEvents);
    meApiMock.mockResolvedValue(authResponse({ ...VERIFIED_ONBOARDED_USER, role: 'Sales' }));
    permissionsApiMock.mockResolvedValue({ data: {} });
    await renderWorkspace();
    await screen.findByText('You do not have permission to access this module.');
    permissionsApiMock.mockResolvedValue({ data: { dashboard: { canView: true } } });
    await act(async () => AccessEvents.current.emit('granted'));
    expect(screen.getByText('CRM Dashboard')).toBeTruthy();
    permissionsApiMock.mockResolvedValue({ data: {} });
    await act(async () => AccessEvents.current.emit('revoked'));
    expect(screen.queryByText('CRM Dashboard')).toBeNull();
    expect(screen.getByText('You do not have permission to access this module.')).toBeTruthy();
    expect(loginApiMock).not.toHaveBeenCalled();
    expect(logoutApiMock).not.toHaveBeenCalled();
  });

  it('updates CRM tabs and clears protected caches on tab-only authorization changes without reloading', async () => {
    class AccessEvents {
      static current: AccessEvents;
      listeners = new Map<string, (event: MessageEvent) => void>();
      constructor() { AccessEvents.current = this; }
      addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, listener); }
      close() {}
      emit(revision: string) { this.listeners.get('authorization-change')?.(new MessageEvent('authorization-change', { data: revision })); }
    }
    vi.stubGlobal('EventSource', AccessEvents);
    currentPathname = '/crm/leads';
    meApiMock.mockResolvedValue(authResponse({ ...VERIFIED_ONBOARDED_USER, role: 'Sales' }));
    permissionsApiMock.mockResolvedValue({ data: { leads: { canView: true, canViewAll: true, canViewMy: true } } });
    const { auth } = await loadRealApiModules();
    const { useCrmTabs } = await import('@/shared/hooks/use-crm-tabs');
    const { ModuleAccessGuard } = await import('../module-access-guard');
    const cache = await import('@/shared/cache/page-cache');
    function Tabs() {
      const access = useCrmTabs('leads', [{ id: 'all', label: 'All Leads' }, { id: 'my', label: 'My Leads' }, { id: 'active', label: 'Active Leads' }]);
      return <ModuleAccessGuard>{access.tabs.map(tab => <span key={tab.id}>{tab.label}</span>)}</ModuleAccessGuard>;
    }
    render(<auth.AuthProvider><Tabs /></auth.AuthProvider>);
    await screen.findByText('All Leads');
    cache.setPageCache('leads', 'tenant-1', {}, ['previously visible record']);
    permissionsApiMock.mockResolvedValue({ data: { leads: { canView: true, canViewMy: true } } });
    await act(async () => AccessEvents.current.emit('my-only'));
    expect(screen.queryByText('All Leads')).toBeNull(); expect(screen.getByText('My Leads')).toBeTruthy();
    expect(cache.getPageCacheSize()).toBe(0);
    permissionsApiMock.mockResolvedValue({ data: { leads: { canView: true, canViewActive: true } } });
    await act(async () => AccessEvents.current.emit('active-only'));
    expect(screen.queryByText('My Leads')).toBeNull(); expect(screen.getByText('Active Leads')).toBeTruthy();
    permissionsApiMock.mockResolvedValue({ data: { leads: { canView: true } } });
    await act(async () => AccessEvents.current.emit('no-tabs'));
    expect(screen.queryByText('Active Leads')).toBeNull(); expect(screen.getByRole('alert')).toBeTruthy();
    expect(loginApiMock).not.toHaveBeenCalled(); expect(logoutApiMock).not.toHaveBeenCalled();
  });

  it.each(['membership', 'head'])('evicts the previous Deal scope immediately on a %s revision with identical role grants', async change => {
    class AccessEvents {
      static current: AccessEvents;
      listeners = new Map<string, (event: MessageEvent) => void>();
      constructor() { AccessEvents.current = this; }
      addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, listener); }
      close() {}
      emit(revision: string) { this.listeners.get('authorization-change')?.(new MessageEvent('authorization-change', { data: revision })); }
    }
    vi.stubGlobal('EventSource', AccessEvents);
    meApiMock.mockResolvedValue(authResponse({ ...VERIFIED_ONBOARDED_USER, role: 'Sales Admin', groups: [{ id: 'a', name: 'Group A' }] }));
    permissionsApiMock.mockResolvedValue({ data: { dashboard: { canView: true }, deals: { canView: true, canViewAll: true } } });
    const { auth } = await loadRealApiModules();
    const { useCachedPage } = await import('@/shared/hooks/use-cached-page');
    const cache = await import('@/shared/cache/page-cache');
    let release!: (rows: string[]) => void;
    const fetchRows = vi.fn().mockResolvedValueOnce(['Group A Deal']).mockImplementation(() => new Promise<string[]>(resolve => { release = resolve; }));
    function Deals() {
      const query = useCachedPage<string[]>({ module: 'deals', params: {}, disabled: false, fetchFn: fetchRows });
      return <output>{query.data?.join(',')}</output>;
    }
    render(<auth.AuthProvider><Deals /></auth.AuthProvider>);
    await screen.findByText('Group A Deal');
    const oldScope = cache.createPageCacheGuard('deals');
    meApiMock.mockImplementation(() => new Promise(() => {}));
    permissionsApiMock.mockImplementation(() => new Promise(() => {}));
    act(() => AccessEvents.current.emit(change));
    expect(screen.queryByText('Group A Deal')).toBeNull();
    expect(oldScope()).toBe(false);
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    await act(async () => release(['Group B Deal']));
    expect(screen.getByText('Group B Deal')).toBeTruthy();
    act(() => AccessEvents.current.emit(change));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(loginApiMock).not.toHaveBeenCalled();
    expect(logoutApiMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────
// TEST 2 — Auth-init failure flow (Req 2.3) + recovery via retryAuthInit
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Integration — auth-init failure surfaces recovery UI (real API)', () => {
  let auth: AuthModule;
  let guard: GuardModule;
  let LogoutConfirmationProvider: typeof import('../logout-confirmation-provider').LogoutConfirmationProvider;

  beforeEach(async () => {
    resetAllMocks();
    ({ auth, guard } = await loadRealApiModules());
    ({ LogoutConfirmationProvider } = await import('../logout-confirmation-provider'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderApp(): void {
    const Probe = makeProbe(auth.useAuth);
    const { AuthProvider } = auth;
    const { AuthGuard } = guard;
    render(
      <AuthProvider>
        <LogoutConfirmationProvider>
          <Probe />
          <AuthGuard>
            <div data-testid="dashboard-content">CRM Dashboard</div>
          </AuthGuard>
        </LogoutConfirmationProvider>
      </AuthProvider>,
    );
  }

  it('a transport failure during session restore renders an explicit error/recovery UI, not a blank screen', async () => {
    // Genuine transport failure (network/5xx), NOT a 401 "no session".
    meApiMock.mockRejectedValueOnce(new Error('Failed to fetch'));

    renderApp();

    // AuthContext distinguishes transport failure → sets authError (not silent user = null).
    await waitFor(() => expect(captured?.isLoading).toBe(false));
    expect(captured?.authError).toBeTruthy();
    expect(captured?.user).toBeNull();

    // AuthGuard renders the explicit error state with a retry action — never a silent blank.
    expect(screen.getByText('Unable to continue to your workspace')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    // The protected content is NOT rendered while the error state is shown.
    expect(screen.queryByTestId('dashboard-content')).toBeNull();
  });

  it('confirms recovery-screen sign-out and keeps failed revocation retryable', async () => {
    meApiMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    logoutApiMock.mockRejectedValueOnce(new Error('Server unavailable'));
    renderApp();
    await screen.findByText('Unable to continue to your workspace');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(logoutApiMock).not.toHaveBeenCalled();
    expect(captured?.authError).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));
    await screen.findByText('Server unavailable');
    expect(redirectTargets()).not.toContain('/login');
    logoutApiMock.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));
    await waitFor(() => expect(redirectTargets()).toContain('/login'));
    expect(logoutApiMock).toHaveBeenCalledTimes(2);
    expect(captured?.authError).toBeNull();
  });

  it('retryAuthInit recovers to the authenticated state once /auth/me succeeds', async () => {
    // First mount: transport failure → error state.
    meApiMock.mockRejectedValueOnce(new Error('Failed to fetch'));
    // Retry: /auth/me now succeeds with the canonical payload.
    meApiMock.mockResolvedValueOnce(authResponse(VERIFIED_ONBOARDED_USER));

    renderApp();

    await waitFor(() => expect(captured?.authError).toBeTruthy());

    // Invoke the recovery action exposed by the context.
    await act(async () => {
      await captured!.retryAuthInit();
    });

    // Recovered: error cleared, user hydrated, guard settles on /dashboard, content renders.
    await waitFor(() => expect(captured?.authError).toBeNull());
    expect(captured?.user?.id).toBe('user-1');
    await waitFor(() => expect(screen.getByTestId('dashboard-content')).toBeTruthy());
    expect(redirectTargets()).not.toContain('/dashboard');
    await waitFor(() => expect(screen.getByTestId('dashboard-content')).toBeTruthy());
  });
});

// ─────────────────────────────────────────────────────
// TEST 3 — Existing cookie session restoration
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Integration — existing session restoration (real API)', () => {
  let auth: AuthModule;

  beforeEach(async () => {
    resetAllMocks();
    // No session on mount for these tests.
    meApiMock.mockRejectedValue(new Error('401 authentication required'));
    ({ auth } = await loadRealApiModules());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderProvider(): void {
    const Probe = makeProbe(auth.useAuth);
    const { AuthProvider } = auth;
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  }

  it('a fresh mount hydrates the existing cookie session via /auth/me', async () => {
    // Simulate the session re-mount: the backend has set the LeadCRM cookie,
    // so restoreSession() hydrates the user from /auth/me.
    meApiMock.mockReset();
    meApiMock.mockResolvedValueOnce(authResponse(VERIFIED_ONBOARDED_USER));

    renderProvider();

    await waitFor(() => expect(captured?.isLoading).toBe(false));
    await waitFor(() => expect(captured?.user?.id).toBe('user-1'));
    // Hydration path is /auth/me (not a second login call).
    expect(meApiMock).toHaveBeenCalled();
    expect(loginApiMock).not.toHaveBeenCalled();
    expect(captured?.authError).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, screen } from '@testing-library/react';
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

vi.mock('@/shared/services/auth.api', () => ({
  authApi: {
    login: (payload: unknown) => loginApiMock(payload),
    me: () => meApiMock(),
    logout: () => logoutApiMock(),
  },
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

// ─────────────────────────────────────────────────────
// TEST 2 — Auth-init failure flow (Req 2.3) + recovery via retryAuthInit
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Integration — auth-init failure surfaces recovery UI (real API)', () => {
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

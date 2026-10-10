import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Preservation Tests — AuthContext logout and session state
 *
 * **Property 4: Preservation — Non-Buggy Auth Scenarios Are Unchanged**
 *
 * These tests observe and lock in the CURRENT (unfixed) AuthContext behavior
 * for scenarios where `isBugCondition(X)` is false:
 *   - Logout clears auth state, revokes the backend session/cookie (authApi.logout),
 *     and leaves user === null (the AuthGuard then routes to /login).
 *   - Mock-mode logout still clears local state (no backend calls required).
 *
 * **Validates: Requirements 3.6, 3.7**
 *
 * EXPECTED ON UNFIXED CODE: These tests PASS (baseline behavior to preserve).
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

const logoutApiMock = vi.fn();
const loginApiMock = vi.fn();
const meApiMock = vi.fn();

vi.mock('@/shared/services/auth.api', () => ({
  authApi: {
    me: () => meApiMock(),
    login: (payload: unknown) => loginApiMock(payload),
    logout: () => logoutApiMock(),
  },
}));


vi.mock('@/store/mockData', () => ({
  MOCK_USERS: [],
  MOCK_TENANTS: [],
}));

// ─────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────
//
// NOTE: AuthContext reads `NEXT_PUBLIC_USE_MOCK_AUTH` into a module-level
// constant at import time. To exercise both real-API and mock modes we must
// stub the env BEFORE importing the module and reset the module registry
// between modes so the constant is re-evaluated.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let captured: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ContextProbe(useAuthHook: () => any): () => null {
  return function Probe(): null {
    captured = useAuthHook();
    return null;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAuthModule(mockAuth: boolean): Promise<{ AuthProvider: any; useAuth: any }> {
  vi.stubEnv('NEXT_PUBLIC_USE_MOCK_AUTH', mockAuth ? 'true' : 'false');
  vi.resetModules();
  const mod = await import('../AuthContext');
  return { AuthProvider: mod.AuthProvider, useAuth: mod.useAuth };
}

// ─────────────────────────────────────────────────────
// TESTS — real-API mode
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Property 4: Preservation — AuthContext (real API)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AuthProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let useAuth: any;

  beforeEach(async () => {
    logoutApiMock.mockReset();
    loginApiMock.mockReset();
    meApiMock.mockReset();
    captured = null;
    // No session on mount for these tests.
    meApiMock.mockRejectedValue(new Error('401 no session'));
    logoutApiMock.mockResolvedValue({ data: { success: true } });
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
    ({ AuthProvider, useAuth } = await loadAuthModule(false));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderProvider(): void {
    const Probe = ContextProbe(useAuth);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  }

  it('logout revokes the backend session and clears local state', async () => {
    renderProvider();
    await waitFor(() => expect(captured?.isLoading).toBe(false));

    // Seed some session-scoped storage that logout must clear.
    window.localStorage.setItem('leadcrm_onboarding_complete', '1');
    window.localStorage.setItem('leadcrm_needs_company_setup', '1');
    window.sessionStorage.setItem('leadcrm_redirect_after_login', '/settings');

    await act(async () => {
      await captured!.logout();
    });

    // Backend session revoked (cookie cleared server-side).
    expect(logoutApiMock).toHaveBeenCalledTimes(1);

    // Auth state cleared -> user === null (AuthGuard will route to /login).
    expect(captured?.user).toBeNull();
    expect(captured?.tenant).toBeNull();

    // Onboarding flags + saved redirect cleared so they don't leak across accounts.
    expect(window.localStorage.getItem('leadcrm_onboarding_complete')).toBeNull();
    expect(window.localStorage.getItem('leadcrm_needs_company_setup')).toBeNull();
    expect(window.sessionStorage.getItem('leadcrm_redirect_after_login')).toBeNull();
  });

  it('surfaces failed server logout rather than claiming the session was revoked', async () => {
    logoutApiMock.mockRejectedValueOnce(new Error('network down'));
    renderProvider();
    await waitFor(() => expect(captured?.isLoading).toBe(false));
    await act(async () => {
      await expect(captured!.logout()).rejects.toThrow('network down');
    });
  });
});

// ─────────────────────────────────────────────────────
// TESTS — mock mode
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Property 4: Preservation — AuthContext (mock mode)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AuthProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let useAuth: any;

  beforeEach(async () => {
    logoutApiMock.mockReset();
    captured = null;
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
    ({ AuthProvider, useAuth } = await loadAuthModule(true));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderProvider(): void {
    const Probe = ContextProbe(useAuth);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  }

  it('mock-mode logout clears local state without calling the backend', async () => {
    renderProvider();
    await waitFor(() => expect(captured?.isLoading).toBe(false));

    window.localStorage.setItem('leadcrm_user', JSON.stringify({ id: 'u1' }));
    window.localStorage.setItem('leadcrm_onboarding_complete', '1');

    await act(async () => {
      await captured!.logout();
    });

    // Mock mode must NOT hit the backend.
    expect(logoutApiMock).not.toHaveBeenCalled();

    expect(captured?.user).toBeNull();
    expect(window.localStorage.getItem('leadcrm_user')).toBeNull();
    expect(window.localStorage.getItem('leadcrm_onboarding_complete')).toBeNull();
  });
});

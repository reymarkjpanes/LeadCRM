import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Bug Condition Exploration Tests — Phase 2 (RC-08/09, RC-11)
 *
 * **Property 1: Bug Condition** — AuthContext restoreSession and login() behavior
 *
 * These tests exercise AuthContext.restoreSession() and login() directly.
 * They are isolated in the store/__tests__ directory so they can use vi.resetModules()
 * + dynamic imports to control NEXT_PUBLIC_USE_MOCK_AUTH — they cannot collocate with
 * AuthGuard tests that already use a top-level vi.mock('@/store/AuthContext').
 *
 * EXPECTED FAILURES (bugs exist):
 *   - RC-08/09: authError message for TypeError('Failed to fetch') is not connectivity-specific
 *               (current: 'Failed to fetch' → expected: message mentioning network/connectivity)
 *
 * EXPECTED PASSES (already resolved):
 *   - RC-11: login() returns true and user is set even when post-login me() throws
 *            (fallback to login payload is already in place)
 *
 * **Validates: Requirements 2.4, 2.8, 2.9**
 */

// ─────────────────────────────────────────────────────
// HELPER — loads AuthContext fresh with a controlled mock environment
// ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAuthModule(mocks: {
  meMock: (...args: unknown[]) => unknown;
  loginMock?: (...args: unknown[]) => unknown;
  logoutMock?: (...args: unknown[]) => unknown;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<{ AuthProvider: any; useAuth: any }> {
  vi.stubEnv('NEXT_PUBLIC_USE_MOCK_AUTH', 'false');
  vi.resetModules();

  const { meMock, loginMock = vi.fn(), logoutMock = vi.fn() } = mocks;

  vi.doMock('@/shared/services/auth.api', () => ({
    authApi: {
      me: () => meMock(),
      login: (payload: unknown) => loginMock(payload),
      logout: () => logoutMock(),
    },
  }));
  vi.doMock('next-auth/react', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
  vi.doMock('@/store/mockData', () => ({ MOCK_USERS: [], MOCK_TENANTS: [] }));

  const mod = await import('../AuthContext');
  return { AuthProvider: mod.AuthProvider, useAuth: mod.useAuth };
}

// ─────────────────────────────────────────────────────
// RC-08/09 — Backend unreachable / CORS error message
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-08/09 — Backend unreachable / CORS: authError message is connectivity-specific', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* jsdom */ }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('sets a connectivity-specific authError when authApi.me() throws TypeError("Failed to fetch")', async () => {
    // Simulate a network/CORS failure — TypeError: Failed to fetch — which is the actual
    // error browsers throw when a fetch request fails due to network issues or CORS preflight rejection.
    //
    // EXPECTED (post-fix): authError message mentions network/connectivity/server so users
    // know the backend is down, not that they have an auth issue.
    //
    // FAILS on unfixed code — the current catch block produces:
    //   `err instanceof Error ? err.message : 'Unable to verify your session'`
    //   For TypeError('Failed to fetch') this returns 'Failed to fetch' — a raw browser error
    //   message that does not mention connectivity or how to diagnose the issue.
    const meMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { AuthProvider, useAuth } = await loadAuthModule({ meMock });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedAuth: any = null;

    function Probe(): null {
      capturedAuth = useAuth();
      return null;
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(capturedAuth?.isLoading).toBe(false);
    });

    // EXPECTED (post-fix): message mentions connectivity/network/server
    // FAILS on unfixed code — message is just 'Failed to fetch' (not connectivity-specific)
    const errorMsg = (capturedAuth?.authError ?? '').toLowerCase();
    const isConnectivityMessage =
      errorMsg.includes('connect') ||
      errorMsg.includes('network') ||
      errorMsg.includes('server') ||
      errorMsg.includes('contact support');

    expect(
      isConnectivityMessage,
      `Expected authError to be connectivity-specific but got: "${capturedAuth?.authError}"`,
    ).toBe(true);
  });

  it('does NOT set a connectivity authError for a 401 no-session response (preservation)', async () => {
    // Preservation: a normal 401 / "no session" response must NOT produce authError.
    // The isNoSessionError classifier must correctly identify these as "logged out" not "broken".
    //
    // EXPECTED: authError remains null after a 401 (user is simply not logged in).
    // EXPECTED TO PASS on both unfixed and fixed code (preservation test).
    const meMock = vi.fn().mockRejectedValue(new Error('Authentication required'));
    const { AuthProvider, useAuth } = await loadAuthModule({ meMock });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedAuth: any = null;

    function Probe(): null {
      capturedAuth = useAuth();
      return null;
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(capturedAuth?.isLoading).toBe(false);
    });

    // Preservation: 401 no-session → no error exposed
    expect(capturedAuth?.authError).toBeNull();
  });
});

// ─────────────────────────────────────────────────────
// RC-11 — login() returns true even when post-login me() throws (already resolved)
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-11 — login() returns true and sets user even when post-login me() throws (already resolved)', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* jsdom */ }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('login() returns true and user is populated from the login payload when post-login me() throws', async () => {
    // RC-11 was identified as already resolved in the design doc — this test CONFIRMS it.
    // The login() function in AuthContext has a try/catch around the post-login me() call
    // that falls back to the login payload and still returns true.
    //
    // EXPECTED: PASSES on unfixed AND fixed code (confirms resolution is in place).

    const LOGIN_PAYLOAD_USER = {
      id: 'user-login-1',
      email: 'alice@democorp.com',
      role: 'Client Admin',
      firstName: 'Alice',
      lastName: 'Admin',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      emailVerified: '2026-01-01T00:00:00.000Z',
      tenantName: 'Demo Corp',
      onboardingStep: 3,
      onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
    };

    const loginMock = vi.fn().mockResolvedValue({ data: { user: LOGIN_PAYLOAD_USER } });
    // me() throws on session restore (normal 401 — not logged in yet), then
    // throws again when login() calls it for defense-in-depth re-hydration.
    const meMock = vi.fn()
      .mockRejectedValueOnce(new Error('Authentication required'))  // session restore
      .mockRejectedValueOnce(new Error('Network error'));            // post-login re-hydrate

    const { AuthProvider, useAuth } = await loadAuthModule({ meMock, loginMock });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedAuth: any = null;

    function Probe(): null {
      capturedAuth = useAuth() as typeof capturedAuth;
      return null;
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // Wait for session restore to complete (isLoading → false after 401)
    await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

    let loginResult = false;
    await act(async () => {
      loginResult = await capturedAuth!.login('alice@democorp.com', 'password123');
    });

    // EXPECTED (RC-11 already resolved): login() returns true — fallback to login payload works.
    expect(loginResult).toBe(true);
    expect(capturedAuth?.user).not.toBeNull();
    const userObj = capturedAuth?.user as Record<string, unknown>;
    expect(userObj?.email).toBe('alice@democorp.com');
  });
});

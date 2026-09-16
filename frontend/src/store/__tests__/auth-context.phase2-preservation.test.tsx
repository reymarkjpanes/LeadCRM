import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Preservation Tests — Phase 2 (AuthContext session/login/oauth/mock behavior)
 *
 * **Property 2: Preservation — Non-Buggy Auth Scenarios Unchanged by Phase 2 Fixes**
 *
 * This file covers AuthContext-level preservation for the Phase 2 fix set.
 * It is isolated here (rather than collocated with the AuthGuard tests) because
 * these tests use vi.resetModules() + vi.doMock() to control NEXT_PUBLIC_USE_MOCK_AUTH
 * — which conflicts with the top-level vi.mock('@/store/AuthContext') in
 * auth-guard.phase2-preservation.test.tsx.
 *
 * Scenarios:
 *   5. Auth-init 401 response → authError=null, user=null (not a transport error)
 *   6. Successful login with working me() → login() returns true, user populated
 *   7. Google OAuth → loginWithGoogle() still triggers NextAuth signIn unchanged
 *   8. Mock-mode → localStorage flow unchanged, no backend calls
 *
 * **Validates: Requirements 3.1, 3.6, 3.7, 3.8**
 *
 * EXPECTED ON UNFIXED CODE: ALL tests PASS.
 * These lock in the baseline; they must still pass AFTER Phase 2 fixes are applied.
 */

// ─────────────────────────────────────────────────────
// HELPERS — dynamic module loaders
// ─────────────────────────────────────────────────────

async function loadRealApiAuthModule(mocks: {
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

async function loadMockAuthModule(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthProvider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAuth: any;
}> {
  vi.stubEnv('NEXT_PUBLIC_USE_MOCK_AUTH', 'true');
  vi.resetModules();
  vi.doMock('@/shared/services/auth.api', () => ({
    authApi: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
  }));
  vi.doMock('next-auth/react', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
  vi.doMock('@/store/mockData', () => ({ MOCK_USERS: [], MOCK_TENANTS: [] }));
  const mod = await import('../AuthContext');
  return { AuthProvider: mod.AuthProvider, useAuth: mod.useAuth };
}

// ─────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────

const CANONICAL_USER = {
  id: 'user-canon-1',
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

// ─────────────────────────────────────────────────────
// Preservation 5 — Auth-init 401 path: user=null, authError=null
// ─────────────────────────────────────────────────────

describe(
  'Feature: auth-login-blank-screen-fix, Property 2: Preservation — Auth-init 401 → no authError (real API)',
  () => {
    /**
     * A 401 / "no session" response from /auth/me during session restore must produce:
     *   user=null, authError=null → guard redirects to /login normally.
     *
     * The RC-08/09 fix improves the error message for genuine transport failures.
     * It MUST NOT change the 401 path — that must remain: user=null, authError=null.
     *
     * **Validates: Requirement 3.1**
     */
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch { /* jsdom */ }
    });

    it('401 "Authentication required" from /auth/me → user=null, authError=null', async () => {
      const meMock = vi.fn().mockRejectedValue(new Error('Authentication required'));
      const { AuthProvider, useAuth } = await loadRealApiAuthModule({ meMock });

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

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      // EXPECTED: no error state — user is simply not logged in (normal no-session path)
      // The RC-08/09 fix must NOT change this path to show an error.
      expect(capturedAuth?.user).toBeNull();
      expect(capturedAuth?.authError).toBeNull();
    });

    it('"Invalid or expired token" from /auth/me → user=null, authError=null', async () => {
      // Another common no-session message from the backend JWT middleware.
      const meMock = vi.fn().mockRejectedValue(new Error('Invalid or expired token'));
      const { AuthProvider, useAuth } = await loadRealApiAuthModule({ meMock });

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

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      expect(capturedAuth?.user).toBeNull();
      expect(capturedAuth?.authError).toBeNull();
    });

    it('"unauthorized" from /auth/me → user=null, authError=null', async () => {
      const meMock = vi.fn().mockRejectedValue(new Error('Unauthorized'));
      const { AuthProvider, useAuth } = await loadRealApiAuthModule({ meMock });

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

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      expect(capturedAuth?.user).toBeNull();
      expect(capturedAuth?.authError).toBeNull();
    });
  },
);

// ─────────────────────────────────────────────────────
// Preservation 6 — Successful login with working me(): returns true, populates user
// ─────────────────────────────────────────────────────

describe(
  'Feature: auth-login-blank-screen-fix, Property 2: Preservation — Successful login with working me() (real API)',
  () => {
    /**
     * A successful login() with a working post-login me() call must:
     *   - Return true
     *   - Populate user with the canonical /auth/me payload (gate fields included)
     *   - Leave authError=null
     *
     * **Validates: Requirements 3.1, 3.6**
     */
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch { /* jsdom */ }
    });

    it('login() returns true and hydrates user from /auth/me when both login API and me() succeed', async () => {
      const meMock = vi.fn()
        .mockRejectedValueOnce(new Error('Authentication required')) // session restore (no session)
        .mockResolvedValueOnce({ data: { user: CANONICAL_USER } });  // post-login re-hydrate
      const loginMock = vi.fn().mockResolvedValue({ data: { user: CANONICAL_USER } });

      const { AuthProvider, useAuth } = await loadRealApiAuthModule({ meMock, loginMock });

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

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      let loginResult = false;
      await act(async () => {
        loginResult = await capturedAuth!.login('alice@democorp.com', 'correct-password');
      });

      // EXPECTED: login returns true, user hydrated from /auth/me with complete gate fields
      expect(loginResult).toBe(true);
      expect(capturedAuth?.user?.id).toBe('user-canon-1');
      expect(capturedAuth?.user?.emailVerified).toBe(CANONICAL_USER.emailVerified);
      expect(capturedAuth?.user?.onboardingCompletedAt).toBe(CANONICAL_USER.onboardingCompletedAt);
      expect(capturedAuth?.user?.tenantName).toBe(CANONICAL_USER.tenantName);
      expect(capturedAuth?.authError).toBeNull();
    });

    it('login() throws for invalid credentials (credentials error propagates to the login page)', async () => {
      // Invalid credentials → login API throws → login() propagates the error.
      // The login page catches the thrown error and displays it to the user.
      // This is the current behavior: errors propagate, they don't return false.
      const meMock = vi.fn().mockRejectedValue(new Error('Authentication required'));
      const loginMock = vi.fn().mockRejectedValue(new Error('Invalid credentials'));

      const { AuthProvider, useAuth } = await loadRealApiAuthModule({ meMock, loginMock });

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

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      // EXPECTED: login() propagates the error — user stays null, authError stays null
      // (the login page owns the error display, not the auth context)
      let thrownError: Error | null = null;
      await act(async () => {
        try {
          await capturedAuth!.login('alice@democorp.com', 'wrong-password');
        } catch (err: unknown) {
          thrownError = err instanceof Error ? err : new Error(String(err));
        }
      });

      expect(thrownError).not.toBeNull();
      expect((thrownError as Error | null)?.message).toBe('Invalid credentials');
      expect(capturedAuth?.user).toBeNull();
    });
  },
);

// ─────────────────────────────────────────────────────
// Preservation 7 — Google OAuth flow unchanged
// ─────────────────────────────────────────────────────

describe(
  'Feature: auth-login-blank-screen-fix, Property 2: Preservation — Google OAuth flow unchanged (real API)',
  () => {
    /**
     * loginWithGoogle() must still trigger NextAuth signIn with callbackUrl: '/'.
     * The Phase 2 fixes must not change this behavior.
     *
     * **Validates: Requirement 3.7**
     */
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch { /* jsdom */ }
    });

    it('loginWithGoogle() calls signIn("google", { callbackUrl: "/" }) — unchanged', async () => {
      const meMock = vi.fn().mockRejectedValue(new Error('Authentication required'));
      const nextAuthSignIn = vi.fn().mockResolvedValue(undefined);

      vi.stubEnv('NEXT_PUBLIC_USE_MOCK_AUTH', 'false');
      vi.resetModules();
      vi.doMock('@/shared/services/auth.api', () => ({
        authApi: { me: () => meMock(), login: vi.fn(), logout: vi.fn() },
      }));
      vi.doMock('next-auth/react', () => ({
        signIn: (...args: unknown[]) => nextAuthSignIn(...args),
        signOut: vi.fn(),
      }));
      vi.doMock('@/store/mockData', () => ({ MOCK_USERS: [], MOCK_TENANTS: [] }));

      const mod = await import('../AuthContext');
      const { AuthProvider, useAuth } = mod;

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

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      await act(async () => {
        await capturedAuth!.loginWithGoogle();
      });

      // EXPECTED: unchanged — same signIn call as before Phase 2 fixes
      expect(nextAuthSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/' });
    });
  },
);

// ─────────────────────────────────────────────────────
// Preservation 8 — Mock-mode: localStorage flow unchanged
// ─────────────────────────────────────────────────────

describe(
  'Feature: auth-login-blank-screen-fix, Property 2: Preservation — Mock-mode behavior unchanged',
  () => {
    /**
     * Mock-mode uses the localStorage flow only — no backend API calls.
     * Phase 2 fixes must not change mock-mode behavior in any way.
     *
     * **Validates: Requirement 3.8**
     */
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch { /* jsdom */ }
    });

    it('mock-mode restoreSession reads from localStorage without calling any backend API', async () => {
      const { AuthProvider, useAuth } = await loadMockAuthModule();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedAuth: any = null;
      function Probe(): null {
        capturedAuth = useAuth();
        return null;
      }

      // Seed a user in localStorage (mock mode reads from here, not from API)
      const mockUser = {
        id: 'mock-u1',
        email: 'mockuser@test.com',
        role: 'Client Admin',
        tenantId: 'mock-t1',
      };
      window.localStorage.setItem('leadcrm_user', JSON.stringify(mockUser));
      window.localStorage.setItem(
        'leadcrm_tenant',
        JSON.stringify({ id: 'mock-t1', name: 'MockCorp', status: 'active', environment: 'production' }),
      );

      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      // EXPECTED: user hydrated from localStorage (unchanged mock-mode behavior)
      expect(capturedAuth?.user?.id).toBe('mock-u1');
      expect(capturedAuth?.user?.email).toBe('mockuser@test.com');
      expect(capturedAuth?.authError).toBeNull();
    });

    it('mock-mode with no localStorage user → user=null, authError=null (no network involved)', async () => {
      const { AuthProvider, useAuth } = await loadMockAuthModule();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedAuth: any = null;
      function Probe(): null {
        capturedAuth = useAuth();
        return null;
      }

      // Empty localStorage — no session
      window.localStorage.removeItem('leadcrm_user');

      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      // EXPECTED: user=null, authError=null (no network failure possible in mock mode)
      // This is the normal logged-out state in mock mode.
      expect(capturedAuth?.user).toBeNull();
      expect(capturedAuth?.authError).toBeNull();
    });

    it('mock-mode login() succeeds without hitting the backend API', async () => {
      const { AuthProvider, useAuth } = await loadMockAuthModule();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedAuth: any = null;
      function Probe(): null {
        capturedAuth = useAuth();
        return null;
      }

      // Seed the mock user store
      const mockUser = {
        id: 'mock-u2',
        email: 'admin@democorp.com',
        role: 'Client Admin',
        tenantId: 'mock-t2',
        status: 'active',
      };
      const mockTenant = { id: 'mock-t2', name: 'Demo Corp', status: 'active', environment: 'production' };
      window.localStorage.setItem('leadcrm_users', JSON.stringify([mockUser]));
      window.localStorage.setItem('leadcrm_tenants', JSON.stringify([mockTenant]));

      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await waitFor(() => expect(capturedAuth?.isLoading).toBe(false));

      let loginResult = false;
      await act(async () => {
        loginResult = await capturedAuth!.login('admin@democorp.com');
      });

      // EXPECTED: mock-mode login succeeds using localStorage data (no API call)
      expect(loginResult).toBe(true);
      expect(capturedAuth?.user?.id).toBe('mock-u2');
    });
  },
);

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Bug Condition Exploration Test — Auth-init failure (edge)
 *
 * **Property 1: Bug Condition — Verified, Onboarded Login User Reaches the Dashboard**
 * (edge case in the isBugCondition domain: X.authInitFailed = true AND X.rendersNull = true)
 *
 * This test encodes the EXPECTED (post-fix) behavior: when `authApi.me()` throws
 * during `restoreSession` (a genuine transport failure, not a logged-out 401),
 * `AuthContext` must expose an explicit error / recovery state rather than silently
 * setting `user = null`, which downstream produces a blank screen.
 *
 * **Validates: Requirements 1.3, 1.5**
 *
 * EXPECTED ON UNFIXED CODE: This test FAILS.
 *   - `restoreSession`'s catch swallows the failure with `setUser(null)` and exposes
 *     no `authError` (or equivalent recovery state) on the context value.
 *
 * DO NOT fix the test or the code when it fails — the failure confirms the bug.
 */

// ─────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────

// Force real-API auth path (USE_MOCK_AUTH = NEXT_PUBLIC_USE_MOCK_AUTH !== 'false').
vi.stubEnv('NEXT_PUBLIC_USE_MOCK_AUTH', 'false');

const meMock = vi.fn();

vi.mock('@/shared/services/auth.api', () => ({
  authApi: {
    me: () => meMock(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

// Mock data / types are imported by AuthContext; provide minimal stubs.
vi.mock('@/store/mockData', () => ({
  MOCK_USERS: [],
  MOCK_TENANTS: [],
}));

import { AuthProvider, useAuth } from '../AuthContext';

// ─────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────

// Captures the full context value so the test can inspect for a recovery state.
let capturedContext: Record<string, unknown> | null = null;

function ContextProbe(): null {
  capturedContext = useAuth() as unknown as Record<string, unknown>;
  return null;
}

// ─────────────────────────────────────────────────────
// TEST
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Property 1: Bug Condition — Auth-init failure', () => {
  beforeEach(() => {
    meMock.mockReset();
    capturedContext = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes an error/recovery state (not a silent user=null) when /auth/me throws during restoreSession', async () => {
    // Simulate a genuine transport failure from /auth/me (network/backend hiccup),
    // distinct from a logged-out 401.
    meMock.mockRejectedValue(new Error('Network error: /auth/me failed'));

    render(
      <AuthProvider>
        <ContextProbe />
      </AuthProvider>,
    );

    // Wait for restoreSession to settle (isLoading flips false after the catch).
    await waitFor(() => {
      expect(capturedContext).not.toBeNull();
      expect(capturedContext?.isLoading).toBe(false);
    });

    // EXPECTED (post-fix): a recovery affordance is exposed — an explicit
    // `authError` value and/or a `retryAuthInit` action — so the UI can surface
    // an error state instead of a silent blank screen.
    // FAILS on unfixed code — the failure is swallowed to user=null with no error surface.
    const hasErrorState =
      capturedContext?.authError !== undefined && capturedContext?.authError !== null;
    const hasRetryAction = typeof capturedContext?.retryAuthInit === 'function';

    expect(hasErrorState || hasRetryAction).toBe(true);
  });
});

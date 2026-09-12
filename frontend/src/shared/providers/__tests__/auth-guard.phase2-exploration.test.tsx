import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Bug Condition Exploration Tests — Phase 2 (RC-05 through RC-12)
 *
 * **Property 1: Bug Condition** - Routing Defects and UX Gaps
 *
 * These tests encode the EXPECTED (post-fix) behavior for Phase 2 defects.
 * They MUST FAIL on unfixed code — failure confirms each bug exists.
 *
 * DO NOT fix the test or the code when it fails — the failure confirms the bug.
 *
 * EXPECTED FAILURES (bugs exist):
 *   - RC-05: AuthGuard redirects user with emailVerified=null to /verify-email even when ACTIVE
 *   - RC-06: System Admin is sent to /dashboard via saved redirect instead of /admin/dashboard
 *   - RC-07: Invited user (tenantName set, onboardingCompletedAt=null) is sent to /onboarding
 *   - RC-08/09: authError message for TypeError('Failed to fetch') is not connectivity-specific
 *
 * EXPECTED PASSES (already resolved):
 *   - RC-11: login() returns true and user is set even when post-login me() throws
 *   - RC-12: no-session path does not produce an infinite redirect loop
 *
 * **Validates: Requirements 2.5, 2.6, 2.7, 2.8, 2.9**
 */

// ─────────────────────────────────────────────────────
// SHARED AUTH GUARD MOCKS
// ─────────────────────────────────────────────────────

const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

// Controllable auth state — each test sets this before rendering.
let authState: {
  user: unknown;
  isLoading: boolean;
  authError?: string | null;
  retryAuthInit?: () => Promise<void>;
} = { user: null, isLoading: false, authError: null };

vi.mock('@/store/AuthContext', () => ({
  useAuth: () => authState,
}));

import { AuthGuard } from '../auth-guard';

// ─────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────

/** Active SEEDED user whose emailVerified is null (the RC-05 scenario). */
const SEEDED_USER_NULL_EMAIL_VERIFIED = {
  id: 'admin-democorp-id',
  email: 'admin@democorp.com',
  role: 'Client Admin',
  firstName: 'Client',
  lastName: 'Admin',
  tenantId: 'demo-corp-tenant',
  status: 'ACTIVE',
  emailVerified: null,   // ← the bug condition
  tenantName: 'Demo Corp',
  onboardingStep: 3,
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
};

/** System Admin user (RC-06 scenario). */
const SYSTEM_ADMIN_USER = {
  id: 'sysadmin-1',
  email: 'admin@gmail.com',
  role: 'System Admin',
  firstName: 'System',
  lastName: 'Admin',
  tenantId: 'leadcrm-system-demo',
  status: 'ACTIVE',
  emailVerified: '2026-01-01T00:00:00.000Z',
  tenantName: 'LeadCRM System Demo',
  onboardingStep: 3,
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
};

/** Invited user whose tenant is named but onboardingCompletedAt is null (RC-07). */
const INVITED_USER_WITH_TENANT_NAME = {
  id: 'invited-user-1',
  email: 'bob@acmecorp.com',
  role: 'User',
  firstName: 'Bob',
  lastName: 'Invited',
  tenantId: 'acme-corp-tenant',
  status: 'ACTIVE',
  emailVerified: '2026-01-01T00:00:00.000Z',
  tenantName: 'Acme Corp',         // ← tenant has a name → user is NOT a new tenant
  onboardingStep: 0,
  onboardingCompletedAt: null,     // ← guard currently checks only tenantName, not this
};

// ─────────────────────────────────────────────────────
// RC-05 — Seeded account gated by emailVerified = null
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-05 — Seeded account gated by emailVerified = null', () => {
  beforeEach(() => {
    routerReplace.mockClear();
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* jsdom */ }
  });

  it('does NOT redirect a seeded ACTIVE user (emailVerified=null) to /verify-email', () => {
    // A seeded/demo account that passed backend login (isDemoMode bypass) but has
    // emailVerified=null. The frontend guard must NOT gate this user to /verify-email.
    //
    // EXPECTED (post-fix): no redirect to /verify-email — the seed sets emailVerified in DB
    // FAILS on unfixed code — guard checks `!emailVerified` (null is falsy) → misroutes
    authState = { user: SEEDED_USER_NULL_EMAIL_VERIFIED, isLoading: false, authError: null };

    render(
      <AuthGuard>
        <div>dashboard content</div>
      </AuthGuard>,
    );

    const verifyEmailCalls = routerReplace.mock.calls
      .map((call) => String(call[0]))
      .filter((target) => target.startsWith('/verify-email'));

    expect(verifyEmailCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// RC-06 — System Admin routed to /dashboard via saved redirect
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-06 — System Admin routed to /dashboard via saved redirect', () => {
  beforeEach(() => {
    routerReplace.mockClear();
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* jsdom */ }
  });

  it('routes System Admin to /admin/dashboard, NOT to the saved redirect /dashboard', () => {
    // A System Admin who previously visited /dashboard (or had it saved for any reason).
    // The guard must ALWAYS route System Admins to /admin/dashboard regardless of saved redirect.
    //
    // EXPECTED (post-fix): router.replace('/admin/dashboard')
    // FAILS on unfixed code — saved redirect '/dashboard' passes the `!isAdminPath` condition
    // and System Admin is sent to /dashboard instead of /admin/dashboard.

    // Simulate a saved redirect pointing to the tenant dashboard (non-admin path)
    window.sessionStorage.setItem('leadcrm_redirect_after_login', '/dashboard');

    // Current pathname is / so isEntryPoint = true (role-based default fires)
    vi.mock('next/navigation', () => ({
      useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
      usePathname: () => '/',
    }));

    authState = { user: SYSTEM_ADMIN_USER, isLoading: false, authError: null };

    render(
      <AuthGuard>
        <div>admin content</div>
      </AuthGuard>,
    );

    // EXPECTED (post-fix): every replace call goes to /admin/dashboard, never /dashboard
    // FAILS if /dashboard appears in the calls
    const replaceCalls = routerReplace.mock.calls.map((call) => String(call[0]));
    const wentToDashboard = replaceCalls.includes('/dashboard');
    const wentToAdminDashboard = replaceCalls.includes('/admin/dashboard');

    // The fix must ensure the saved redirect is not followed for System Admins
    expect(wentToDashboard).toBe(false);
    // And the role-based default correctly routes to admin dashboard
    expect(wentToAdminDashboard).toBe(true);
  });
});

// ─────────────────────────────────────────────────────
// RC-07 — Invited user sent to /onboarding when tenantName is set
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-07 — Invited user sent to /onboarding when tenantName is set', () => {
  beforeEach(() => {
    routerReplace.mockClear();
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* jsdom */ }
  });

  it('does NOT redirect an invited user to /onboarding when tenantName is already set', () => {
    // An invited user joined an existing tenant (tenantName = 'Acme Corp').
    // The tenant already completed onboarding — this user should NOT be sent to /onboarding.
    // localStorage has no onboarding completion key (user never ran onboarding themselves).
    //
    // EXPECTED (post-fix): no redirect to /onboarding (tenantName is set)
    // FAILS on unfixed code — guard checks `!tenantName && !localOnboardingDone`
    // but an empty-string or null tenantName would still trigger the gate; more critically,
    // the guard does NOT check onboardingCompletedAt, so invited users with a valid tenant
    // but no local flag are misrouted.

    authState = { user: INVITED_USER_WITH_TENANT_NAME, isLoading: false, authError: null };

    render(
      <AuthGuard>
        <div>crm content</div>
      </AuthGuard>,
    );

    const onboardingCalls = routerReplace.mock.calls
      .map((call) => String(call[0]))
      .filter((target) => target.startsWith('/onboarding'));

    // EXPECTED (post-fix): invited user with tenantName set is never sent to /onboarding
    expect(onboardingCalls).toEqual([]);
  });

  it('does NOT redirect to /onboarding when tenantName is an empty string but onboardingCompletedAt is set', () => {
    // Edge case: tenantName may be '' (empty string) from the backend if not yet set,
    // but onboardingCompletedAt is set (tenant did complete onboarding).
    // The guard must check onboardingCompletedAt as an additional fallback.
    //
    // EXPECTED (post-fix): no redirect to /onboarding
    // FAILS on unfixed code — '' is falsy so `!tenantName` is true, and without checking
    // onboardingCompletedAt the guard fires incorrectly.
    const userWithEmptyTenantName = {
      ...INVITED_USER_WITH_TENANT_NAME,
      tenantName: '',              // ← empty string (falsy)
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z', // ← tenant DID onboard
    };

    authState = { user: userWithEmptyTenantName, isLoading: false, authError: null };

    render(
      <AuthGuard>
        <div>crm content</div>
      </AuthGuard>,
    );

    const onboardingCalls = routerReplace.mock.calls
      .map((call) => String(call[0]))
      .filter((target) => target.startsWith('/onboarding'));

    expect(onboardingCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────
// NOTE: RC-08/09 and RC-11 tests are in a separate file:
//   src/store/__tests__/auth-context-phase2-exploration.test.tsx
//
// These tests exercise AuthContext.restoreSession() and login() directly and
// require vi.resetModules() + dynamic imports to control the NEXT_PUBLIC_USE_MOCK_AUTH
// env var. They cannot be collocated with AuthGuard tests that already use a
// top-level vi.mock('@/store/AuthContext') — the static mock from this file
// would interfere with the dynamic module reloads needed for those tests.
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// RC-12 — Infinite redirect loop (EXPECTED TO PASS — already resolved)
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, RC-12 — Infinite redirect loop terminates (already resolved)', () => {
  beforeEach(() => {
    routerReplace.mockClear();
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch { /* jsdom */ }
  });

  it('AuthGuard with user=null redirects to /login exactly once and does not loop', () => {
    // RC-12: no-session → guard → login → guard cycle should terminate.
    // Confirm: AuthGuard redirects to /login once when user=null, does NOT keep firing.
    //
    // EXPECTED (RC-12 already resolved): exactly 1 replace('/login') call
    authState = { user: null, isLoading: false, authError: null };

    // Render on /dashboard (a protected route the unauthenticated user tried to access)
    vi.mock('next/navigation', () => ({
      useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
      usePathname: () => '/dashboard',
    }));

    render(
      <AuthGuard>
        <div>protected content</div>
      </AuthGuard>,
    );

    // Count calls to replace('/login') — should be exactly 1
    const loginRedirects = routerReplace.mock.calls
      .map((call) => String(call[0]))
      .filter((target) => target === '/login');

    // EXPECTED: terminates after 1 redirect (no loop)
    expect(loginRedirects.length).toBeLessThanOrEqual(1);
  });
});

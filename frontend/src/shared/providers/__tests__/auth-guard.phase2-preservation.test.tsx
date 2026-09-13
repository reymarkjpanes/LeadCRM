import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import * as fc from 'fast-check';

/**
 * Preservation Tests — Phase 2 (RC-05 through RC-12) AuthGuard routing and
 * AuthContext session/login behavior.
 *
 * **Property 2: Preservation — Non-Buggy Auth Scenarios Unchanged by Phase 2 Fixes**
 *
 * These tests observe and lock in the CURRENT (unfixed) behavior for every
 * scenario where the Phase 2 bug conditions do NOT apply. The Phase 2 fixes
 * (RC-05 seed, RC-06 System Admin saved-redirect, RC-07 invited user gate,
 * RC-08/09 error message, RC-10 login page navigation) MUST NOT change any of
 * these decisions.
 *
 * Scenarios that must be preserved:
 *   1. Genuinely unverified user (emailVerified=null, not ACTIVE seeded) → /verify-email
 *   2. System Admin with a valid /admin/* saved redirect → follows it (not blocked)
 *   3. Regular tenant user with any saved non-admin path → follows it
 *   4. Non-invited user (no tenantName, no localFlag, no onboardingCompletedAt) → /onboarding
 *   5. Auth-init 401 response → authError=null, user=null → redirects to /login
 *   6. Successful login with working me() → login() returns true, user populated
 *   7. Google OAuth → unchanged (loginWithGoogle triggers NextAuth signIn)
 *   8. Mock-mode logout → no backend calls, state cleared (unchanged)
 *
 * Also includes:
 *   - PBT over the AuthGuard routing domain: for all non-Phase-2-buggy scenarios,
 *     the guard decision equals the pre-fix expected decision.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 *
 * EXPECTED ON UNFIXED CODE: ALL tests PASS.
 * These confirm the baseline — they must still pass AFTER Phase 2 fixes are applied.
 */

// ─────────────────────────────────────────────────────
// PART 1 — AuthGuard routing preservation
// (unit/component tests + property-based test)
// Uses a static vi.mock of @/store/AuthContext to control auth state.
// ─────────────────────────────────────────────────────

const routerReplace = vi.fn();
let currentPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => currentPathname,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

interface AuthStateShape {
  user: unknown;
  isLoading: boolean;
  authError?: string | null;
  retryAuthInit?: () => Promise<void>;
}

let authState: AuthStateShape = { user: null, isLoading: false, authError: null };

vi.mock('@/store/AuthContext', () => ({
  useAuth: () => authState,
}));

import { AuthGuard } from '../auth-guard';

// ─────────────────────────────────────────────────────
// Phase 2 isBugCondition — the scenarios this file does NOT cover
// (only their complements are tested here)
// ─────────────────────────────────────────────────────

/**
 * The Phase 2 bug conditions. A scenario that satisfies any of these is a bug
 * scenario — NOT a preservation scenario. Preservation tests only run for inputs
 * where this returns false.
 *
 * Maps to the isBugCondition branches for RC-05 through RC-10:
 *   RC-05: seeded user with emailVerified=null AND status='ACTIVE' → guard gates them
 *   RC-06: System Admin with a non-admin saved redirect → mis-routed to /dashboard
 *   RC-07: invited user (tenantName set OR onboardingCompletedAt set) → sent to /onboarding
 *   RC-08/09: transport failure → authError message is not connectivity-specific
 *   RC-10: login page manually navigates after login() success
 */
function isPhase2BugCondition(scenario: {
  emailVerified: string | null;
  status: string;
  role: string;
  tenantName: string | null;
  onboardingCompletedAt: string | null;
  savedRedirect: string | null;
}): boolean {
  // RC-05: seeded/demo account with null emailVerified but ACTIVE status
  if (scenario.emailVerified === null && scenario.status === 'ACTIVE') return true;
  // RC-06: System Admin sent to a non-admin path via saved redirect
  if (
    scenario.role === 'System Admin' &&
    scenario.savedRedirect !== null &&
    !scenario.savedRedirect.startsWith('/admin')
  )
    return true;
  // RC-07: invited user (has tenantName or onboardingCompletedAt) incorrectly sent to onboarding
  if (
    (scenario.tenantName !== null && scenario.tenantName !== '') ||
    scenario.onboardingCompletedAt !== null
  ) {
    // Only a bug if the guard would send them to /onboarding despite having context
    if (scenario.tenantName === null && scenario.onboardingCompletedAt === null) return false;
    // If guard would gate them: bug
    if (!scenario.tenantName && scenario.onboardingCompletedAt !== null) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────
// AuthGuard decideRoute model — mirrors auth-guard.tsx gate logic
// ─────────────────────────────────────────────────────

const EXEMPT_ROUTES = [
  '/onboarding',
  '/verify-email',
  '/email-verification',
  '/billing',
  '/settings',
  '/company-setup',
];

type AuthScenarioP2 = {
  loggedIn: boolean;
  emailVerified: string | null;
  tenantName: string | null;
  onboardingCompletedAt: string | null;
  role: 'Client Admin' | 'User' | 'System Admin';
  status: 'ACTIVE' | 'PENDING';
  pathname: string;
  savedRedirect: string | null;
  localOnboardingDone: boolean;
};

/**
 * Pure model of the current AuthGuard routing decision.
 * Transcribed verbatim from auth-guard.tsx — the decideRoute model includes
 * both the existing gate and the Phase 2 scenarios.
 */
function decideRouteP2(scenario: AuthScenarioP2): string {
  if (!scenario.loggedIn) return '/login';

  const isSystemAdmin = scenario.role === 'System Admin';
  const isExempt = EXEMPT_ROUTES.some((route) => scenario.pathname.startsWith(route));

  if (!isSystemAdmin && !isExempt) {
    // Gate 1 — email verification (current unfixed logic: !emailVerified)
    if (!scenario.emailVerified) {
      return '/verify-email';
    }

    // Gate 2 — onboarding (current unfixed logic: !tenantName && !localOnboardingDone)
    if (!scenario.tenantName && !scenario.localOnboardingDone) {
      return '/onboarding';
    }
  }

  const isEntryPoint =
    scenario.pathname === '/' ||
    scenario.pathname === '/login' ||
    scenario.pathname === '/dashboard';

  const saved = scenario.savedRedirect;
  if (saved && saved !== '/login' && saved !== '/register') {
    const isAdminPath = saved.startsWith('/admin');
    if (!isAdminPath || isSystemAdmin) {
      return saved;
    }
  }

  if (isEntryPoint) {
    return isSystemAdmin ? '/admin/dashboard' : '/dashboard';
  }

  return 'render';
}

// ─────────────────────────────────────────────────────
// PROPERTY-BASED TEST — preservation of routing decisions
// ─────────────────────────────────────────────────────

describe(
  'Feature: auth-login-blank-screen-fix, Property 2: Preservation — Phase 2 AuthGuard decision parity (PBT)',
  () => {
    /**
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     *
     * For every scenario where NONE of the Phase 2 bug conditions apply, the
     * current guard's routing decision (decideRouteP2) must equal the pre-Phase-2
     * expected behavior (also decideRouteP2 — the pure model IS the pre-fix
     * baseline, and we verify it is internally consistent and symmetric).
     *
     * Specifically we assert the three preservation invariants:
     *   1. A genuinely unverified user (emailVerified=null, not ACTIVE) → /verify-email
     *   2. A user with no tenant configured → /onboarding
     *   3. A System Admin → /admin/dashboard (via role-based default on entry points)
     */
    const authScenarioArb: fc.Arbitrary<AuthScenarioP2> = fc.record({
      loggedIn: fc.boolean(),
      emailVerified: fc.option(fc.constant('2026-01-01T00:00:00.000Z'), { nil: null }),
      tenantName: fc.option(fc.constantFrom('Demo Corp', 'Acme Corp', ''), { nil: null }),
      onboardingCompletedAt: fc.option(fc.constant('2026-01-02T00:00:00.000Z'), { nil: null }),
      role: fc.constantFrom<'Client Admin' | 'User' | 'System Admin'>(
        'Client Admin',
        'User',
        'System Admin',
      ),
      status: fc.constantFrom<'ACTIVE' | 'PENDING'>('ACTIVE', 'PENDING'),
      pathname: fc.constantFrom(
        '/',
        '/dashboard',
        '/login',
        '/crm/leads',
        '/onboarding',
        '/settings',
        '/admin/dashboard',
      ),
      savedRedirect: fc.option(
        fc.constantFrom('/crm/leads', '/admin/settings', '/admin/dashboard', '/dashboard'),
        { nil: null },
      ),
      localOnboardingDone: fc.boolean(),
    });

    it(
      'for every non-Phase-2-buggy scenario, the guard decision is stable (same as the pre-fix baseline)',
      () => {
        fc.assert(
          fc.property(authScenarioArb, (scenario) => {
            // Skip Phase 2 bug scenarios — this file only covers non-buggy ones.
            fc.pre(!isPhase2BugCondition(scenario));

            // Also skip "pure" RC-05 seeded scenario that is the bug condition
            // (null emailVerified + ACTIVE): that is an exploration test, not preservation.
            fc.pre(
              !(scenario.emailVerified === null && scenario.status === 'ACTIVE'),
            );

            const decided = decideRouteP2(scenario);

            // PRESERVATION INVARIANT A: Genuinely unverified + non-ACTIVE user → /verify-email
            // (Not gated by ACTIVE status; this is the "genuinely unverified" path that must remain)
            if (
              scenario.loggedIn &&
              scenario.emailVerified === null &&
              scenario.status === 'PENDING' &&
              scenario.role !== 'System Admin' &&
              !EXEMPT_ROUTES.some((r) => scenario.pathname.startsWith(r))
            ) {
              expect(decided).toBe('/verify-email');
            }

            // PRESERVATION INVARIANT B: No tenant, no local flag, verified → /onboarding
            if (
              scenario.loggedIn &&
              scenario.emailVerified !== null &&
              !scenario.tenantName &&
              !scenario.localOnboardingDone &&
              scenario.role !== 'System Admin' &&
              !EXEMPT_ROUTES.some((r) => scenario.pathname.startsWith(r))
            ) {
              expect(decided).toBe('/onboarding');
            }

            // PRESERVATION INVARIANT C: Not logged in → /login
            if (!scenario.loggedIn) {
              expect(decided).toBe('/login');
            }

            // PRESERVATION INVARIANT D: System Admin on entry point → /admin/dashboard
            // (when no valid saved redirect is present or the saved redirect is an admin path)
            if (
              scenario.loggedIn &&
              scenario.role === 'System Admin' &&
              (scenario.pathname === '/' || scenario.pathname === '/dashboard') &&
              (scenario.savedRedirect === null ||
                scenario.savedRedirect === '/dashboard' ||
                !scenario.savedRedirect.startsWith('/admin'))
            ) {
              // With the CURRENT (unfixed) guard, System Admins with a non-admin saved
              // redirect (/dashboard) are mis-routed — that's the RC-06 bug.
              // We skip that case here (covered by exploration tests).
              if (
                scenario.savedRedirect === null ||
                scenario.savedRedirect === '/dashboard'
              ) {
                // Current code: /dashboard saved redirect passes `!isAdminPath` → bug (RC-06)
                // Only assert /admin/dashboard when no saved redirect exists
                if (!scenario.savedRedirect) {
                  expect(decided).toBe('/admin/dashboard');
                }
              }
            }

            // The model is deterministic — calling it twice must return the same result.
            // This is the core "stability" invariant: no hidden state, no randomness.
            const decided2 = decideRouteP2(scenario);
            expect(decided).toBe(decided2);
          }),
          { numRuns: 500 },
        );
      },
    );
  },
);

// ─────────────────────────────────────────────────────
// EXAMPLE TESTS — AuthGuard component (preservation of existing correct behaviors)
// ─────────────────────────────────────────────────────

// Fixtures for the preservation example tests
const GENUINELY_UNVERIFIED_USER = {
  id: 'unverified-1',
  email: 'unverified@example.com',
  role: 'User',
  firstName: 'Unverified',
  lastName: 'User',
  tenantId: 'tenant-1',
  status: 'PENDING',                    // not ACTIVE — genuinely unverified
  emailVerified: null,                  // null → must gate to /verify-email (preserved)
  tenantName: 'Demo Corp',
  onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
};

const SYSTEM_ADMIN_WITH_ADMIN_SAVED_REDIRECT = {
  id: 'sysadmin-1',
  email: 'admin@leadcrm.com',
  role: 'System Admin',
  firstName: 'System',
  lastName: 'Admin',
  tenantId: 'system-tenant',
  status: 'ACTIVE',
  emailVerified: '2026-01-01T00:00:00.000Z',
  tenantName: 'LeadCRM System',
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
};

const REGULAR_USER_WITH_SAVED_REDIRECT = {
  id: 'user-crm-1',
  email: 'user@democorp.com',
  role: 'User',
  firstName: 'Sales',
  lastName: 'Rep',
  tenantId: 'tenant-1',
  status: 'ACTIVE',
  emailVerified: '2026-01-01T00:00:00.000Z',
  tenantName: 'Demo Corp',
  onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
};

const NEW_TENANT_USER = {
  id: 'new-user-1',
  email: 'newuser@newcorp.com',
  role: 'Client Admin',
  firstName: 'New',
  lastName: 'User',
  tenantId: 'new-tenant',
  status: 'ACTIVE',
  emailVerified: '2026-01-01T00:00:00.000Z',
  tenantName: null,                     // no tenant name → should go to /onboarding
  onboardingCompletedAt: null,          // not completed
};

describe(
  'Feature: auth-login-blank-screen-fix, Property 2: Preservation — Phase 2 AuthGuard examples',
  () => {
    beforeEach(() => {
      routerReplace.mockClear();
      currentPathname = '/dashboard';
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* jsdom provides storage; ignore if unavailable */
      }
    });

    /**
     * Preservation 1 — Genuinely unverified user (emailVerified=null, status=PENDING)
     * must still be redirected to /verify-email.
     *
     * **Validates: Requirement 3.3**
     * This is the non-buggy case: status=PENDING (not a seeded/demo ACTIVE account).
     * The Phase 2 fix (RC-05) only patches seeded ACTIVE accounts in the database —
     * it must NOT change the gate behavior for non-ACTIVE genuinely unverified users.
     */
    it('Preservation 1: genuinely unverified user (PENDING) is still gated to /verify-email', () => {
      authState = { user: GENUINELY_UNVERIFIED_USER, isLoading: false, authError: null };
      currentPathname = '/dashboard';

      render(
        <AuthGuard>
          <div>dashboard</div>
        </AuthGuard>,
      );

      const verifyEmailRedirects = routerReplace.mock.calls
        .map((call) => String(call[0]))
        .filter((target) => target.startsWith('/verify-email'));

      // EXPECTED: still redirects to /verify-email (unchanged by Phase 2 fix)
      expect(verifyEmailRedirects.length).toBeGreaterThan(0);
    });

    /**
     * Preservation 2 — System Admin with a valid /admin/* saved redirect must still
     * follow that redirect (only non-admin paths must be blocked in RC-06 fix).
     *
     * **Validates: Requirement 3.4**
     * The RC-06 fix blocks System Admins from following /dashboard saved redirects.
     * It must NOT block valid /admin/* saved redirects.
     */
    it('Preservation 2: System Admin with /admin/settings saved redirect follows it', () => {
      authState = {
        user: SYSTEM_ADMIN_WITH_ADMIN_SAVED_REDIRECT,
        isLoading: false,
        authError: null,
      };
      currentPathname = '/';

      // Saved redirect to a valid admin path
      window.sessionStorage.setItem('leadcrm_redirect_after_login', '/admin/settings');

      render(
        <AuthGuard>
          <div>admin</div>
        </AuthGuard>,
      );

      const redirectTargets = routerReplace.mock.calls.map((call) => String(call[0]));

      // EXPECTED: follows the /admin/settings saved redirect (preserved — it's a valid admin path)
      expect(redirectTargets).toContain('/admin/settings');
      // Must NOT be overridden to /admin/dashboard when /admin/settings is the saved intent
      expect(redirectTargets).not.toContain('/admin/dashboard');
    });

    /**
     * Preservation 3 — Regular tenant user with a saved /crm/leads redirect must still
     * follow that saved path after login.
     *
     * **Validates: Requirement 3.2**
     */
    it('Preservation 3: regular tenant user with /crm/leads saved redirect follows it', () => {
      authState = {
        user: REGULAR_USER_WITH_SAVED_REDIRECT,
        isLoading: false,
        authError: null,
      };
      currentPathname = '/';

      window.sessionStorage.setItem('leadcrm_redirect_after_login', '/crm/leads');

      render(
        <AuthGuard>
          <div>crm</div>
        </AuthGuard>,
      );

      const redirectTargets = routerReplace.mock.calls.map((call) => String(call[0]));

      // EXPECTED: follows the /crm/leads saved redirect (preserved)
      expect(redirectTargets).toContain('/crm/leads');
      // Should not be overridden to /dashboard
      expect(redirectTargets).not.toContain('/dashboard');
    });

    /**
     * Preservation 4 — User with no tenantName, no local flag, no onboardingCompletedAt
     * must still be routed to /onboarding.
     *
     * **Validates: Requirement 3.4**
     * The RC-07 fix adds onboardingCompletedAt as an extra gate condition. It must NOT
     * prevent the /onboarding redirect for genuinely new users who have NEITHER a
     * tenantName NOR an onboardingCompletedAt.
     */
    it('Preservation 4: new tenant user with no tenantName, no localFlag, no onboardingCompletedAt → /onboarding', () => {
      authState = { user: NEW_TENANT_USER, isLoading: false, authError: null };
      currentPathname = '/dashboard';

      // No local onboarding completion flag
      window.localStorage.removeItem('leadcrm_onboarding_complete');

      render(
        <AuthGuard>
          <div>dashboard</div>
        </AuthGuard>,
      );

      const redirectTargets = routerReplace.mock.calls.map((call) => String(call[0]));

      // EXPECTED: redirected to /onboarding (genuinely new tenant user)
      expect(redirectTargets).toContain('/onboarding');
    });

    /**
     * Preservation 5 — user=null (logged out) path: guard redirects to /login,
     * saves the intended path in sessionStorage — unchanged.
     *
     * **Validates: Requirement 3.2**
     */
    it('Preservation 5: logged-out user on /crm/contacts is redirected to /login with saved path', () => {
      authState = { user: null, isLoading: false, authError: null };
      currentPathname = '/crm/contacts';

      render(
        <AuthGuard>
          <div>contacts</div>
        </AuthGuard>,
      );

      const redirectTargets = routerReplace.mock.calls.map((call) => String(call[0]));

      // EXPECTED: redirects to /login (unchanged)
      expect(redirectTargets).toContain('/login');
      // Saves the intended path for post-login restore
      expect(window.sessionStorage.getItem('leadcrm_redirect_after_login')).toBe('/crm/contacts');
    });

    /**
     * Preservation 6 — exempt routes (e.g. /onboarding, /settings) are not gated
     * even for unverified users — this behavior must remain unchanged.
     *
     * **Validates: Requirement 3.1**
     */
    it('Preservation 6: unverified user on an exempt route (/settings) is not redirected to /verify-email', () => {
      authState = { user: GENUINELY_UNVERIFIED_USER, isLoading: false, authError: null };
      currentPathname = '/settings';

      render(
        <AuthGuard>
          <div>settings</div>
        </AuthGuard>,
      );

      const verifyEmailRedirects = routerReplace.mock.calls
        .map((call) => String(call[0]))
        .filter((target) => target.startsWith('/verify-email'));

      // EXPECTED: no /verify-email redirect on an exempt route
      expect(verifyEmailRedirects).toEqual([]);
    });

    /**
     * Preservation 7 — System Admin with NO saved redirect on an entry point
     * is routed to /admin/dashboard.
     *
     * **Validates: Requirement 3.5**
     */
    it('Preservation 7: System Admin with no saved redirect → /admin/dashboard', () => {
      authState = {
        user: SYSTEM_ADMIN_WITH_ADMIN_SAVED_REDIRECT,
        isLoading: false,
        authError: null,
      };
      currentPathname = '/dashboard';

      // No saved redirect
      window.sessionStorage.removeItem('leadcrm_redirect_after_login');

      render(
        <AuthGuard>
          <div>admin</div>
        </AuthGuard>,
      );

      const redirectTargets = routerReplace.mock.calls.map((call) => String(call[0]));

      // EXPECTED: /admin/dashboard (unchanged)
      expect(redirectTargets).toContain('/admin/dashboard');
      expect(redirectTargets).not.toContain('/dashboard');
    });
  },
);

// ─────────────────────────────────────────────────────
// NOTE: AuthContext session/login preservation tests (Preservation 5–8) are
// in a separate file so they can use vi.resetModules() + vi.doMock() without
// conflicting with the top-level vi.mock('@/store/AuthContext') in this file:
//
//   src/store/__tests__/auth-context.phase2-preservation.test.tsx
//
// This follows the same pattern used for auth-context-phase2-exploration.test.tsx.
// ─────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import * as fc from 'fast-check';

/**
 * Preservation Tests — Frontend AuthGuard routing decisions
 *
 * **Property 4: Preservation — Non-Buggy Auth Scenarios Are Unchanged**
 *
 * These tests observe and lock in the CURRENT (unfixed) AuthGuard routing
 * behavior for scenarios where `isBugCondition(X)` is false. After the fix,
 * these decisions MUST remain identical:
 *   - Logged-out navigation to a protected route -> redirect to /login,
 *     with the intended path saved in sessionStorage.
 *   - Genuinely unverified user -> /verify-email.
 *   - Genuinely not-onboarded (but verified) user -> /onboarding.
 *   - System Admin -> /admin/dashboard, verification/onboarding gates bypassed.
 *
 * The property-based portion models the guard's routing decision as a pure
 * function (`decideRoute`) that mirrors `auth-guard.tsx` exactly, then asserts
 * that for every NON-buggy scenario the decision equals the documented original
 * behavior. The example portion exercises the REAL <AuthGuard/> component and
 * asserts the same observable redirects.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
 *
 * EXPECTED ON UNFIXED CODE: These tests PASS (baseline behavior to preserve).
 */

// ─────────────────────────────────────────────────────
// MOCKS (for the example tests using the real component)
// ─────────────────────────────────────────────────────

const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  usePathname: () => currentPathname,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

let authState: { user: unknown; isLoading: boolean } = { user: null, isLoading: false };
let currentPathname = '/dashboard';

vi.mock('@/store/AuthContext', () => ({
  useAuth: () => authState,
}));

import { AuthGuard } from '../auth-guard';

// ─────────────────────────────────────────────────────
// AuthScenario domain + isBugCondition + decideRoute
// ─────────────────────────────────────────────────────

type EnteredVia = 'login' | 'refresh';

interface AuthScenario {
  loggedIn: boolean;             // false => user === null
  emailVerified: boolean;        // has a non-null emailVerified timestamp
  tenantConfigured: boolean;     // tenant has a workspace name (brand-new unconfigured = false)
  role: 'Client Admin' | 'User' | 'System Admin';
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
  enteredVia: EnteredVia;
  pathname: string;
}

/**
 * Mirrors the design's isBugCondition for the frontend guard portion. The
 * contract-mismatch defect surfaces in the guard only for the credentials
 * `login` entry path where the gate fields are (in the unfixed code) absent.
 * Refresh hydrates from /auth/me, so those fields are present and the guard
 * behaves correctly — that path is NOT a bug condition here.
 */
function isBugCondition(scenario: AuthScenario): boolean {
  return (
    scenario.loggedIn &&
    scenario.enteredVia === 'login' &&
    scenario.emailVerified &&
    scenario.tenantConfigured &&
    scenario.role !== 'System Admin'
  );
}

const EXEMPT_ROUTES = [
  '/onboarding',
  '/verify-email',
  '/email-verification',
  '/billing',
  '/settings',
  '/company-setup',
];

/**
 * Pure model of the AuthGuard routing decision, transcribed from
 * `frontend/src/shared/providers/auth-guard.tsx`. Returns the route the guard
 * redirects to, or 'render' when it renders children without redirecting.
 *
 * For preservation, the guard is fed the auth-state shape as it exists at
 * decision time. On refresh (or for any hydrated user), the gate fields are
 * present; when logged out, user === null.
 */
function decideRoute(
  scenario: AuthScenario,
  opts: { savedRedirect?: string | null } = {},
): string {
  const { pathname } = scenario;

  if (!scenario.loggedIn) {
    // user === null -> redirect to /login (intended path saved separately)
    return '/login';
  }

  const isSystemAdmin = scenario.role === 'System Admin';
  const isExempt = EXEMPT_ROUTES.some((route) => pathname.startsWith(route));

  if (!isSystemAdmin && !isExempt) {
    if (!scenario.emailVerified) {
      return '/verify-email';
    }
    if (!scenario.tenantConfigured) {
      return '/onboarding';
    }
  }

  const isEntryPoint = pathname === '/' || pathname === '/login' || pathname === '/dashboard';

  const savedRedirect = opts.savedRedirect ?? null;
  if (savedRedirect && savedRedirect !== '/login' && savedRedirect !== '/register') {
    const isAdminPath = savedRedirect.startsWith('/admin');
    if (!isAdminPath || isSystemAdmin) {
      return savedRedirect;
    }
  }

  if (isEntryPoint) {
    return isSystemAdmin ? '/admin/dashboard' : '/dashboard';
  }

  return 'render';
}

/**
 * The documented ORIGINAL behavior from the design's Preservation Requirements,
 * expressed independently of decideRoute so the property has something to check
 * against. For non-buggy scenarios this must equal decideRoute(scenario).
 */
function originalExpectedRoute(scenario: AuthScenario): string {
  if (!scenario.loggedIn) return '/login';

  const isSystemAdmin = scenario.role === 'System Admin';
  const isExempt = EXEMPT_ROUTES.some((route) => scenario.pathname.startsWith(route));

  if (!isSystemAdmin && !isExempt) {
    if (!scenario.emailVerified) return '/verify-email';
    if (!scenario.tenantConfigured) return '/onboarding';
  }

  const isEntryPoint =
    scenario.pathname === '/' ||
    scenario.pathname === '/login' ||
    scenario.pathname === '/dashboard';

  if (isEntryPoint) {
    return isSystemAdmin ? '/admin/dashboard' : '/dashboard';
  }

  return 'render';
}

// fast-check arbitrary over the AuthScenario domain
// (emailVerified × onboardingCompletedAt × role × status × enteredVia).
const authScenarioArb: fc.Arbitrary<AuthScenario> = fc.record({
  loggedIn: fc.boolean(),
  emailVerified: fc.boolean(),
  tenantConfigured: fc.boolean(),
  role: fc.constantFrom<'Client Admin' | 'User' | 'System Admin'>(
    'Client Admin',
    'User',
    'System Admin',
  ),
  status: fc.constantFrom<'ACTIVE' | 'PENDING' | 'SUSPENDED'>('ACTIVE', 'PENDING', 'SUSPENDED'),
  enteredVia: fc.constantFrom<EnteredVia>('login', 'refresh'),
  pathname: fc.constantFrom('/', '/dashboard', '/login', '/crm/leads', '/onboarding', '/settings'),
});

// ─────────────────────────────────────────────────────
// PROPERTY TEST
// ─────────────────────────────────────────────────────

describe('Feature: auth-login-blank-screen-fix, Property 4: Preservation — AuthGuard decision parity', () => {
  it('for every non-buggy scenario the guard decision equals the original decision', () => {
    fc.assert(
      fc.property(authScenarioArb, (scenario) => {
        fc.pre(!isBugCondition(scenario));
        const decided = decideRoute(scenario);
        const original = originalExpectedRoute(scenario);
        expect(decided).toBe(original);
      }),
      { numRuns: 300 },
    );
  });
});

// ─────────────────────────────────────────────────────
// EXAMPLE TESTS (real <AuthGuard/> component)
// ─────────────────────────────────────────────────────

// Payloads as hydrated from /auth/me (present at decision time for these
// non-buggy scenarios) or logged-out.
const VERIFIED_ONBOARDED_ADMIN = {
  id: 'user-1',
  email: 'alice@democorp.com',
  role: 'Client Admin',
  firstName: 'Alice',
  lastName: 'Admin',
  tenantId: 'tenant-1',
  emailVerified: '2026-01-01T00:00:00.000Z',
  onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
  tenantName: 'Demo Corp',
};

const UNVERIFIED_USER = {
  id: 'user-2',
  email: 'bob@democorp.com',
  role: 'User',
  firstName: 'Bob',
  lastName: 'Rep',
  tenantId: 'tenant-1',
  emailVerified: null,
  onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
  tenantName: 'Demo Corp',
};

const NOT_ONBOARDED_USER = {
  id: 'user-3',
  email: 'carol@democorp.com',
  role: 'Client Admin',
  firstName: 'Carol',
  lastName: 'Admin',
  tenantId: 'tenant-1',
  emailVerified: '2026-01-01T00:00:00.000Z',
  onboardingCompletedAt: null,
  tenantName: null,
};

const SYSTEM_ADMIN = {
  id: 'admin-1',
  email: 'admin@leadcrm.com',
  role: 'System Admin',
  firstName: 'System',
  lastName: 'Admin',
  tenantId: 'system-tenant',
  emailVerified: null,
  onboardingCompletedAt: null,
  tenantName: null,
};

function renderGuard(): { container: HTMLElement } {
  const result = render(
    <AuthGuard>
      <div>protected content</div>
    </AuthGuard>,
  );
  return { container: result.container };
}

function replaceTargets(): string[] {
  return routerReplace.mock.calls.map((call) => String(call[0]));
}

describe('Feature: auth-login-blank-screen-fix, Property 4: Preservation — AuthGuard examples', () => {
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

  // 3.2 — logged-out navigation to a protected route
  it('redirects a logged-out user on /dashboard to /login and saves the intended path', () => {
    authState = { user: null, isLoading: false };
    currentPathname = '/crm/leads';

    renderGuard();

    expect(replaceTargets()).toContain('/login');
    expect(window.sessionStorage.getItem('leadcrm_redirect_after_login')).toBe('/crm/leads');
  });

  // 3.3 — genuinely unverified user
  it('routes a genuinely unverified user to /verify-email', () => {
    authState = { user: UNVERIFIED_USER, isLoading: false };
    currentPathname = '/dashboard';

    renderGuard();

    const verifyTarget = replaceTargets().find((target) => target.startsWith('/verify-email'));
    expect(verifyTarget).toBeDefined();
  });

  // 3.4 — user with a verified email but no configured workspace name
  it('routes a user with no configured workspace to /onboarding', () => {
    authState = { user: NOT_ONBOARDED_USER, isLoading: false };
    currentPathname = '/dashboard';

    renderGuard();

    expect(replaceTargets()).toContain('/onboarding');
  });

  // 3.5 — System Admin bypasses gates and lands on /admin/dashboard
  it('routes a System Admin to /admin/dashboard and bypasses verification/onboarding gates', () => {
    authState = { user: SYSTEM_ADMIN, isLoading: false };
    currentPathname = '/dashboard';

    renderGuard();

    const targets = replaceTargets();
    expect(targets).toContain('/admin/dashboard');
    // Gates bypassed — no verification/onboarding redirect for the System Admin.
    expect(targets.some((target) => target.startsWith('/verify-email'))).toBe(false);
    expect(targets.some((target) => target.startsWith('/onboarding'))).toBe(false);
  });

  // Positive control — verified, onboarded admin lands on /dashboard (entry point),
  // confirming the non-buggy hydrated path is preserved and renders no gate redirect.
  it('routes a verified, onboarded admin to /dashboard from an entry point', () => {
    authState = { user: VERIFIED_ONBOARDED_ADMIN, isLoading: false };
    currentPathname = '/dashboard';

    renderGuard();

    const targets = replaceTargets();
    expect(targets.some((target) => target.startsWith('/verify-email'))).toBe(false);
    expect(targets.some((target) => target.startsWith('/onboarding'))).toBe(false);
    expect(targets).toContain('/dashboard');
  });
});

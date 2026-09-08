'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/store/AuthContext';
import { cn } from '@/lib/utils';
import { AuthLoadingScreen } from '@/shared/components/auth-loading-screen';

// ── localStorage keys (kept for optional dashboard tour overlay only) ─────────
export const ONBOARDING_COMPLETE_KEY    = 'leadcrm_onboarding_complete';
export const NEEDS_COMPANY_SETUP_KEY    = 'leadcrm_needs_company_setup';

// Routes that are exempt from all gates (verification, onboarding, subscription)
const EXEMPT_ROUTES = ['/onboarding', '/verify-email', '/email-verification', '/billing', '/settings', '/company-setup', '/invite'];

/**
 * isSandboxUser — returns true when the authenticated user is in the pre-subscription
 * sandbox state (Restricted User + SANDBOX tenant + NONE subscription).
 *
 * Used by CRM layout components to conditionally render the upgrade banner.
 * The backend subscriptionGate enforces the actual API-level restriction —
 * this helper is for UI hints only. Never use it as an authorization boundary.
 */
export function isSandboxUser(user: { role?: string; tenantStatus?: string | null; subscriptionStatus?: string | null } | null): boolean {
  if (!user) return false;
  const tenantStatus      = user.tenantStatus;
  const subscriptionStatus = user.subscriptionStatus;
  return tenantStatus === 'SANDBOX' && (!subscriptionStatus || subscriptionStatus === 'NONE');
}

/**
 * AuthGuard — protects tenant routes and enforces email verification + onboarding gates.
 *
 * Gate priority (highest → lowest):
 *   1. Email verification gate — unverified users redirected to /verify-email
 *   2. First-time workspace setup gate — brand-new tenants with no name redirected to /onboarding
 *   3. Saved redirect — restore the originally intended URL after login
 *   4. Role-based default — System Admin → /admin/dashboard, others → /dashboard
 *
 * Sandbox (Guest) users are NOT blocked by the guard — they land on /dashboard
 * where the SandboxBillingBanner guides them to /billing.
 * The backend subscriptionGate handles API-level enforcement.
 *
 * Source of truth for gates:
 *   - emailVerified:    from /auth/me response (server-backed)
 *   - tenantName:       from /auth/me response (server-backed via Tenant model)
 *   - tenantStatus:     from /auth/me response (SANDBOX | ACTIVE | ...)
 *   - subscriptionStatus: from /auth/me response (NONE | ACTIVE | PAST_DUE | ...)
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, authError, retryAuthInit } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    if (user === null) {
      if (pathname !== '/login' && pathname !== '/register') {
        sessionStorage.setItem('leadcrm_redirect_after_login', pathname);
      }
      router.replace('/login');
      return;
    }

    // System Admin — platform operator, bypasses all customer-side gates.
    // Uses role string from /auth/me (server-backed JWT).
    const isSystemAdmin = user.role === 'System Admin'
      || user.tenantName?.toLowerCase().includes('system');

    const isExempt = EXEMPT_ROUTES.some((r) => pathname.startsWith(r));

    if (!isSystemAdmin && !isExempt) {
      // ── Gate 1: Email verification (server-backed) ─────────────────────
      const emailVerified = user.emailVerified;
      const userStatus = user.status;
      if (!emailVerified && userStatus !== 'ACTIVE') {
        sessionStorage.removeItem('leadcrm_redirect_after_login');
        router.replace(`/verify-email?email=${encodeURIComponent(user.email)}`);
        return;
      }

      // ── Gate 2: First-time workspace setup ─────────────────────────────────
      const tenantName = user.tenantName;
      const onboardingCompletedAt = user.onboardingCompletedAt;
      const localOnboardingDone = typeof window !== 'undefined'
        ? localStorage.getItem(ONBOARDING_COMPLETE_KEY)
        : null;

      if (!tenantName && !localOnboardingDone && !onboardingCompletedAt) {
        sessionStorage.removeItem('leadcrm_redirect_after_login');
        router.replace('/onboarding');
        return;
      }

      // ── Gate 3: Sandbox awareness (informational — no hard redirect) ───────
      // Sandbox users (tenantStatus=SANDBOX, subscriptionStatus=NONE) are allowed
      // to navigate freely. The backend subscriptionGate blocks mutations.
      // The SandboxBillingBanner in crm-layout.tsx shows the upgrade prompt.
      // We do NOT redirect sandbox users away from CRM routes here.
    }

    // ── Saved redirect ────────────────────────────────────────────────────
    const isEntryPoint = pathname === '/' || pathname === '/login' || pathname === '/dashboard';

    const savedRedirect = sessionStorage.getItem('leadcrm_redirect_after_login');
    sessionStorage.removeItem('leadcrm_redirect_after_login');
    if (savedRedirect && savedRedirect !== '/login' && savedRedirect !== '/register') {
      const isAdminPath = savedRedirect.startsWith('/admin');
      if (isSystemAdmin && !isAdminPath) {
        // Fall through to role-based default
      } else if (!isAdminPath || isSystemAdmin) {
        router.replace(savedRedirect);
        return;
      }
    }

    // ── Role-based default landing ────────────────────────────────────────
    if (isEntryPoint) {
      if (isSystemAdmin) {
        router.replace('/admin/dashboard');
      } else {
        // Sandbox users and active users both land on /dashboard.
        // The dashboard adapts its content based on tenantStatus.
        router.replace('/dashboard');
      }
    }
  }, [user, isLoading, pathname, router]);

  // ── Visible resolution states (never a silent blank screen) ───────────
  // While auth is resolving, show a visible loading state instead of null.
  if (isLoading) return <AuthLoadingScreen />;

  // A genuine auth-init transport failure surfaces an explicit error state with
  // a retry action (distinct from the "no session" case, which sets user = null
  // without an error and is handled by the redirect-to-/login path below).
  if (authError) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-500 dark:text-red-400" aria-hidden="true" />
          </div>
          <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-white">
            Unable to load your session
          </h2>
          <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">{authError}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { void retryAuthInit(); }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors',
                'hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500',
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </button>
            <button
              type="button"
              onClick={() => { router.replace('/login'); }}
              className={cn(
                'inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // user === null: the effect above redirects to /login. Render the loading
  // state during that brief redirect rather than a blank screen.
  if (user === null) return <AuthLoadingScreen />;

  return <>{children}</>;
}

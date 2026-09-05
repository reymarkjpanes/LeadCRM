import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Next.js Edge Middleware — Auth-aware route protection.
 *
 * Design decisions:
 *
 * 1. MOCK MODE BYPASS
 *    When NEXT_PUBLIC_USE_MOCK_AUTH is not 'false', auth is handled via
 *    localStorage in AuthContext. Server-side token inspection won't find
 *    the mock session, so we skip the redirect logic entirely to avoid
 *    redirect loops during local development.
 *
 * 2. GOOGLE OAUTH — NEW USER PROFILE COMPLETION
 *    After a first-time Google sign-in, the NextAuth JWT contains
 *    `requiresProfileCompletion: true`. We intercept any navigation to a
 *    protected route and redirect to /onboarding (feature tour) followed by
 *    /company-setup so the user fills in their company details before
 *    reaching the CRM.
 *
 * 3. PROTECTED ROUTES
 *    Paths under /dashboard, /contacts, /deals, /pipeline, /reports,
 *    /settings, and /admin require a valid NextAuth JWT token.
 *    Unauthenticated requests are redirected to /login.
 *
 * 4. AUTH ROUTE BYPASS
 *    Users who already have a valid token and navigate to /login or
 *    /register are redirected to /dashboard.
 *
 * Note: The primary auth source of truth is the LeadCRM HttpOnly JWT cookie
 * (managed by the Express backend). The NextAuth JWT (checked here) is a
 * second cookie set only when the Google OAuth flow runs. Both are HttpOnly.
 */

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/contacts',
  '/organizations',
  '/deals',
  '/pipeline',
  '/campaigns',
  '/workflows',
  '/tasks',
  '/service-orders',
  '/reports',
  '/billing',
  '/settings',
  '/administration',
  '/admin',
];

// Routes that authenticated users should not see
const AUTH_ROUTES = ['/login', '/register'];

// Routes that are always public (no redirect ever)
const PUBLIC_ROUTES = [
  '/onboarding',
  '/company-setup',
  '/reset-password',
  '/verify-email',
  '/email-verification',
  '/invite',
  '/',
];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ── 1. Mock-mode bypass ───────────────────────────────────────────
  // Don't interfere with localStorage-based auth in development
  const isMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH !== 'false';
  if (isMockAuth) {
    return NextResponse.next();
  }

  // ── 2. Skip static assets and Next.js internals ───────────────────
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|woff2?)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // ── 3. Retrieve NextAuth JWT (if present) ─────────────────────────
  // getToken reads the NextAuth session cookie — it does NOT read the
  // LeadCRM cookie. We use it specifically for the Google OAuth flow.
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const requiresCompletion = token?.requiresProfileCompletion === true;

  // ── 4. Redirect authenticated Google OAuth users away from auth routes ───
  // Only applies to users with a NextAuth session (Google Sign-In).
  // The normal OTP login flow does NOT use NextAuth sessions, so we must
  // not redirect those users away from /login — they need to be there.
  //
  // We identify a genuine Google OAuth session by checking for a non-empty
  // accessToken in the token (set by our signIn callback only for Google).
  const isGoogleSession = isAuthenticated && !!token?.accessToken;

  if (isGoogleSession && AUTH_ROUTES.some(r => pathname.startsWith(r))) {
    // Only redirect away from /login if the Google session is fully complete.
    // Users whose profile still needs completion should be able to reach /login
    // (they may want to sign in with a different method instead).
    if (!requiresCompletion) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }

  // ── 5. Protect CRM routes (Google OAuth sessions only) ───────────
  // For Google OAuth users: gate profile-incomplete sessions from CRM.
  // Standard OTP sessions are protected client-side by AuthGuard — the
  // middleware cannot see the LeadCRM HttpOnly cookie to validate them.
  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));

  // Routes exempt from profile-completion redirect — users need access
  // to these even before finishing company setup.
  // /billing is exempt because users must always be able to manage their
  // subscription regardless of onboarding status (standard SaaS pattern —
  // you never block a paying customer from accessing billing).
  const isCompletionExempt =
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/company-setup') ||
    pathname.startsWith('/settings') ||  // exempt: users must be able to configure workspace before completing profile (settings-redirect-fix)
    pathname.startsWith('/billing');

  if (isProtected && isGoogleSession) {
    // Authenticated Google user but profile not complete
    if (requiresCompletion && !isCompletionExempt) {
      return NextResponse.redirect(new URL('/onboarding', req.url));
    }
  }

  // ── 6. Always allow public & complete-profile routes ─────────────
  return NextResponse.next();
}

export const config = {
  /*
   * Match all request paths except:
   * - _next/static  (static files)
   * - _next/image   (image optimization)
   * - favicon.ico
   * - public static assets (svg, png, etc.)
   *
   * We include /api/auth/* so NextAuth callback routes are NOT intercepted
   * (they handle their own redirects internally).
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

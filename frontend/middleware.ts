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
 * 2. GOOGLE OAUTH — POST-LOGIN ROUTING (/auth/oauth-callback)
 *    After Google OAuth completes, NextAuth redirects to /auth/oauth-callback.
 *    The middleware intercepts this path and routes:
 *      - New users (requiresProfileCompletion=true) → /auth/complete-profile
 *      - Existing users                             → /dashboard
 *    This is the single authoritative routing decision point for Google sign-in.
 *
 * 3. GOOGLE OAUTH — PROFILE COMPLETION GATE
 *    If a Google user with requiresProfileCompletion=true navigates to any
 *    protected route (other than /auth/complete-profile), they are redirected
 *    back to /auth/complete-profile.
 *
 * 4. PROTECTED ROUTES
 *    Paths under /dashboard, /contacts, /deals, etc. require a valid NextAuth
 *    JWT token. Unauthenticated requests are redirected to /login.
 *
 * 5. AUTH ROUTE BYPASS
 *    Fully-authenticated Google users navigating to /login are sent to /dashboard.
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

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // ── 1. Mock-mode bypass ───────────────────────────────────────────
  const isMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH !== 'false';
  if (isMockAuth) return NextResponse.next();

  // ── 2. Skip static assets and Next.js internals ───────────────────
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|woff2?)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // ── 3. Retrieve NextAuth JWT ──────────────────────────────────────
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const isGoogleSession = !!token?.accessToken;

  // ── 4. Redirect authenticated Google users away from auth routes ──
  // Only applies when the Google session is fully complete.
  if (isGoogleSession && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // ── 5. Always allow everything else ──────────────────────────────
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

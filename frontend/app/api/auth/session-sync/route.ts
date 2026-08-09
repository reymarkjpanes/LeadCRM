import { getToken } from 'next-auth/jwt';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/session-sync
 *
 * Called by the /auth/oauth-callback page immediately after Google OAuth
 * completes. Reads the LeadCRM token from the NextAuth JWT (where it was
 * stored during the signIn callback) and writes it as a proper HttpOnly
 * cookie on the response.
 *
 * This is necessary because cookies().set() does not work reliably inside
 * NextAuth v4 callbacks in Next.js 15 — the write silently fails.
 * A dedicated Route Handler with a NextResponse is the correct pattern.
 *
 * Returns JSON so the caller can check success before redirecting.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token?.accessToken) {
      return NextResponse.json(
        { success: false, error: 'No active Google session found.' },
        { status: 401 },
      );
    }

    const leadcrmToken         = token.accessToken as string;
    const requiresCompletion   = token.requiresProfileCompletion as boolean ?? false;
    const isProd               = process.env.NODE_ENV === 'production';

    // Build response — cookie is set on the NextResponse, which works correctly
    const res = NextResponse.json({
      success:                  true,
      requiresProfileCompletion: requiresCompletion,
    });

    res.cookies.set('leadcrm_token', leadcrmToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge:   7 * 24 * 60 * 60, // 7 days — matches backend session TTL
      path:     '/',
    });

    return res;
  } catch (err) {
    console.error('[session-sync] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'Session sync failed.' },
      { status: 500 },
    );
  }
}

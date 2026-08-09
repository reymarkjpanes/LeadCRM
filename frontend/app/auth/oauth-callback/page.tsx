'use client';

import { useEffect, useState } from 'react';

/**
 * /auth/oauth-callback
 *
 * Landing page after Google OAuth completes.
 *
 * What happens here:
 * 1. Calls /api/auth/session-sync — reads the LeadCRM token from the
 *    NextAuth JWT and writes it as a proper HttpOnly cookie.
 * 2. Once the cookie is set, redirects to the correct destination:
 *    - requiresProfileCompletion=true  → /auth/complete-profile  (new users)
 *    - requiresProfileCompletion=false → /dashboard               (existing users)
 *
 * Why we do this client-side rather than in middleware:
 * The cookie must be set BEFORE /auth/me is called. Setting it in a
 * client-side fetch ensures the Set-Cookie header is applied to the
 * browser before any subsequent navigation occurs.
 */
export default function OAuthCallbackPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function syncAndRedirect() {
      try {
        const res = await fetch('/api/auth/session-sync', {
          method:      'GET',
          credentials: 'include',
          cache:       'no-store',
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? 'Session sync failed');
        }

        const data = await res.json() as {
          success:                   boolean;
          requiresProfileCompletion: boolean;
        };

        if (cancelled) return;

        if (data.requiresProfileCompletion) {
          // New user — hard navigate so AuthContext mounts fresh with the new cookie
          window.location.replace('/auth/complete-profile');
        } else {
          // Existing user — hard navigate to dashboard
          window.location.replace('/dashboard');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
        }
      }
    }

    syncAndRedirect();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-red-500 text-sm text-center max-w-sm">{error}</p>
        <a
          href="/login"
          className="text-sm text-blue-500 hover:underline"
        >
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center">
      <div
        className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"
        aria-label="Completing sign-in…"
        role="status"
      />
    </div>
  );
}

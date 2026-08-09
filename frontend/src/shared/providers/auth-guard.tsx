'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';

/**
 * AuthGuard — redirects to /login if the user is not authenticated.
 * After login, redirects back to the originally intended URL.
 * System Admin → /admin/dashboard, all others → /dashboard.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;

    if (user === null) {
      // Store the intended path so we can redirect back after login.
      // Exclude OAuth-flow paths to prevent redirect loops.
      const isOAuthPath = pathname.startsWith('/auth/');
      if (!isOAuthPath && pathname !== '/login' && pathname !== '/register') {
        sessionStorage.setItem('leadcrm_redirect_after_login', pathname);
      }
      router.replace('/login');
      return;
    }

    // Authenticated — check for a saved redirect target
    const savedRedirect = sessionStorage.getItem('leadcrm_redirect_after_login');
    if (
      savedRedirect &&
      savedRedirect !== '/login' &&
      savedRedirect !== '/register' &&
      !savedRedirect.startsWith('/auth/')   // never redirect back to OAuth flow paths
    ) {
      sessionStorage.removeItem('leadcrm_redirect_after_login');
      router.replace(savedRedirect);
      return;
    }
    // Clear stale OAuth-path redirects silently
    if (savedRedirect?.startsWith('/auth/')) {
      sessionStorage.removeItem('leadcrm_redirect_after_login');
    }

    // Role-based default landing: only redirect from root or login page
    if (pathname === '/' || pathname === '/login') {
      if (user.role === 'System Admin') {
        router.replace('/admin/dashboard');
      } else {
        router.replace('/dashboard');
      }
    }
  }, [user, isLoading, pathname, router]);

  if (isLoading) return null;
  if (user === null) return null;

  return <>{children}</>;
}

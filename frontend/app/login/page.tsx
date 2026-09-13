'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import ModernLoginPage from '@/features/tenant/pages/modern-login-page';
import { PATH_TO_PATHNAME } from '@/lib/route-map';
import { useAuth } from '@/store/AuthContext';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get('error') ?? undefined;
  const { user, isLoading } = useAuth();

  /**
   * Post-login redirect: once AuthContext commits the new user state after a
   * successful login() call, redirect to the correct portal.
   *
   * This mirrors the same logic in app/page.tsx (the root `/` route) and is
   * required because the /login route is NOT wrapped in AuthGuard — AuthGuard
   * only runs inside the (tenant) and (system-admin) route group layouts.
   * Without this effect, setUser() fires but nothing on /login responds to it,
   * leaving the user sitting on the login page after a successful sign-in.
   */
  useEffect(() => {
    if (isLoading || !user) return;

    const savedRedirect = sessionStorage.getItem('leadcrm_redirect_after_login');
    if (savedRedirect && savedRedirect !== '/login' && savedRedirect !== '/register') {
      const isAdminPath = savedRedirect.startsWith('/admin');
      const isSystemAdmin = user.role === 'System Admin';
      if (!isAdminPath || isSystemAdmin) {
        sessionStorage.removeItem('leadcrm_redirect_after_login');
        router.replace(savedRedirect);
        return;
      }
    }

    sessionStorage.removeItem('leadcrm_redirect_after_login');
    if (user.role === 'System Admin') {
      router.replace('/admin/dashboard');
    } else {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  const navigate = (path: string) => {
    if (path === 'register') return router.push('/register');
    if (path === 'landing' || path === '/') return router.push('/');
    if (path === 'onboarding') return router.push('/onboarding');
    return router.replace(PATH_TO_PATHNAME[path] ?? '/dashboard');
  };

  return <ModernLoginPage onNavigate={navigate} oauthError={oauthError} />;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

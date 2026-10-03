'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { AuthLoadingScreen } from '@/shared/components/auth-loading-screen';
import { AuthRecoveryScreen } from '@/shared/components/auth-recovery-screen';
import { getPostLoginDestination, getSetupIssue, resolveAuthRoute } from '@/shared/auth/auth-routing';


/** Route UX only. The backend independently enforces account, tenant and RBAC access. */
export function AuthGuard({
  children,
  allowAnonymous = false,
}: { children: React.ReactNode; allowAnonymous?: boolean }) {
  const { user, isLoading, authError } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const target = resolveAuthRoute(user, pathname);
  const issue = user && ['/onboarding', '/company-setup'].includes(pathname)
    ? getSetupIssue(user) : null;

  useEffect(() => {
    if (isLoading || authError) return;
    if (!user && !allowAnonymous) {
      if (pathname !== '/login') sessionStorage.setItem('leadcrm_redirect_after_login', pathname);
      router.replace('/login');
      return;
    }
    if (!target) return;
    if (user && ['/', '/login'].includes(pathname)) {
      const saved = sessionStorage.getItem('leadcrm_redirect_after_login');
      const destination = getPostLoginDestination(user, saved);
      sessionStorage.removeItem('leadcrm_redirect_after_login');
      router.replace(destination);
    } else {
      router.replace(target);
    }
  }, [user, isLoading, authError, pathname, target, router, allowAnonymous]);

  if (isLoading) return <AuthLoadingScreen />;
  if (authError) return <AuthRecoveryScreen message={authError} />;
  if (target || (!user && !allowAnonymous)) return <AuthLoadingScreen />;
  if (issue) return <AuthRecoveryScreen message={issue} />;
  return <>{children}</>;
}

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/store/AuthContext';
import { ONBOARDING_COMPLETE_KEY, NEEDS_COMPANY_SETUP_KEY } from '@/shared/providers/auth-guard';
import { PATH_TO_PATHNAME } from '@/lib/route-map';
import { AuthLoadingScreen } from '@/shared/components/auth-loading-screen';

const CompanySetupPage = dynamic(
  () => import('../../src/features/tenant/pages/company-setup-page'),
  { ssr: false },
);

export default function CompanySetupRoute(): React.ReactElement {
  const { user, isLoading } = useAuth();
  const { data: nextAuthSession, update: updateSession } = useSession();
  const router = useRouter();

  // Auth guard — unauthenticated visitors go to login
  useEffect(() => {
    if (isLoading) return;
    if (!user && !nextAuthSession) {
      router.replace('/login');
    }
  }, [user, isLoading, nextAuthSession, router]);

  if (isLoading || (!user && !nextAuthSession)) return <AuthLoadingScreen />;

  const handleNavigate = async (path: string): Promise<void> => {
    if (path === 'billing') {
      // Company setup complete — guide user to plan selection
      router.push('/billing/client');
      return;
    }

    if (path === 'dashboard') {
      // Fallback: clear localStorage flags so setup screens don't reappear
      if (typeof window !== 'undefined') {
        localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
        localStorage.removeItem(NEEDS_COMPANY_SETUP_KEY);
      }
      // CRITICAL: Update the NextAuth JWT session to clear requiresProfileCompletion.
      // Without this, AuthGuard will see requiresProfileCompletion=true on the
      // next /dashboard visit and redirect back to /onboarding (infinite loop).
      await updateSession({ requiresProfileCompletion: false });
      router.push('/dashboard');
      return;
    }

    router.push(PATH_TO_PATHNAME[path] ?? '/dashboard');
  };

  return <CompanySetupPage onNavigate={handleNavigate} />;
}

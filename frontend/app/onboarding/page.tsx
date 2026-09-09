'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/store/AuthContext';
import { AuthLoadingScreen } from '@/shared/components/auth-loading-screen';

const OnboardingPage = dynamic(
  () => import('../../src/features/tenant/pages/onboarding-page'),
  { ssr: false },
);

export default function OnboardingRoute(): React.ReactElement {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    // Not authenticated — send to login
    if (!user) {
      router.replace('/login');
    }
    // Note: we intentionally do NOT redirect away when onboardingCompletedAt is set,
    // because the OnboardingPage component handles that state internally by showing
    // the SetupCompleteCard. Redirecting here would cause a flash when the user
    // refreshes after completing setup and wants to navigate to billing.
  }, [user, isLoading, router]);

  if (isLoading || !user) return <AuthLoadingScreen />;

  const handleNavigate = (path: string): void => {
    if (path === 'billing') {
      router.push('/billing/client');
      return;
    }
    if (path === 'dashboard') {
      router.push('/dashboard');
      return;
    }
    if (path === 'login') {
      router.push('/login');
      return;
    }
    router.push('/dashboard');
  };

  return <OnboardingPage onNavigate={handleNavigate} />;
}

'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ModernLoginPage from '@/features/tenant/pages/modern-login-page';
import { PATH_TO_PATHNAME } from '@/lib/route-map';
import { AuthGuard } from '@/shared/providers/auth-guard';
import { AuthLoadingScreen } from '@/shared/components/auth-loading-screen';

function LoginContent() {
  const router = useRouter();
  const search = useSearchParams();
  function navigate(path: string) {
    router.push(path === 'landing' ? '/' : PATH_TO_PATHNAME[path] ?? `/${path}`);
  }
  return (
    <AuthGuard allowAnonymous>
      <ModernLoginPage onNavigate={navigate} loginError={search.get('error') ?? undefined} />
    </AuthGuard>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<AuthLoadingScreen />}><LoginContent /></Suspense>;
}

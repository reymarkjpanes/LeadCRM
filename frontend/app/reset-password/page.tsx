'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import ModernLoginPage from '@/features/tenant/pages/modern-login-page';
import { PATH_TO_PATHNAME } from '@/lib/route-map';

function ResetPasswordPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const loginError = searchParams.get('error') ?? undefined;

  const navigate = (path: string) => {
    if (path === 'login') return router.push('/login');
    if (path === 'landing' || path === '/') return router.push('/');
    return router.push(PATH_TO_PATHNAME[path] ?? '/dashboard');
  };
  
  // ModernLoginPage detects ?token= in the URL and shows the reset-password view
  return <ModernLoginPage onNavigate={navigate} loginError={loginError} />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}

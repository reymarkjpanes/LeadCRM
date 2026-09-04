'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import InviteAcceptPage from '@/features/tenant/pages/invite-accept-page';

function InviteAcceptContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  return <InviteAcceptPage token={token} />;
}

export default function InviteAcceptRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="text-sm text-slate-500 dark:text-slate-400">Loading…</div>
        </div>
      }
    >
      <InviteAcceptContent />
    </Suspense>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/shared/providers/auth-guard';
import { useAuth } from '@/store/AuthContext';
import AdminLayoutShell from '@/features/system-admin/layout/admin-layout-shell';

/**
 * SystemAdminGuard — blocks non-system-admin users from accessing /admin/* routes.
 *
 * Detection matches auth-guard.tsx:
 *   1. role === 'System Admin'  — primary check (server-backed JWT)
 *   2. tenantName includes 'system'  — fallback for edge cases
 *
 * tenantId is always a UUID in production — never the literal strings 'system'
 * or 'leadcrm-system-demo', so those old checks have been removed.
 *
 * On failure: redirect to /login so users never see a blank screen.
 */
function SystemAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const isSystemAdmin =
    user?.role === 'System Admin' ||
    user?.tenantName?.toLowerCase().includes('system');

  useEffect(() => {
    if (isLoading) return;
    if (!user) return; // AuthGuard (parent) handles unauthenticated redirect to /login
    if (!isSystemAdmin) {
      router.replace('/login');
    }
  }, [user, isLoading, isSystemAdmin, router]);

  if (isLoading || !user) return null;
  if (!isSystemAdmin) return null;

  return <>{children}</>;
}

export default function SystemAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SystemAdminGuard>
        <AdminLayoutShell>{children}</AdminLayoutShell>
      </SystemAdminGuard>
    </AuthGuard>
  );
}

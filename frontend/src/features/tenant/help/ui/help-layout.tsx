'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/store/AuthContext';
import CrmLayout from '@/features/tenant/layout/crm-layout';
import { InstallAppButton } from '@/shared/components/install-app-button';

/** Public guides always render; only a restored user receives the existing CRM shell. */
export default function HelpLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const content = <><div className="mb-4 flex justify-end"><InstallAppButton /></div>{children}</>;
  if (user) return <CrmLayout>{content}</CrmLayout>;
  return <main className="min-h-[var(--app-viewport-height)] bg-[var(--background)] px-3 py-6 sm:px-4 lg:px-6">{content}</main>;
}

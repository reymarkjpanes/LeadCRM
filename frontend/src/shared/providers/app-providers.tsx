'use client';

import React from 'react';
import { AuthProvider } from '@/store/AuthContext';
import { DataProvider } from '@/store/DataContext';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/store/AuthContext';
import { useTheme } from '@/shared/hooks/use-theme';
import { usesWorkspaceAppearance } from '@/lib/appearance-config';
import { ThemeScope } from '@/shared/components/theme-scope';
import { Toaster } from 'sonner';

function AppearanceToaster() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const workspace = usesWorkspaceAppearance(usePathname(), Boolean(user));
  return <ThemeScope enabled={workspace} className="contents">
    <Toaster theme={workspace && isDark ? 'dark' : 'light'} position="top-right" expand closeButton duration={4000} gap={4} />
  </ThemeScope>;
}

/** AuthContext restores the server-backed HttpOnly session. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        {children}
        <AppearanceToaster />
      </DataProvider>
    </AuthProvider>
  );
}

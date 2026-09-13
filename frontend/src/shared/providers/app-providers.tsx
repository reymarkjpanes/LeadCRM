'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { AuthProvider } from '@/store/AuthContext';
import { DataProvider } from '@/store/DataContext';
import { Toaster } from 'sonner';
import GlobalLoader from '@/shared/components/global-loader';

/**
 * AppProviders — wraps the entire app with auth + data context.
 *
 * Layer order:
 *   SessionProvider  — NextAuth v4: manages the NextAuth JWT cookie and
 *                      exposes useSession() for the Google OAuth flow.
 *                      The LeadCRM HttpOnly JWT cookie is managed separately
 *                      by the custom Express backend via AuthContext.
 *   AuthProvider     — Custom LeadCRM auth state (user, tenant, login, logout).
 *   DataProvider     — All CRM data operations.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <DataProvider>
          {children}
          <GlobalLoader />
          <Toaster
            position="top-right"
            expand={true}
            closeButton
            duration={4000}
            gap={10}
          />
        </DataProvider>
      </AuthProvider>
    </SessionProvider>
  );
}

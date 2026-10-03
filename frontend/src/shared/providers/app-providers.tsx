'use client';

import React from 'react';
import { AuthProvider } from '@/store/AuthContext';
import { DataProvider } from '@/store/DataContext';
import { Toaster } from 'sonner';

/** AuthContext restores the server-backed HttpOnly session. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        {children}
        <Toaster
          position="top-right"
          expand={true}
          closeButton
          duration={4000}
          gap={4}
        />
      </DataProvider>
    </AuthProvider>
  );
}

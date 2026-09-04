'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This route is no longer the primary entry point for user management.
// Settings → Team Management is the canonical destination.
export default function UsersRedirect(): null {
  const router = useRouter();
  useEffect(() => { router.replace('/settings?tab=users'); }, [router]);
  return null;
}

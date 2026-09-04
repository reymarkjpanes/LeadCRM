'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This route is no longer the primary entry point for audit logs.
// Settings → Audit Trail is the canonical destination.
export default function AuditRedirect(): null {
  const router = useRouter();
  useEffect(() => { router.replace('/settings?tab=audit'); }, [router]);
  return null;
}

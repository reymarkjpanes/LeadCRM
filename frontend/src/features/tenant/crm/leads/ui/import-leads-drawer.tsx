'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
/** Compatibility entry point: the full-page wizard owns import validation and retry state. */
export function ImportLeadsDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void; onImportComplete?: () => void }) {
  const router = useRouter();
  useEffect(() => { if (isOpen) { onClose(); router.push('/crm/leads/import'); } }, [isOpen, onClose, router]);
  return null;
}

'use client';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

/** Opens existing record views from application-owned notification links. */
export function useNotificationRecordLink<T>(key: string, scope: string, enabled: boolean, load: (id: string) => Promise<T>, open: (row: T) => void) {
  const query = useSearchParams(), router = useRouter();
  const id = query?.get(key);
  const callbacks = useRef({ load, open }); callbacks.current = { load, open };
  useEffect(() => {
    if (!id || !enabled || !scope) return;
    let cancelled = false;
    if (!/^[a-zA-Z0-9_@.\-:]+$/.test(id) || id.length > 256) return;
    callbacks.current.load(id).then(row => {
      if (cancelled) return;
      callbacks.current.open(row);
      const url = new URL(window.location.href);
      url.searchParams.delete(key);
      router.replace(url.pathname + url.search, { scroll: false });
    }).catch(() => { if (!cancelled) toast.error('The requested record is unavailable or your access has changed.'); });
    return () => { cancelled = true; };
  }, [id, key, scope, enabled, router]);
}

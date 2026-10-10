'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductInterest } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/store/AuthContext';

export const PRODUCT_INTEREST_ENDPOINT = '/administration/product-interests';
export type ProductInterestResponse = { data: ProductInterest[]; meta: { enabled: boolean } };
export function useProductInterests() {
  const { user, isLoading: authLoading, authError } = useAuth();
  const [products, setProducts] = useState<ProductInterest[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (authLoading || authError || !user?.tenantId) {
      setProducts([]); setLoading(false);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true); setError('');
    apiClient.get<ProductInterestResponse>(PRODUCT_INTEREST_ENDPOINT, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setProducts(result.data); setEnabled(result.meta?.enabled !== false); } })
      .catch(e => { if (!controller.signal.aborted) { setError(e.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.tenantId, authLoading, authError, revision]);
  useEffect(() => {
    const onChanged = (event: Event) => {
      pending.current?.abort();
      const result = (event as CustomEvent<ProductInterestResponse>).detail;
      if (result) { setProducts(result.data); setEnabled(result.meta.enabled); setError(''); }
      refresh();
    };
    window.addEventListener('product-interests-changed', onChanged);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('product-interests-changed', onChanged); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  return { products, enabled, loading, error, refresh };
}

'use client';

/**
 * useInvoicesData — route-scoped hook for the Contract Billing page.
 *
 * Fetches invoices on mount using the shared useRouteData SWR primitive.
 * Refreshes every 5 minutes (financial records; err toward freshness) and on focus.
 *
 * Mutations (addInvoice / updateInvoice / removeInvoice) remain in DataContext
 * because they may be called from multiple places.
 */

import { useState, useCallback } from 'react';
import { invoicesApi } from '@/shared/services/invoices.api';
import { useRouteData } from '@/shared/hooks/use-route-data';
import { USE_MOCK_DATA } from '@/lib/config';
import type { Invoice } from '@/store/types';

export interface UseInvoicesDataReturn {
  invoices:      Invoice[];
  isInitialLoad: boolean;
  isRefreshing:  boolean;
  error:         string | null;
  refetch:       () => void;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useInvoicesData(): UseInvoicesDataReturn {
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const fetchFn = useCallback(async (): Promise<void> => {
    const res = await invoicesApi.list({ limit: 100 });
    setInvoices((res?.data ?? []) as Invoice[]);
  }, []);

  const { isFetching, hasLoadedOnce, error, refetch } = useRouteData({
    fetchFn,
    intervalMs: REFRESH_INTERVAL_MS,
    disabled:   USE_MOCK_DATA,
  });

  return {
    invoices,
    isInitialLoad: isFetching && !hasLoadedOnce,
    isRefreshing:  isFetching && hasLoadedOnce,
    error,
    refetch,
  };
}

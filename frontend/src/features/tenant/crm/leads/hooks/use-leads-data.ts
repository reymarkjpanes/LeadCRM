'use client';

/**
 * useLeadsData — route-scoped, server-paginated hook for the Leads page.
 *
 * Wraps the shared useModuleData hook and applies the toFrontendContact adapter.
 * Implements stale-while-revalidate: existing rows stay visible during background
 * refresh — skeleton only shows on initial load when there is no data yet.
 * Background refresh fires every 60 seconds while the Leads route is mounted,
 * and on window focus. Both stop automatically when the route unmounts.
 *
 * IMPORTANT: This hook owns the fetch for the leads LIST only.
 * Mutations (add/update/delete) remain in DataContext for now because
 * RecordPanelWrappers, lead-detail-page, contact-detail-page, convert-lead-dialog,
 * and merge-records-dialog all depend on DataContext mutation methods.
 */

import { useState, useEffect, useRef } from 'react';
import { useModuleData } from '@/shared/hooks/use-module-data';
import { toFrontendContact } from '@/lib/api/adapters/contact.adapter';
import type { Contact } from '@/store/types';
import type { FilterCondition } from '@leadcrm/shared';
import type { SortPreference } from '@/shared/services/table-preferences.api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseLeadsDataParams {
  page: number;
  pageSize: number;
  sort?: SortPreference | null;
  filter?: FilterCondition[];
  search?: string;
}

export interface UseLeadsDataMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UseLeadsDataReturn {
  /** Current display data — stale data kept visible during background refresh. */
  leads: Contact[];
  meta: UseLeadsDataMeta | null;
  /** True only on the very first fetch when there is no prior data to show. Render skeleton. */
  isInitialLoad: boolean;
  /** True during background refresh while existing data is still visible. */
  isRefreshing: boolean;
  error: string | null;
  /** Manually trigger a re-fetch (e.g. after a mutation). */
  refetch: () => void;
}

const REFRESH_INTERVAL_MS = 60_000;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLeadsData(params: UseLeadsDataParams): UseLeadsDataReturn {
  const { data, meta, isLoading, error, refetch } = useModuleData({
    moduleId: 'leads',
    page: params.page,
    pageSize: params.pageSize,
    // SortPreference shape matches useModuleData's SortParam exactly
    sort: params.sort ?? null,
    filter: params.filter,
    search: params.search,
  });

  // ── Stale-while-revalidate state ──────────────────────────────────────────
  // displayLeads holds the last successful result so the UI never goes blank
  // during a background refresh.
  const [displayLeads, setDisplayLeads] = useState<Contact[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (!isLoading && error === null) {
      // New data arrived — map through the adapter and update display
      const mapped = data.map((raw) => toFrontendContact(raw)) as Contact[];
      setDisplayLeads(mapped);
      setHasLoadedOnce(true);
    }
    // On error: keep displayLeads as-is so existing rows remain visible
  }, [data, isLoading, error]);

  const isInitialLoad = isLoading && !hasLoadedOnce;
  const isRefreshing = isLoading && hasLoadedOnce;

  // ── Background refresh ────────────────────────────────────────────────────
  // Store refetch in a ref so the interval/focus handler always calls the
  // latest version without needing to be listed as an effect dependency.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const interval = setInterval(() => {
      refetchRef.current();
    }, REFRESH_INTERVAL_MS);

    const handleFocus = (): void => {
      refetchRef.current();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []); // empty deps — stable via ref; stops on unmount (route navigation away)

  return {
    leads: displayLeads,
    meta,
    isInitialLoad,
    isRefreshing,
    error,
    refetch,
  };
}

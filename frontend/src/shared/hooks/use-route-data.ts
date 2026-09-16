'use client';

/**
 * useRouteData — shared SWR fetch primitive for route-scoped data hooks.
 *
 * Encapsulates the repeated boilerplate across useCampaignsData, useInvoicesData,
 * and similar route-scoped hooks:
 *   - mountedRef (prevents setState after unmount)
 *   - hasLoadedOnce (distinguishes initial load from background refresh)
 *   - isFetching (drives isInitialLoad / isRefreshing flags)
 *   - setInterval background refresh + window.addEventListener('focus') refresh
 *   - Cleanup on unmount
 *
 * Usage:
 *   const { isFetching, hasLoadedOnce, error, fetchData } = useRouteData({
 *     fetchFn: async () => { ... },
 *     intervalMs: 2 * 60 * 1000,
 *     disabled: USE_MOCK_DATA,
 *   });
 *
 * The consumer is responsible for managing its own data state
 * (setCampaigns, setTemplates, etc.) inside fetchFn.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseRouteDataOptions {
  /** Async function that performs the actual fetch and updates external state. */
  fetchFn: () => Promise<void>;
  /** Background refresh interval in milliseconds. */
  intervalMs: number;
  /** When true, skip real-API fetching (e.g. USE_MOCK_DATA mode). */
  disabled?: boolean;
}

export interface UseRouteDataReturn {
  isFetching:    boolean;
  hasLoadedOnce: boolean;
  error:         string | null;
  /** Manually trigger a refetch. */
  refetch:       () => void;
  /** Set error externally (allows fetchFn to communicate errors upward). */
  setError:      (msg: string | null) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRouteData({
  fetchFn,
  intervalMs,
  disabled = false,
}: UseRouteDataOptions): UseRouteDataReturn {
  const [isFetching,    setIsFetching]    = useState(!disabled);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const mountedRef = useRef(true);
  const fetchRef   = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runFetch = useCallback(async (): Promise<void> => {
    if (disabled || !mountedRef.current) return;
    setIsFetching(true);
    setError(null);
    try {
      await fetchRef.current();
      if (mountedRef.current) setHasLoadedOnce(true);
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unexpected error');
      }
    } finally {
      if (mountedRef.current) setIsFetching(false);
    }
  }, [disabled]);

  // Initial fetch
  useEffect(() => {
    if (disabled) return;
    void runFetch();
  }, [runFetch, disabled]);

  // Background refresh + focus revalidation
  useEffect(() => {
    if (disabled) return;
    const interval = setInterval(() => { void runFetch(); }, intervalMs);
    const handleFocus = (): void => { void runFetch(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [runFetch, intervalMs, disabled]);

  return {
    isFetching,
    hasLoadedOnce,
    error,
    refetch: () => { void runFetch(); },
    setError,
  };
}

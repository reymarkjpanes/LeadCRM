'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  tablePreferencesApi,
  type SortPreference,
  type ViewMode,
} from '@/shared/services/table-preferences.api';

export type { SortPreference, ViewMode };

/** Display mode for table cell content: wrap text or clip with ellipsis */
export type DisplayMode = 'wrap' | 'clip';

interface UseTablePreferencesReturn {
  pageSize: number;
  viewMode: ViewMode;
  displayMode: DisplayMode;
  sort: SortPreference | null;
  isLoading: boolean;
  setPageSize: (size: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setSort: (sort: SortPreference | null) => void;
  /** Fire-and-forget filter persistence — URL remains source of truth */
  persistFilters: (conditions: unknown[]) => void;
}

/**
 * Hook to manage table preferences (pageSize, viewMode, displayMode, sort) for a module.
 * Fetches from the server on mount, persists changes via fire-and-forget pattern.
 *
 * Fire-and-forget behavior:
 * - UI updates immediately (optimistic)
 * - Persist request is sent in the background
 * - On failure: non-blocking error toast (auto-dismiss 5s), NO rollback
 * - On next user action of same type: silently retries (normal persist call)
 *
 * Usage:
 *   const { pageSize, viewMode, displayMode, sort, setPageSize, setViewMode, setDisplayMode, setSort } = useTablePreferences('leads');
 */
export function useTablePreferences(module: string): UseTablePreferencesReturn {
  const defaultSort = (): SortPreference | null => ['leads', 'contacts', 'accounts', 'campaigns', 'workflows', 'users'].includes(module) ? { field: 'createdAt', direction: 'desc' } : null;
  const [pageSize, setPageSizeState] = useState<number>(25);
  const [viewMode, setViewModeState] = useState<ViewMode>('wrap');
  const [displayMode, setDisplayModeState] = useState<DisplayMode>('wrap');
  const [sort, setSortState] = useState<SortPreference | null>(defaultSort);
  const sortChanged = useRef(false);
  const [isLoading, setIsLoading] = useState(true);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchPreferences(): Promise<void> {
      setIsLoading(true);
      try {
        const response = await tablePreferencesApi.getTablePreferences(module);
        if (!cancelled && mountedRef.current) {
          setPageSizeState(response.data.pageSize);
          setViewModeState(response.data.viewMode);
          // Display mode comes from viewMode on the server (same underlying preference)
          setDisplayModeState(response.data.viewMode);
          if (!sortChanged.current) setSortState(response.data.sort ?? defaultSort());
        }
      } catch {
        // On failure, keep defaults (pageSize: 25, viewMode: 'wrap', displayMode: 'wrap', sort: null)
      } finally {
        if (!cancelled && mountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    fetchPreferences();

    return () => {
      cancelled = true;
    };
  }, [module]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    // Fire-and-forget: no rollback, retry on next user action
    tablePreferencesApi.savePageSize(module, size).catch(() => {
      if (mountedRef.current) {
        toast.error('Unable to save page size preference', { duration: 5000 });
      }
    });
  }, [module]);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    setDisplayModeState(mode);
    // Fire-and-forget: no rollback, retry on next user action
    tablePreferencesApi.saveViewMode(module, mode).catch(() => {
      if (mountedRef.current) {
        toast.error('Unable to save view mode preference', { duration: 5000 });
      }
    });
  }, [module]);

  const setDisplayMode = useCallback((mode: DisplayMode) => {
    setDisplayModeState(mode);
    setViewModeState(mode);
    // Fire-and-forget: no rollback, retry on next user action
    tablePreferencesApi.saveViewMode(module, mode).catch(() => {
      if (mountedRef.current) {
        toast.error('Unable to save display mode preference', { duration: 5000 });
      }
    });
  }, [module]);

  const setSort = useCallback((newSort: SortPreference | null) => {
    sortChanged.current = true;
    setSortState(newSort);
    // Always persist — including null (clears server sort)
    tablePreferencesApi.saveSort(module, newSort).catch(() => {
      if (mountedRef.current) {
        toast.error('Unable to save sort preference', { duration: 5000 });
      }
    });
  }, [module]);

  /**
   * Fire-and-forget filter persistence.
   * URL state remains the source of truth — this just mirrors to server
   * so filters are restored on next visit when URL has no filter params.
   */
  const persistFilters = useCallback((conditions: unknown[]) => {
    tablePreferencesApi.saveFilters(module, conditions as import('@leadcrm/shared').FilterCondition[]).catch(() => {
      // Silent fail — filters are URL-owned, server is just a backup
    });
  }, [module]);

  return {
    pageSize,
    viewMode,
    displayMode,
    sort,
    isLoading,
    setPageSize,
    setViewMode,
    setDisplayMode,
    setSort,
    persistFilters,
  };
}

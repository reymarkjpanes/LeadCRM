'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { tablePreferencesApi } from '@/shared/services/table-preferences.api';
import { toast } from 'sonner';
import type { ViewType } from '@leadcrm/shared';

export interface UseViewTypePreferenceReturn {
  viewType: ViewType;
  setViewType: (view: ViewType) => void;
  isLoading: boolean;
}

/**
 * Hook to manage view type preference for a module.
 * Uses fire-and-forget persistence: updates UI immediately,
 * persists in background, and shows a non-blocking error toast on failure.
 *
 * Defaults to 'table' when no persisted preference exists.
 *
 * Usage:
 *   const { viewType, setViewType, isLoading } = useViewTypePreference('leads');
 */
export function useViewTypePreference(
  module: string,
  defaultView: ViewType = 'table',
): UseViewTypePreferenceReturn {
  const [viewType, setViewTypeState] = useState<ViewType>(defaultView);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch persisted view type on mount / module change
  useEffect(() => {
    let cancelled = false;

    if (module === '__noop__') {
      setIsLoading(false);
      return;
    }

    async function fetchViewType(): Promise<void> {
      setIsLoading(true);
      try {
        const response = await tablePreferencesApi.getViewType(module);
        if (!cancelled && mountedRef.current) {
          const saved = response.data.viewType as ViewType | null;
          setViewTypeState(saved ?? defaultView);
        }
      } catch {
        // Keep default on failure — no toast for initial load failure
      } finally {
        if (!cancelled && mountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    fetchViewType();

    return () => {
      cancelled = true;
    };
  }, [module, defaultView]);

  const setViewType = useCallback(
    (view: ViewType) => {
      setViewTypeState(view);
      if (module === '__noop__') return;
      // Fire-and-forget: persist in background, toast on failure
      tablePreferencesApi.saveViewType(module, view).catch(() => {
        if (mountedRef.current) {
          toast.error('Unable to save view preference', { duration: 5000 });
        }
      });
    },
    [module],
  );

  return { viewType, setViewType, isLoading };
}

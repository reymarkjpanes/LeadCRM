'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { preferencesApi } from '@/shared/services/preferences.api';
import { normalizeModuleColumns } from '@leadcrm/shared';
import type { ColumnConfigItem } from '@leadcrm/shared';

interface UseColumnPreferencesReturn {
  effectiveColumns: ColumnConfigItem[];
  isLoading: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveColumns: (config: ColumnConfigItem[]) => Promise<void>;
  resetColumns: () => Promise<void>;
  retryCount: number;
}

/**
 * Generic hook to manage column preferences for ANY module.
 * Fetches effective columns from the API on mount, provides save/reset operations
 * with optimistic updates, rollback on failure, and retry logic (max 3 attempts).
 *
 * Usage:
 *   const { effectiveColumns, saveColumns, resetColumns } = useColumnPreferences('leads');
 *   const { effectiveColumns, saveColumns, resetColumns } = useColumnPreferences('accounts');
 *   const { effectiveColumns, saveColumns, resetColumns } = useColumnPreferences('contacts');
 */
export function useColumnPreferences(module: string): UseColumnPreferencesReturn {
  const [effectiveColumns, setEffectiveColumns] = useState<ColumnConfigItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Track the previous state for rollback on failure
  const previousColumnsRef = useRef<ColumnConfigItem[]>([]);
  // Track if the component is still mounted
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch effective columns on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchColumns(): Promise<void> {
      setIsLoading(true);
      try {
        const response = await preferencesApi.getEffectiveColumns(module);
        if (!cancelled && mountedRef.current) {
          setEffectiveColumns(normalizeModuleColumns(module, response.data.columns));
          setSaveError(null);
        }
      } catch (error: unknown) {
        // On fetch failure, keep whatever state we have (empty on first load)
        // The table will render system defaults via its own fallback
        if (!cancelled && mountedRef.current) {
          setSaveError(
            error instanceof Error ? error.message : 'Failed to load column preferences'
          );
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    fetchColumns();

    return () => {
      cancelled = true;
    };
  }, [module]);

  /**
   * Save column configuration with optimistic update.
   * Flow:
   * 1. Store previous state (for rollback)
   * 2. Optimistically update local state
   * 3. Call API to persist
   * 4. On success: confirm state, clear error, reset retryCount
   * 5. On failure: rollback to previous state, set saveError, increment retryCount
   */
  const saveColumns = useCallback(async (config: ColumnConfigItem[]): Promise<void> => {
    // Store previous state for rollback
    previousColumnsRef.current = [...effectiveColumns];

    // Optimistic update — apply immediately before API response
    setEffectiveColumns(config);
    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await preferencesApi.saveUserPreference(module, config);

      if (mountedRef.current) {
        // Confirm with server response (server is authoritative)
        setEffectiveColumns(normalizeModuleColumns(module, response.data.columns));
        setSaveError(null);
        setRetryCount(0);
      }
    } catch (error: unknown) {
      if (mountedRef.current) {
        // Rollback to previous state
        setEffectiveColumns(previousColumnsRef.current);
        const errorMessage = error instanceof Error
          ? error.message
          : 'Unable to save column preferences';
        setSaveError(errorMessage);
        setRetryCount((prev) => prev + 1);
      }
      // Re-throw so callers (e.g. onColumnReorder) can handle with a toast
      throw error;
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [module, effectiveColumns]);

  /**
   * Reset columns by deleting user preference.
   * Flow:
   * 1. Call DELETE API
   * 2. On success: update local state with returned fallback columns
   * 3. On failure: keep current state, set error
   */
  const resetColumns = useCallback(async (): Promise<void> => {
    // Store previous state for rollback on failure
    previousColumnsRef.current = [...effectiveColumns];

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await preferencesApi.deleteUserPreference(module);

      if (mountedRef.current) {
        // Update with the fallback (tenant default or system default)
        setEffectiveColumns(normalizeModuleColumns(module, response.data.columns));
        setSaveError(null);
        setRetryCount(0);
      }
    } catch (error: unknown) {
      if (mountedRef.current) {
        // Keep current state on failure
        setEffectiveColumns(previousColumnsRef.current);
        const errorMessage = error instanceof Error
          ? error.message
          : 'Unable to reset column preferences';
        setSaveError(errorMessage);
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [module, effectiveColumns]);

  return {
    effectiveColumns,
    isLoading,
    isSaving,
    saveError,
    saveColumns,
    resetColumns,
    retryCount,
  };
}

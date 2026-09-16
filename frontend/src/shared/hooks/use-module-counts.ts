'use client';

/**
 * useModuleCounts — lightweight hook for fetching total record counts per module.
 *
 * Used exclusively by the sidebar to display badge counts without loading full
 * page datasets. Fetches page=1&pageSize=1 so the server returns only `meta.total`
 * — the minimum possible payload for a count.
 *
 * Cache: counts are cached for 5 minutes and refreshed on window focus.
 * This keeps sidebar badges reasonably fresh without hammering the API.
 *
 * Tenant isolation: all requests use the authenticated HttpOnly cookie.
 * The server enforces tenantId from the JWT — we never supply it from the client.
 */

import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModuleCountsReturn {
  counts: Record<string, number>;
  isLoading: boolean;
}

type ModuleId = 'leads' | 'accounts' | 'deals';

// ── In-memory cache (module-level, survives re-renders, cleared on logout) ────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  total: number;
  fetchedAt: number;
}

const countCache = new Map<ModuleId, CacheEntry>();

export function clearModuleCountsCache(): void {
  countCache.clear();
}

async function fetchCount(moduleId: ModuleId): Promise<number> {
  const cached = countCache.get(moduleId);
  const now = Date.now();

  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.total;
  }

  try {
    const res = await apiClient.get<{
      success: boolean;
      meta: { total: number };
      data: unknown[];
    }>(`/crm/${moduleId}`, { params: { page: '1', pageSize: '1' } });

    const total = res.meta?.total ?? 0;
    countCache.set(moduleId, { total, fetchedAt: Date.now() });
    return total;
  } catch {
    // On failure: return cached value if available, otherwise 0
    return cached?.total ?? 0;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches total record counts for the given CRM modules.
 * Results are cached for 5 minutes; individual module failures degrade gracefully.
 *
 * @param modules - Array of module IDs to count (e.g. ['leads', 'accounts', 'deals'])
 */
export function useModuleCounts(modules: ModuleId[]): ModuleCountsReturn {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  const mountedRef = useRef(true);
  // Stable key to avoid re-triggering effect when array identity changes
  const modulesKey = modules.slice().sort().join(',');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCounts = (): void => {
    Promise.all(
      modules.map(async (moduleId) => {
        const total = await fetchCount(moduleId);
        return [moduleId, total] as [ModuleId, number];
      }),
    ).then((results) => {
      if (!mountedRef.current) return;
      setCounts(Object.fromEntries(results));
      setIsLoading(false);
    }).catch(() => {
      if (mountedRef.current) setIsLoading(false);
    });
  };

  useEffect(() => {
    setIsLoading(true);
    loadCounts();

    const handleFocus = (): void => {
      // On focus, invalidate cache and reload
      modules.forEach((m) => countCache.delete(m));
      loadCounts();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulesKey]); // stable key — only re-runs if the set of modules changes

  return { counts, isLoading };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/store/AuthContext';
import { USE_MOCK_DATA } from '@/lib/config';
import { subscribePageCacheInvalidation, buildCacheKey, createPageCacheGuard, getPageCache, setPageCache, invalidatePageCache } from '@/shared/cache/page-cache';

interface CachedPageOptions<T> {
  module: string;
  params: Record<string, unknown>;
  fetchFn: (signal: AbortSignal) => Promise<T>;
  intervalMs?: number;
  disabled?: boolean;
  revalidateOnInvalidation?: boolean;
  pauseWhenHidden?: boolean;
}

/** Cache successful results together with their exact request key; always revalidate on mount. */
export function useCachedPage<T>({ module, params, fetchFn, intervalMs, pauseWhenHidden = false, revalidateOnInvalidation = false, disabled = USE_MOCK_DATA }: CachedPageOptions<T>) {
  const { tenant, user, isLoading, authError } = useAuth();
  const tenantId = tenant?.id ?? '';
  // Responses (especially notifications) can depend on the user and their role.
  const scopedParams = { query: params, userId: user?.id, role: user?.role };
  const key = buildCacheKey(module, tenantId, scopedParams);
  const enabled = !disabled && !isLoading && !authError && !!tenantId && !!user?.id;
  const cached = enabled ? getPageCache<T>(module, tenantId, scopedParams) : null;
  const [state, setState] = useState<{
    key: string; data?: T; fetching: boolean; error: string | null;
  }>(() => ({ key, data: cached?.data, fetching: enabled, error: null }));
  const latest = useRef({ key, fetchFn, scopedParams });
  latest.current = { key, fetchFn, scopedParams };
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refetch = useCallback(async () => {
    if (!enabled || !mounted.current || latest.current.key !== key) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const validCache = createPageCacheGuard(module);
    const request = latest.current;
    const current = () => !controller.signal.aborted && latest.current.key === key && validCache();
    const initial = getPageCache<T>(module, tenantId, request.scopedParams);
    setState((prev) => ({ key, data: prev.key === key ? prev.data : initial?.data, fetching: true, error: null }));
    try {
      const data = await request.fetchFn(controller.signal);
      if (!current()) return;
      setPageCache(module, tenantId, request.scopedParams, data);
      setState({ key, data, fetching: false, error: null });
    } catch (error) {
      if (!current()) return;
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) invalidatePageCache(module, tenantId, false);
      setState((prev) => ({
        ...prev,
        // Do not keep showing previously authorized data after access is revoked.
        data: status === 401 || status === 403 ? undefined : prev.data,
        fetching: false,
        error: error instanceof Error ? error.message : 'Failed to load data',
      }));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (!controller.signal.aborted && latest.current.key === key) {
        setState((prev) => prev.key === key ? { ...prev, fetching: false } : prev);
      }
    }
  }, [key, enabled, module, tenantId]);

  useEffect(() => {
    mounted.current = true;
    void refetch();
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
    };
  }, [refetch]);

  useEffect(() => {
    if (!enabled || !intervalMs) return;
    const refresh = () => {
      if ((pauseWhenHidden && document.hidden) || (activeRequest.current && !activeRequest.current.signal.aborted)) return;
      void refetch();
    };
    const interval = setInterval(refresh, intervalMs);
    window.addEventListener('focus', refresh);
    if (pauseWhenHidden) document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      if (pauseWhenHidden) document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, intervalMs, pauseWhenHidden, refetch]);

  useEffect(() => {
    if (!enabled) return;
    return subscribePageCacheInvalidation((changedModule, changedTenant) => {
      if (changedModule === '*') {
        setState({ key, data: undefined, fetching: true, error: null });
        void refetch();
      } else if (revalidateOnInvalidation && changedModule === module && (!changedTenant || changedTenant === tenantId)) void refetch();
    });
  }, [enabled, revalidateOnInvalidation, module, tenantId, key, refetch]);

  const data = enabled ? (state.key === key ? state.data : cached?.data) : undefined;
  const fetching = enabled && (state.key === key ? state.fetching : true);
  return {
    data,
    isInitialLoad: fetching && data === undefined,
    isRefreshing: fetching && data !== undefined,
    error: enabled && state.key === key ? state.error : null,
    refetch,
  };
}

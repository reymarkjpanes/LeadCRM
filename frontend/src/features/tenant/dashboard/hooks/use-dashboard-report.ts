'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardQuery, DashboardReport } from '@leadcrm/shared';
import { apiClient, type ApiRequestError } from '@/lib/api/client';
import { useAuth } from '@/store/AuthContext';
import { subscribePageCacheInvalidation, clearPageCache } from '@/shared/cache/page-cache';

export function dashboardQueryString(query: DashboardQuery) {
  const params = new URLSearchParams({ range: query.range });
  if (query.range === 'custom') {
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);
  }
  if (query.revenueInterval) params.set('revenueInterval', query.revenueInterval);
  if (query.funnelRange) params.set('funnelRange', query.funnelRange);
  if (query.funnelRange === 'custom') {
    if (query.funnelStart) params.set('funnelStart', query.funnelStart);
    if (query.funnelEnd) params.set('funnelEnd', query.funnelEnd);
  }
  return params.toString();
}

export function useDashboard(query: DashboardQuery) {
  const { user, tenant, refreshPermissions, refreshUser } = useAuth();
  const identity = `${tenant?.id ?? user?.tenantId ?? ''}:${user?.id ?? ''}:${user?.role ?? ''}`;
  const queryString = dashboardQueryString(query);
  const key = `${identity}:${queryString}`;
  const [state, setState] = useState<{ key: string; report: DashboardReport | null; error: string | null }>({ key, report: null, error: null });
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'stale'>('connecting');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeKey = useRef(key);
  activeKey.current = key;
  const authActions = useRef({ refreshPermissions, refreshUser });
  authActions.current = { refreshPermissions, refreshUser };
  const resetAccess = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    setLoading(false);
    setState({ key: activeKey.current, report: null, error: 'Reporting access changed. Checking your permissions…' });
    clearPageCache();
    void Promise.allSettled([authActions.current.refreshPermissions(), authActions.current.refreshUser()]);
  }, []);
  const refresh = useCallback(async () => {
    if (!user?.id) return false;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++generation.current;
    setLoading(true);
    try {
      const response = await apiClient.get<{ success: boolean; data: DashboardReport }>(`/reporting/dashboard?${queryString}`, { signal: request.signal });
      if (generation.current !== current || activeKey.current !== key) return false;
      setState({ key, report: response.data, error: null });
      return true;
    } catch (error) {
      if (generation.current !== current || activeKey.current !== key || request.signal.aborted) return false;
      const err = error as ApiRequestError;
      if (err.status === 401 || err.status === 403) resetAccess();
      else setState(previous => ({ key, report: previous.key === key ? previous.report : null, error: err.message || 'Dashboard could not load.' }));
      setConnection('stale');
      return false;
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [user?.id, key, queryString, resetAccess]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    setState({ key, report: null, error: null });
    void refresh();
    return () => { generation.current++; controller.current?.abort(); };
  }, [key, refresh]);

  useEffect(() => {
    if (!user?.id) return;
    let stopped = false, heartbeat = 0;
    let batch: ReturnType<typeof setTimeout> | undefined;
    let accessRevision: string | undefined;
    let previousRevision = '';
    const schedule = () => {
      if (stopped || batch) return;
      batch = setTimeout(() => { batch = undefined; if (!stopped) void refreshRef.current(); }, 150);
    };
    const stream = new EventSource('/api/proxy/reporting/dashboard/events');
    const changed = (event: MessageEvent) => {
      try {
        const counters = JSON.parse(event.data) as { access: string };
        if (accessRevision !== undefined && accessRevision !== counters.access) resetAccess();
        accessRevision = counters.access;
        heartbeat = Date.now();
        setConnection('live');
        if (event.data !== previousRevision) { previousRevision = event.data; schedule(); }
      } catch { setConnection('stale'); }
    };
    stream.addEventListener('dashboard-change', changed as EventListener);
    stream.addEventListener('dashboard-heartbeat', () => { heartbeat = Date.now(); setConnection('live'); });
    stream.addEventListener('dashboard-unavailable', () => setConnection('stale'));
    stream.addEventListener('dashboard-access-changed', () => { resetAccess(); setConnection('stale'); stream.close(); schedule(); });
    stream.onopen = () => { previousRevision = ''; setConnection('connecting'); schedule(); };
    stream.onerror = () => { setConnection('stale'); };
    const wake = () => {
      if (document.visibilityState !== 'hidden') { setConnection('connecting'); schedule(); }
    };
    window.addEventListener('online', wake);
    const offline = () => setConnection('stale');
    window.addEventListener('offline', offline);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    const unsubscribe = subscribePageCacheInvalidation(module => {
      if (['reports', 'tasks', 'leads', 'deals', 'pipeline'].includes(module)) schedule();
    });
    // Bounded foreground reconciliation also handles clock rollover and missed
    // events. It never claims a broken event connection is current.
    const fallback = setInterval(() => {
      if (!heartbeat || Date.now() - heartbeat > 12000) setConnection('stale');
      if (document.visibilityState !== 'hidden') schedule();
    }, 30000);
    return () => {
      stopped = true; stream.close(); unsubscribe(); clearInterval(fallback);
      if (batch) clearTimeout(batch);
      window.removeEventListener('online', wake); window.removeEventListener('focus', wake);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [identity, user?.id, resetAccess]);
  return { report: state.key === key ? state.report : null, error: state.key === key ? state.error : null, loading, connection, refresh };
}

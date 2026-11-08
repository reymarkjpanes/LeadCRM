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
  if (query.leadSourceRange) params.set('leadSourceRange', query.leadSourceRange);
  if (query.leadSourceRange === 'custom') {
    if (query.leadSourceStart) params.set('leadSourceStart', query.leadSourceStart);
    if (query.leadSourceEnd) params.set('leadSourceEnd', query.leadSourceEnd);
  }
  return params.toString();
}

export function useDashboard(query: DashboardQuery) {
  const { user, tenant, refreshPermissions, refreshUser } = useAuth();
  const identity = `${tenant?.id ?? user?.tenantId ?? ''}:${user?.id ?? ''}:${user?.role ?? ''}`;
  const queryString = dashboardQueryString(query);
  const key = `${identity}:${queryString}`;
  const baseKey = `${identity}:${dashboardQueryString({ ...query, leadSourceRange: undefined, leadSourceStart: undefined, leadSourceEnd: undefined })}`;
  const [state, setState] = useState<{ key: string; sourceKey: string; report: DashboardReport | null; error: string | null; sourceError: string | null }>({ key: baseKey, sourceKey: key, report: null, error: null, sourceError: null });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [loading, setLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'stale'>('connecting');
  const generation = useRef(0);
  const requestedRevision = useRef(0);
  const appliedRevision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const activeKey = useRef(key);
  activeKey.current = key;
  const activeBaseKey = useRef(baseKey);
  activeBaseKey.current = baseKey;
  const authActions = useRef({ refreshPermissions, refreshUser });
  authActions.current = { refreshPermissions, refreshUser };
  const resetAccess = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    setLoading(false);
    setSourceLoading(false);
    setState({ key: activeBaseKey.current, sourceKey: activeKey.current, report: null, error: 'Your reporting access changed. Try refreshing or contact your administrator.', sourceError: null });
    clearPageCache();
    void Promise.allSettled([authActions.current.refreshPermissions(), authActions.current.refreshUser()]);
  }, []);
  const refresh = useCallback(async (sourceOnly = false) => {
    if (!user?.id) return false;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++generation.current;
    // A source filter change can replace a full request, but must also apply
    // the updated KPIs if the previous full refresh has not succeeded yet.
    sourceOnly = sourceOnly && stateRef.current.key === baseKey && !!stateRef.current.report &&
      requestedRevision.current === appliedRevision.current;
    const revision = sourceOnly ? requestedRevision.current : ++requestedRevision.current;
    setLoading(!sourceOnly);
    setSourceLoading(true);
    setState(previous => ({ ...previous, sourceError: null }));
    try {
      const response = await apiClient.get<{ success: boolean; data: DashboardReport }>(`/reporting/dashboard?${queryString}`, { signal: request.signal });
      if (generation.current !== current || activeKey.current !== key) return false;
      if (!sourceOnly) appliedRevision.current = revision;
      setState(previous => {
        const sameAccess = previous.report?.scope === response.data.scope && previous.report?.access && response.data.access && (['deals', 'leads', 'tasks', 'leaderboard'] as const).every(module => previous.report!.access[module] === response.data.access[module]);
        const samePipeline = previous.report?.pipeline?.id === response.data.pipeline?.id &&
          (previous.report?.metrics.activeDeals === null) === (response.data.metrics.activeDeals === null);
        return { key: baseKey, sourceKey: key,
          report: sourceOnly && previous.key === baseKey && sameAccess && samePipeline ? {
            ...previous.report!, leadSourcePerformance: response.data.leadSourcePerformance,
            actions: response.data.actions, pendingActions: response.data.pendingActions,
          } : response.data,
          error: sourceOnly && sameAccess ? previous.error : null, sourceError: null };
      });
      return true;
    } catch (error) {
      if (generation.current !== current || activeKey.current !== key || request.signal.aborted) return false;
      const err = error as ApiRequestError;
      if (err.status === 401 || err.status === 403) resetAccess();
      else setState(previous => sourceOnly && previous.key === baseKey && previous.report
        ? { ...previous, sourceKey: key, report: { ...previous.report, leadSourcePerformance: null }, sourceError: err.message || 'Lead Source Performance could not load.' }
        : { key: baseKey, sourceKey: key, report: previous.key === baseKey ? previous.report : null, error: err.message || 'Dashboard could not load.', sourceError: null });
      setConnection('stale');
      return false;
    } finally {
      if (generation.current === current) { setLoading(false); setSourceLoading(false); }
    }
  }, [user?.id, key, baseKey, queryString, resetAccess]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const sourceOnly = stateRef.current.key === baseKey && !!stateRef.current.report;
    if (!sourceOnly) setState({ key: baseKey, sourceKey: key, report: null, error: null, sourceError: null });
    void refresh(sourceOnly);
    return () => { generation.current++; controller.current?.abort(); };
  }, [key, baseKey, refresh]);

  useEffect(() => {
    if (!user?.id) return;
    let stopped = false, heartbeat = 0;
    let batch: ReturnType<typeof setTimeout> | undefined;
    let accessRevision: string | undefined;
    let previousRevision = '';
    const schedule = () => {
      if (stopped) return;
      requestedRevision.current++;
      if (batch) return;
      batch = setTimeout(() => {
        batch = undefined;
        if (!stopped && requestedRevision.current !== appliedRevision.current) void refreshRef.current();
      }, 150);
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
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', restore);
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
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [identity, user?.id, resetAccess]);
  const report = state.key === baseKey ? state.report : null;
  return {
    report: report && state.sourceKey !== key ? { ...report, leadSourcePerformance: null } : report,
    error: state.key === baseKey ? state.error : null,
    sourceError: state.key === baseKey && state.sourceKey === key ? state.sourceError : null,
    sourceLoading: sourceLoading || (!!report && state.sourceKey !== key), loading, connection, refresh,
  };
}

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDashboard, dashboardQueryString } from './use-dashboard-report';
import { invalidateApiPageCache } from '@/shared/cache/invalidate-api-page-cache';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), permissions: vi.fn(async () => {}), user: vi.fn(async () => {}), clear: vi.fn(),
  auth: { user: { id: 'a', tenantId: 'tenant-a', role: 'Sales' }, tenant: { id: 'tenant-a' } },
}));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ ...mocks.auth, refreshPermissions: mocks.permissions, refreshUser: mocks.user }) }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/shared/cache/page-cache', async importOriginal => ({
  ...await importOriginal<typeof import('@/shared/cache/page-cache')>(),
  clearPageCache: mocks.clear,
}));
class Feed extends EventTarget {
  static instances: Feed[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { super(); Feed.instances.push(this); }
  close() { this.closed = true; }
  emit(type: string, data: unknown = {}) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
}
beforeEach(() => {
  vi.clearAllMocks(); Feed.instances = []; vi.stubGlobal('EventSource', Feed);
  mocks.auth = { user: { id: 'a', tenantId: 'tenant-a', role: 'Sales' }, tenant: { id: 'tenant-a' } };
  mocks.get.mockResolvedValue({ success: true, data: { generatedAt: 'new', metrics: { totalRevenue: 1 } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('loads backend analytics and batches duplicate notifications without local arithmetic', async () => {
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(1));
  expect(Feed.instances).toHaveLength(1);
  mocks.get.mockResolvedValue({ success: true, data: { metrics: { totalRevenue: 45000 } } });
  act(() => { Feed.instances[0].emit('dashboard-change', { access: '1' }); Feed.instances[0].emit('dashboard-change', { access: '1' }); });
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(45000));
  expect(mocks.get).toHaveBeenCalledTimes(2);
  hook.unmount(); expect(Feed.instances[0].closed).toBe(true);
});
it('reconciles current stage counts through the existing feed and manual refresh while retaining historical rates', async () => {
  const snapshot = (lead: number, contacted: number, qualified: number, currentWon: number) => ({
    distribution: [{ id: 'lead', count: lead }, { id: 'contacted', count: contacted }, { id: 'qualified', count: qualified }],
    metrics: { currentWon }, conversion: { leadToContacted: 20.8, contactedToQualified: 40, qualifiedToWon: 33.3 },
  });
  mocks.get.mockResolvedValueOnce({ success: true, data: snapshot(17, 1, 2, 1) });
  const hook = renderHook(() => useDashboard({ range: 'thisMonth', funnelRange: 'year' }));
  await waitFor(() => expect(hook.result.current.report?.distribution.map(stage => stage.count)).toEqual([17, 1, 2]));
  mocks.get.mockResolvedValueOnce({ success: true, data: snapshot(16, 2, 2, 1) });
  act(() => Feed.instances[0].emit('dashboard-change', { access: '1', analytics: '2' }));
  await waitFor(() => expect(hook.result.current.report?.distribution.map(stage => stage.count)).toEqual([16, 2, 2]));
  mocks.get.mockResolvedValueOnce({ success: true, data: snapshot(16, 2, 1, 2) });
  await act(async () => { expect(await hook.result.current.refresh()).toBe(true); });
  expect(hook.result.current.report?.metrics.currentWon).toBe(2);
  expect(hook.result.current.report?.distribution.map(stage => stage.count)).toEqual([16, 2, 1]);
  expect(hook.result.current.report?.conversion?.contactedToQualified).toBe(40);
  expect(Feed.instances).toHaveLength(1);
});
it('refreshes stale Deal actions when the browser restores the Dashboard', async () => {
  const actions = [{ id: 'existing-deal', kind: 'deal', href: '/crm/deals/existing-deal' }];
  const metrics = { activeDeals: 1 };
  mocks.get.mockResolvedValueOnce({ data: { metrics, actions, pendingActions: 1 } });
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report?.actions).toEqual(actions));
  mocks.get.mockResolvedValueOnce({ data: { metrics, actions: [], pendingActions: 0 } });
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await waitFor(() => expect(hook.result.current.report).toMatchObject({ actions: [], pendingActions: 0 }));
  expect(Feed.instances).toHaveLength(1);
});
it('refreshes the authoritative Qualified forecast through existing analytics events and Sync Metrics', async () => {
  mocks.get.mockResolvedValueOnce({ data: { metrics: { forecastedRevenue: 37000, openPipelineValue: 249995 } } });
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report?.metrics.forecastedRevenue).toBe(37000));
  mocks.get.mockResolvedValueOnce({ data: { metrics: { forecastedRevenue: 57000, openPipelineValue: 249995 } } });
  act(() => Feed.instances[0].emit('dashboard-change', { access: '1', analytics: '2' }));
  await waitFor(() => expect(hook.result.current.report?.metrics.forecastedRevenue).toBe(57000));
  mocks.get.mockResolvedValueOnce({ data: { metrics: { forecastedRevenue: 37000, openPipelineValue: 249995 } } });
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.report?.metrics.forecastedRevenue).toBe(37000);
  expect(hook.result.current.report?.metrics.openPipelineValue).toBe(249995);
  expect(Feed.instances).toHaveLength(1);
});

it('clears permission-sensitive results before receiving new scope data', async () => {
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report).not.toBeNull());
  mocks.get.mockImplementation(() => new Promise(() => {}));
  act(() => Feed.instances[0].emit('dashboard-access-changed'));
  expect(hook.result.current.report).toBeNull(); expect(mocks.clear).toHaveBeenCalled();
  expect(mocks.permissions).toHaveBeenCalled(); expect(mocks.user).toHaveBeenCalled();
});
it('does not turn failed requests into a zero-valued report', async () => {
  mocks.get.mockRejectedValue(new Error('Database unavailable'));
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.error).toBe('Database unavailable'));
  expect(hook.result.current.report).toBeNull(); expect(hook.result.current.connection).toBe('stale');
});
it('preserves the last authoritative report on a failed refresh', async () => {
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(1));
  mocks.get.mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => { expect(await hook.result.current.refresh()).toBe(false); });
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(1);
  expect(hook.result.current.error).toBe('Refresh failed');
});
it('accepts only the latest of rapid refresh responses', async () => {
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report).not.toBeNull());
  let resolveOld: (value: unknown) => void = () => {};
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  let old: Promise<boolean>;
  act(() => { old = hook.result.current.refresh(); });
  mocks.get.mockResolvedValueOnce({ success: true, data: { metrics: { totalRevenue: 2 } } });
  await act(async () => { expect(await hook.result.current.refresh()).toBe(true); });
  await act(async () => { resolveOld({ success: true, data: { metrics: { totalRevenue: 999 } } }); expect(await old!).toBe(false); });
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(2);
});
it('marks disconnections stale and reconciles committed data on reconnection', async () => {
  const hook = renderHook(() => useDashboard({ range: 'thisMonth' }));
  await waitFor(() => expect(hook.result.current.report).not.toBeNull());
  act(() => Feed.instances[0].onerror?.()); expect(hook.result.current.connection).toBe('stale');
  mocks.get.mockResolvedValue({ success: true, data: { metrics: { totalRevenue: 2 } } });
  act(() => { Feed.instances[0].onopen?.(); Feed.instances[0].emit('dashboard-heartbeat'); });
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(2));
  expect(hook.result.current.connection).toBe('live');
});
it('isolates identity and filters and prevents a late old request replacing new data', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const hook = renderHook(({ range }: { range: 'today' | 'last7' }) => useDashboard({ range }), { initialProps: { range: 'today' } });
  mocks.auth = { user: { id: 'b', tenantId: 'tenant-b', role: 'Sales' }, tenant: { id: 'tenant-b' } };
  hook.rerender({ range: 'last7' });
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(1));
  act(() => resolveOld({ success: true, data: { metrics: { totalRevenue: 999999 } } }));
  await act(async () => {});
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(1);
  expect(mocks.get.mock.calls.at(-1)?.[0]).toContain('range=last7'); expect(Feed.instances[0].closed).toBe(true);
});
it('preserves independent chart filters in requests and exports without creating another subscription', async () => {
  const query = { range: 'last7' as const, revenueInterval: 'week' as const, funnelRange: 'custom' as const, funnelStart: '2020-01-01', funnelEnd: '2020-01-10' };
  expect(dashboardQueryString(query)).toBe('range=last7&revenueInterval=week&funnelRange=custom&funnelStart=2020-01-01&funnelEnd=2020-01-10');
  const hook = renderHook(({ interval }: { interval: 'week' | 'year' }) => useDashboard({ ...query, revenueInterval: interval }), { initialProps: { interval: 'week' } });
  await waitFor(() => expect(hook.result.current.report).not.toBeNull());
  hook.rerender({ interval: 'year' });
  await waitFor(() => expect(mocks.get.mock.calls.at(-1)?.[0]).toContain('revenueInterval=year'));
  expect(Feed.instances).toHaveLength(1);
  expect(mocks.get.mock.calls.at(-1)?.[0]).toContain('funnelEnd=2020-01-10');
});

const sourceSnapshot = (won: number, revenue = 45000) => ({
  access: { deals: true, leads: true, tasks: true, leaderboard: true }, metrics: { totalRevenue: revenue },
  distribution: [{ id: 'lead', count: 17 }],
  leadSourcePerformance: { period: { start: '2020-01-01', end: '2020-01-15', timezone: 'Asia/Manila' }, sources: [{ name: 'Referral', won }] },
});

it.each(['queued', 'in flight'] as const)('preserves a %s full refresh when Lead Source dates change', async timing => {
  vi.useFakeTimers();
  mocks.get.mockResolvedValueOnce({ data: sourceSnapshot(12) });
  const hook = renderHook(({ range }: { range: 'thisMonth' | 'lastMonth' }) => useDashboard({ range: 'thisMonth', leadSourceRange: range }), { initialProps: { range: 'thisMonth' } });
  await act(async () => {});
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(45000);

  act(() => {
    if (timing === 'queued') invalidateApiPageCache('/crm/deals/deal-id/stage');
    else Feed.instances[0].emit('dashboard-change', { access: '1', analytics: '2' });
  });
  let finishOld: (response: unknown) => void = () => {};
  if (timing === 'in flight') {
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  }

  mocks.get.mockResolvedValueOnce({ data: sourceSnapshot(3, 46000) });
  hook.rerender({ range: 'lastMonth' });
  await act(async () => {});
  expect(mocks.get.mock.calls.at(-1)?.[0]).toContain('range=thisMonth&leadSourceRange=lastMonth');
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(46000);
  expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(3);
  if (timing === 'in flight') expect(mocks.get.mock.calls[1][1].signal.aborted).toBe(true);

  await act(async () => {
    finishOld({ data: sourceSnapshot(99, 99999) });
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(mocks.get).toHaveBeenCalledTimes(timing === 'queued' ? 2 : 3);
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(46000);
  expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(3);
  expect(Feed.instances).toHaveLength(1);
});

it('keeps a failed full refresh pending for the next source filter request', async () => {
  mocks.get.mockResolvedValueOnce({ data: sourceSnapshot(12) });
  const hook = renderHook(({ range }: { range: 'thisMonth' | 'lastMonth' }) => useDashboard({ range: 'thisMonth', leadSourceRange: range }), { initialProps: { range: 'thisMonth' } });
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(45000));
  mocks.get.mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => { expect(await hook.result.current.refresh()).toBe(false); });
  mocks.get.mockResolvedValueOnce({ data: sourceSnapshot(3, 46000) });
  hook.rerender({ range: 'lastMonth' });
  await waitFor(() => expect(hook.result.current.report?.metrics.totalRevenue).toBe(46000));
  expect(hook.result.current.error).toBeNull();
});

it('serializes independent source dates and updates only the source chart on a range change', async () => {
  expect(dashboardQueryString({ range: 'thisMonth', leadSourceRange: 'custom', leadSourceStart: '2020-01-01', leadSourceEnd: '2020-01-02' })).toBe('range=thisMonth&leadSourceRange=custom&leadSourceStart=2020-01-01&leadSourceEnd=2020-01-02');
  mocks.get.mockResolvedValue({ success: true, data: sourceSnapshot(12) });
  const hook = renderHook(({ range }: { range: 'thisMonth' | 'lastMonth' }) => useDashboard({ range: 'thisMonth', leadSourceRange: range }), { initialProps: { range: 'thisMonth' } });
  await waitFor(() => expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(12));
  let finish: (response: unknown) => void = () => {};
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  hook.rerender({ range: 'lastMonth' });
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(45000);
  expect(hook.result.current.report?.distribution[0].count).toBe(17);
  expect(hook.result.current.report?.leadSourcePerformance).toBeNull();
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.sourceLoading).toBe(true);
  await act(async () => finish({ success: true, data: sourceSnapshot(3, 99999) }));
  expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(3);
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(45000);
  expect(Feed.instances).toHaveLength(1);
  mocks.get.mockResolvedValueOnce({ success: true, data: sourceSnapshot(4, 46000) });
  act(() => Feed.instances[0].emit('dashboard-change', { access: '1', analytics: '2' }));
  await waitFor(() => expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(4));
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(46000);
});
it('keeps source errors local, retries, and discards late source-filter responses', async () => {
  mocks.get.mockResolvedValue({ success: true, data: sourceSnapshot(12) });
  const hook = renderHook(({ range }: { range: 'thisMonth' | 'lastMonth' | 'today' }) => useDashboard({ range: 'thisMonth', leadSourceRange: range }), { initialProps: { range: 'thisMonth' } });
  await waitFor(() => expect(hook.result.current.report).not.toBeNull());
  mocks.get.mockRejectedValueOnce(new Error('Source unavailable'));
  hook.rerender({ range: 'lastMonth' });
  await waitFor(() => expect(hook.result.current.sourceError).toBe('Source unavailable'));
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.report?.metrics.totalRevenue).toBe(45000);
  expect(hook.result.current.report?.leadSourcePerformance).toBeNull();
  mocks.get.mockResolvedValueOnce({ success: true, data: sourceSnapshot(2) });
  await act(async () => { await hook.result.current.refresh(true); });
  expect(hook.result.current.sourceError).toBeNull();
  let late: (response: unknown) => void = () => {};
  mocks.get.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  hook.rerender({ range: 'today' });
  mocks.get.mockResolvedValueOnce({ success: true, data: sourceSnapshot(7) });
  hook.rerender({ range: 'thisMonth' });
  await waitFor(() => expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(7));
  await act(async () => late({ success: true, data: sourceSnapshot(999) }));
  expect(hook.result.current.report?.leadSourcePerformance?.sources[0].won).toBe(7);
  mocks.get.mockRejectedValueOnce({ status: 403 });
  await act(async () => { await hook.result.current.refresh(true); });
  expect(hook.result.current.report).toBeNull();
  expect(mocks.permissions).toHaveBeenCalled();
});

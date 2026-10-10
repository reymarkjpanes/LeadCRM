import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDashboard, dashboardQueryString } from './use-dashboard-report';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), permissions: vi.fn(async () => {}), user: vi.fn(async () => {}), clear: vi.fn(),
  auth: { user: { id: 'a', tenantId: 'tenant-a', role: 'Sales' }, tenant: { id: 'tenant-a' } },
}));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ ...mocks.auth, refreshPermissions: mocks.permissions, refreshUser: mocks.user }) }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/shared/cache/page-cache', () => ({ clearPageCache: mocks.clear, subscribePageCacheInvalidation: () => () => {} }));
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModuleData } from '../use-module-data';
import { useCachedPage } from '../use-cached-page';
import { useModuleCounts } from '../use-module-counts';
import { clearPageCache, getPageCacheSize, invalidatePageCache } from '@/shared/cache/page-cache';

const mocks = vi.hoisted(() => ({
  auth: { isLoading: false, authError: null as string | null, tenant: { id: 'tenant-a' }, user: { id: 'user-a', role: 'Sales Rep' } },
  get: vi.fn(),
}));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (page: number) => ({
  data: [{ id: `page-${page}` }],
  meta: { page, pageSize: 25, total: 80, totalPages: 4 },
});

beforeEach(() => {
  clearPageCache();
  mocks.get.mockReset();
  mocks.auth = { isLoading: false, authError: null, tenant: { id: 'tenant-a' }, user: { id: 'user-a', role: 'Sales Rep' } };
});
afterEach(() => { cleanup(); clearPageCache(); });

describe('real cached request lifecycle', () => {
  it.each(['leads', 'contacts', 'accounts'])('refreshes an open %s table when a panel mutation invalidates it', async moduleId => {
    mocks.get.mockResolvedValueOnce(response(1));
    const hook = renderHook(() => useModuleData({ moduleId, page: 1, pageSize: 25 }));
    await waitFor(() => expect(hook.result.current.data).toEqual(response(1).data));
    mocks.get.mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, limit: 25 } });
    act(() => invalidatePageCache(moduleId, 'tenant-a'));
    await waitFor(() => expect(hook.result.current.meta?.total).toBe(0));
    expect(hook.result.current.data).toEqual([]);
  });
  it('aborts old queries and cannot cache a late page under the new page key', async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    mocks.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderHook(({ page }) => useModuleData({ moduleId: 'leads', page, pageSize: 25 }), { initialProps: { page: 1 } });
    const firstSignal = mocks.get.mock.calls[0][1].signal;
    hook.rerender({ page: 2 });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { second.resolve(response(2)); });
    await act(async () => { first.resolve(response(1)); });
    expect(hook.result.current.data).toEqual(response(2).data);
    hook.unmount();
    mocks.get.mockReturnValue(new Promise(() => {}));
    const cached = renderHook(() => useModuleData({ moduleId: 'leads', page: 2, pageSize: 25 }));
    expect(cached.result.current.data).toEqual(response(2).data);
    expect(cached.result.current.meta?.total).toBe(80);
    expect(cached.result.current.isInitialLoad).toBe(false);
  });

  it('does not copy loaded results into a new filter key before its request completes', async () => {
    mocks.get.mockResolvedValueOnce(response(1));
    const hook = renderHook(({ search }) => useModuleData({ moduleId: 'accounts', page: 1, pageSize: 25, search }), { initialProps: { search: 'first' } });
    await waitFor(() => expect(hook.result.current.meta?.total).toBe(80));
    mocks.get.mockReturnValue(new Promise(() => {}));
    hook.rerender({ search: 'second' });
    expect(hook.result.current.data).toEqual([]);
    hook.unmount();
    const next = renderHook(() => useModuleData({ moduleId: 'accounts', page: 1, pageSize: 25, search: 'second' }));
    expect(next.result.current.isInitialLoad).toBe(true);
    expect(getPageCacheSize()).toBe(1);
  });

  it.each(['logout', 'mutation', 'unmount'])('blocks cache resurrection after %s', async (action) => {
    const pending = deferred<string[]>();
    const hook = renderHook(() => useCachedPage({ module: 'contacts', params: {}, fetchFn: () => pending.promise }));
    if (action === 'logout') clearPageCache();
    if (action === 'mutation') invalidatePageCache('contacts', 'tenant-a');
    if (action === 'unmount') hook.unmount();
    await act(async () => { pending.resolve(['old-contact']); });
    expect(getPageCacheSize()).toBe(0);
    if (action !== 'unmount') expect(hook.result.current.data).toBeUndefined();
  });

  it.each(['tenant', 'user'])('never renders another %s scope while its request is pending', async (change) => {
    const fetchFn = vi.fn().mockResolvedValueOnce(['private-data']);
    const hook = renderHook(() => useCachedPage({ module: 'invoices', params: {}, fetchFn }));
    await waitFor(() => expect(hook.result.current.data).toEqual(['private-data']));
    fetchFn.mockReturnValue(new Promise(() => {}));
    if (change === 'tenant') mocks.auth.tenant = { id: 'tenant-b' };
    else mocks.auth.user = { id: 'user-b', role: 'Sales Rep' };
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    expect(hook.result.current.isInitialLoad).toBe(true);
  });

  it('keeps good rows on a failed background refresh, but clears them after access is denied', async () => {
    const fetchFn = vi.fn().mockResolvedValue(['good-row']);
    const hook = renderHook(() => useCachedPage({ module: 'contacts', params: {}, fetchFn }));
    await waitFor(() => expect(hook.result.current.data).toEqual(['good-row']));
    fetchFn.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await hook.result.current.refetch(); });
    expect(hook.result.current.data).toEqual(['good-row']);
    expect(hook.result.current.error).toBe('offline');
    fetchFn.mockRejectedValueOnce(Object.assign(new Error('Access denied'), { status: 403 }));
    await act(async () => { await hook.result.current.refetch(); });
    expect(hook.result.current.data).toBeUndefined();
    expect(getPageCacheSize()).toBe(0);
  });

  it('preserves loading state until the newest refresh finishes', async () => {
    const old = deferred<string[]>();
    const latest = deferred<string[]>();
    const fetchFn = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const hook = renderHook(() => useCachedPage({ module: 'contacts', params: {}, fetchFn }));
    act(() => { void hook.result.current.refetch(); });
    await act(async () => { old.reject(new Error('obsolete error')); });
    expect(hook.result.current.isInitialLoad).toBe(true);
    expect(hook.result.current.error).toBeNull();
    await act(async () => { latest.resolve(['latest']); });
    expect(hook.result.current.data).toEqual(['latest']);
  });

  it('does not fetch when disabled or when signed out', () => {
    const fetchFn = vi.fn();
    renderHook(() => useCachedPage({ module: 'contacts', params: {}, fetchFn, disabled: true }));
    mocks.auth.user = { id: '', role: '' };
    renderHook(() => useCachedPage({ module: 'contacts', params: {}, fetchFn }));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('scopes sidebar counts to the current tenant and ignores its previous pending request', async () => {
    const old = deferred<{ meta: { total: number } }>();
    mocks.get.mockReturnValueOnce(old.promise);
    const hook = renderHook(() => useModuleCounts(['leads']));
    mocks.auth.tenant = { id: 'tenant-b' };
    mocks.get.mockResolvedValueOnce({ meta: { total: 2 } });
    hook.rerender();
    await waitFor(() => expect(hook.result.current.counts.leads).toBe(2));
    await act(async () => { old.resolve({ meta: { total: 999 } }); });
    expect(hook.result.current.counts.leads).toBe(2);
  });

  it('keeps permitted sidebar counts when another module denies access', async () => {
    mocks.get.mockImplementation(async (path) => {
      if (path === '/crm/leads') throw Object.assign(new Error('Access denied'), { status: 403 });
      return { meta: { total: 7 } };
    });
    const hook = renderHook(() => useModuleCounts(['leads', 'accounts']));
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.counts).toEqual({ leads: 0, accounts: 7 });
  });
});

it.each(['leads', 'accounts', 'deals'])('loads a selected %s by ID independently of stale text filters and pagination', async moduleId => {
  mocks.get.mockResolvedValue({ data: { id: 'selected', firstName: 'Johnny', isArchived: false } });
  const hook = renderHook(() => useModuleData({ moduleId, page: 8, pageSize: 25, search: 'wrong name', filter: [{ field: 'status', operator: 'equals', value: 'COLD' }], recordId: 'selected' }));
  await waitFor(() => expect(hook.result.current.data[0]?.id).toBe('selected'));
  expect(mocks.get).toHaveBeenCalledWith(`/crm/${moduleId}/selected`, { signal: expect.any(AbortSignal) });
  expect(hook.result.current.meta).toMatchObject({ page: 1, total: 1 });
});


it('waits for auth initialization even when a previous user remains in context', async () => {
  mocks.auth.isLoading = true;
  mocks.get.mockResolvedValue(response(1));
  const hook = renderHook(() => useModuleData({ moduleId: 'leads', page: 1, pageSize: 25 }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(mocks.get).not.toHaveBeenCalled();
  mocks.auth.isLoading = false;
  mocks.auth.authError = 'Session restore unavailable';
  hook.rerender();
  expect(mocks.get).not.toHaveBeenCalled();
  mocks.auth.authError = null;
  hook.rerender();
  await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
});

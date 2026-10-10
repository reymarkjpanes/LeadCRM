import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useModuleCounts } from '../use-module-counts';
import { clearPageCache } from '@/shared/cache/page-cache';
import { invalidateApiPageCache } from '@/shared/cache/invalidate-api-page-cache';
const mocks = vi.hoisted(() => ({
  auth: { tenant: { id: 'a' }, user: { id: 'user', role: 'Client Admin', } },
  get: vi.fn(),
}));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
beforeEach(() => {
  clearPageCache(); mocks.get.mockReset();
  mocks.auth = { tenant: { id: 'a' }, user: { id: 'user', role: 'Client Admin', } };
  mocks.get.mockImplementation(async (path: string) => ({ data: [], meta: { total: path === '/crm/leads' ? 3 : path === '/crm/contacts' ? 5 : 7 } }));
});
afterEach(() => { cleanup(); clearPageCache(); });
it('fetches independent API totals and uses the Contact page service pagination', async () => {
  const hook = renderHook(() => useModuleCounts(['leads', 'contacts', 'accounts', 'deals']));
  await waitFor(() => expect(hook.result.current.counts).toEqual({ leads: 3, contacts: 5, accounts: 7, deals: 7 }));
  expect(mocks.get).toHaveBeenCalledWith('/crm/contacts', expect.objectContaining({ params: { page: 1, limit: 1 } }));
});
it.each(['tenant', 'user'])('clears stale totals and refetches on %s changes', async scope => {
  const hook = renderHook(() => useModuleCounts(['leads', 'contacts']));
  await waitFor(() => expect(hook.result.current.counts.contacts).toBe(5));
  mocks.get.mockImplementation(() => new Promise(() => {}));
  if (scope === 'tenant') mocks.auth.tenant.id = 'b';
  else mocks.auth.user.id = 'other-user';
  hook.rerender();
  expect(hook.result.current.counts).toEqual({ leads: 0, contacts: 0 });
  expect(mocks.get).toHaveBeenCalledTimes(4);
});
it.each(['leads', 'contacts'])('refreshes related customer counts after %s create/archive/delete', async module => {
  const hook = renderHook(() => useModuleCounts(['leads', 'contacts']));
  await waitFor(() => expect(hook.result.current.counts.contacts).toBe(5));
  for (const suffix of ['', '/record/archive', '/record']) {
    mocks.get.mockClear(); mocks.get.mockResolvedValue({ data: [], meta: { total: 0 } });
    await act(async () => invalidateApiPageCache(`/crm/${module}${suffix}`));
    await waitFor(() => expect(hook.result.current.counts[module]).toBe(0));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls.map(call => call[0]).sort()).toEqual(['/crm/contacts', '/crm/leads']);
  }
});
it('does not retry indefinitely after permission denial', async () => {
  mocks.get.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  const hook = renderHook(() => useModuleCounts(['contacts']));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(hook.result.current.counts.contacts).toBe(0);
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ permission: true, cache: vi.fn(), getAll: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ activities: [], users: [] }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user', tenantId: 'tenant', } }) }));
vi.mock('./use-permissions', () => ({ useHasPermission: () => mocks.permission }));
vi.mock('./use-cached-page', () => ({ useCachedPage: mocks.cache }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/features/tenant/crm/activities/services/activities.service', () => ({ activitiesService: { getAll: mocks.getAll } }));
import { useRecordActivities } from './use-record-activities';
beforeEach(() => { vi.resetAllMocks(); mocks.permission = true; mocks.cache.mockReturnValue({ data: [], refetch: vi.fn() }); });
afterEach(cleanup);
it.each([['leads', 'leadId'], ['accounts', 'accountId'], ['deals', 'dealId']] as const)('reads only activities linked to the selected %s record', async (module, key) => {
  mocks.getAll.mockResolvedValue({ data: [{ id: 'event' }] });
  renderHook(() => useRecordActivities(module, 'selected-record'));
  const signal = new AbortController().signal;
  await mocks.cache.mock.calls[0][0].fetchFn(signal);
  expect(mocks.getAll).toHaveBeenCalledExactlyOnceWith({ [key]: 'selected-record', limit: 100 }, signal);
});
it('reuses contact relationship history without another activity request', () => {
  const history = [{ id: 'event', title: 'Note', type: 'note', createdAt: '2026-09-21' }];
  const { result } = renderHook(() => useRecordActivities('contacts', 'contact', true, history));
  expect(mocks.cache.mock.calls[0][0].disabled).toBe(true);
  expect(result.current.activities).toBe(history);
  expect(mocks.getAll).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
});
it('withholds cached history and disables reads when permission is absent', () => {
  mocks.permission = false;
  mocks.cache.mockReturnValue({ data: [{ id: 'cached' }] });
  const { result } = renderHook(() => useRecordActivities('deals', 'deal'));
  expect(mocks.cache.mock.calls[0][0].disabled).toBe(true);
  expect(result.current.activities).toEqual([]);
});

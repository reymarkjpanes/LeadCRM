import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PH_MOBILE_ERROR, STAFF_PHONE_CONFLICT, CUSTOMER_PHONE_CONFLICT } from '@leadcrm/shared';
import { usePhoneAvailability } from './use-phone-availability';
const mocks = vi.hoisted(() => ({ get: vi.fn(), userId: 'staff' }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.userId, tenantId: 'tenant', role: 'Custom' } }) }));
beforeEach(() => { mocks.userId = 'staff'; mocks.get.mockReset().mockResolvedValue({ success: true, data: { available: true } }); });
afterEach(cleanup);

it('allows optional empty without a request and rejects malformed numbers', () => {
  const { result, rerender } = renderHook(({ phone }) => usePhoneAvailability(phone, 'leads'), { initialProps: { phone: '' } });
  expect(result.current.confirm('')).toBe(true); expect(mocks.get).not.toHaveBeenCalled();
  rerender({ phone: '+63912' });
  expect(result.current.blocked).toBe(true); expect(result.current.error).toBe(PH_MOBILE_ERROR);
  expect(mocks.get).not.toHaveBeenCalled();
});
it('uses the existing canonical number and confirms only the current verified draft', async () => {
  const { result } = renderHook(() => usePhoneAvailability('9171234567', 'contacts'));
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(mocks.get.mock.calls[0][0]).toBe('/crm/phone-availability');
  expect(mocks.get.mock.calls[0][1].params).toEqual({ module: 'contacts', phone: '+639171234567' });
  expect(result.current.confirm('+639171234567')).toBe(true);
  expect(result.current.confirm('+639181234567')).toBe(false);
});
it('shows the exact staff conflict and blocks submission', async () => {
  mocks.get.mockResolvedValue({ success: true, data: { available: false, reason: 'STAFF_PHONE_NOT_ALLOWED' } });
  const { result } = renderHook(() => usePhoneAvailability('+639171234567', 'leads'));
  await waitFor(() => expect(result.current.error).toBe(STAFF_PHONE_CONFLICT));
  expect(result.current.blocked).toBe(true); expect(result.current.confirm('+639171234567')).toBe(false);
});
it('debounces changes and ignores responses for an older number', async () => {
  let finish!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ phone }) => usePhoneAvailability(phone, 'leads'), { initialProps: { phone: '+639171234567' } });
  rerender({ phone: '+639181234567' });
  expect(result.current.blocked).toBe(true); expect(mocks.get).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ success: true, data: { available: false, reason: 'STAFF_PHONE_NOT_ALLOWED' } }); });
  expect(result.current.error).toBeUndefined();
  await waitFor(() => expect(result.current.confirm('+639181234567')).toBe(true), { timeout: 2000 });
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
it('blocks failed lookups, retries on blur and invalidates results on identity changes', async () => {
  mocks.get.mockRejectedValueOnce(new Error('offline'));
  const { result, rerender } = renderHook(() => usePhoneAvailability('+639171234567', 'contacts'));
  await waitFor(() => expect(result.current.error).toContain('Unable to verify'));
  expect(result.current.blocked).toBe(true);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.available).toBe(true));
  mocks.userId = 'different-staff'; rerender();
  expect(result.current.blocked).toBe(true);
  await waitFor(() => expect(result.current.available).toBe(true), { timeout: 2000 });
});
it('retains a save-time conflict until the number changes and ignores disabled lookups', async () => {
  const { result, rerender } = renderHook(({ phone, enabled }) => usePhoneAvailability(phone, 'leads', enabled), { initialProps: { phone: '+639171234567', enabled: true } });
  await waitFor(() => expect(result.current.available).toBe(true));
  act(() => result.current.reject()); expect(result.current.error).toBe(STAFF_PHONE_CONFLICT);
  rerender({ phone: '', enabled: true }); expect(result.current.confirm('')).toBe(true);
  rerender({ phone: '+639181234567', enabled: false }); expect(result.current.blocked).toBe(false);
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
it('maps customer conflicts and binds verification and late rejections to the edit record', async () => {
  const { result, rerender } = renderHook(({ id }) => usePhoneAvailability('9171234567', 'contacts', true, id), { initialProps: { id: 'first-record' } });
  await waitFor(() => expect(result.current.available).toBe(true));
  expect(mocks.get.mock.calls[0][1].params.excludeId).toBe('first-record');
  const old = result.current;
  mocks.get.mockResolvedValue({ success: true, data: { available: false, reason: 'CUSTOMER_PHONE_CONFLICT' } });
  rerender({ id: 'second-record' });
  expect(result.current.blocked).toBe(true);
  expect(old.confirm('9171234567')).toBe(false);
  act(() => { expect(old.reject('CUSTOMER_PHONE_CONFLICT')).toBe(false); });
  expect(result.current.error).toBeUndefined();
  await waitFor(() => expect(result.current.error).toBe(CUSTOMER_PHONE_CONFLICT), { timeout: 2000 });
  expect(mocks.get.mock.calls.at(-1)![1].params.excludeId).toBe('second-record');
  expect(result.current.confirm('9171234567')).toBe(false);
});

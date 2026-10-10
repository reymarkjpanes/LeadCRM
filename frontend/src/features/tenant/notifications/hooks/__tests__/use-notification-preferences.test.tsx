import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@leadcrm/shared';
import { useNotificationPreferences } from '../use-notification-preferences';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ auth: { tenant: { id: 'tenant' }, user: { id: 'first' } }, preferences: vi.fn(), savePreferences: vi.fn() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/shared/services/notifications.api', () => ({ notificationsApi: mocks }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.user.id = 'first';
  mocks.preferences.mockResolvedValue({ success: true, data: { ...DEFAULT_NOTIFICATION_PREFERENCES } });
});
afterEach(cleanup);
it('cannot overwrite saved preferences when the initial read fails', async () => {
  mocks.preferences.mockRejectedValueOnce(new Error('Offline'));
  const hook = renderHook(useNotificationPreferences);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.ready).toBe(false);
  act(() => hook.result.current.setInApp(false));
  await act(async () => hook.result.current.save());
  expect(mocks.savePreferences).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
});
it('loads persisted values and only confirms saves after server success', async () => {
  const hook = renderHook(useNotificationPreferences);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.dirty).toBe(false);
  act(() => hook.result.current.setInApp(false));
  mocks.savePreferences.mockRejectedValueOnce(new Error('Offline'));
  await act(async () => hook.result.current.save());
  expect(hook.result.current.dirty).toBe(true);
  expect(hook.result.current.error).toContain('could not be saved');
  expect(toast.success).not.toHaveBeenCalled();
  mocks.savePreferences.mockResolvedValue({ success: true, data: { ...DEFAULT_NOTIFICATION_PREFERENCES, inAppGeneral: false } });
  await act(async () => hook.result.current.save());
  expect(hook.result.current.dirty).toBe(false);
  expect(toast.success).toHaveBeenCalledTimes(1);
});
it('isolates preferences when a different user signs in and discards late responses', async () => {
  let finish!: (value: unknown) => void;
  mocks.preferences.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(useNotificationPreferences);
  mocks.auth.user.id = 'second'; hook.rerender();
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => finish({ success: true, data: { ...DEFAULT_NOTIFICATION_PREFERENCES, inAppGeneral: false } }));
  expect(hook.result.current.data.inAppGeneral).toBe(true);
});

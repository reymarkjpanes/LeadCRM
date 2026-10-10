import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNotificationRecordLink } from '../use-notification-record-link';
const mocks = vi.hoisted(() => ({ id: 'record-id', router: { replace: vi.fn() }, error: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => mocks.id }), useRouter: () => mocks.router }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
beforeEach(() => { vi.clearAllMocks(); mocks.id = 'record-id'; window.history.replaceState({}, '', '/notifications?campaignId=record-id&keep=yes'); });
afterEach(cleanup);
it('waits for permission, opens the fetched record and consumes only its own query parameter', async () => {
  const load = vi.fn().mockResolvedValue({ id: 'record-id' }), open = vi.fn();
  const hook = renderHook(({ enabled }) => useNotificationRecordLink('campaignId', 'tenant:user', enabled, load, open), { initialProps: { enabled: false } });
  expect(load).not.toHaveBeenCalled(); hook.rerender({ enabled: true });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ id: 'record-id' }));
  expect(mocks.router.replace).toHaveBeenCalledWith('/notifications?keep=yes', { scroll: false });
});
it('discards a destination response after the authenticated scope changes', async () => {
  let finish!: (row: unknown) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ id: 'new-record' });
  const open = vi.fn();
  const hook = renderHook(({ scope }) => useNotificationRecordLink('campaignId', scope, true, load, open), { initialProps: { scope: 'first' } });
  hook.rerender({ scope: 'second' });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ id: 'new-record' }));
  await act(async () => finish({ id: 'private-old-record' }));
  expect(open).toHaveBeenCalledTimes(1);
});
it('keeps the current page and reports an unavailable destination', async () => {
  const open = vi.fn();
  renderHook(() => useNotificationRecordLink('campaignId', 'scope', true, vi.fn().mockRejectedValue(new Error('denied')), open));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(open).not.toHaveBeenCalled(); expect(mocks.router.replace).not.toHaveBeenCalled();
});
it('does not send malformed external destinations to a record API', () => {
  mocks.id = 'https://outside.example/path'; const load = vi.fn();
  renderHook(() => useNotificationRecordLink('campaignId', 'scope', true, load, vi.fn()));
  expect(load).not.toHaveBeenCalled();
});

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNotifications } from '../use-notifications';
import { clearPageCache } from '@/shared/cache/page-cache';

const mocks = vi.hoisted(() => ({
  auth: { tenant: { id: 'tenant-a' }, user: { id: 'user-a', role: 'Sales Rep' } },
  list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(),
}));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/shared/services/notifications.api', () => ({ notificationsApi: mocks }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const read = new Set<string>();
const response = (page: number) => ({ data: [{ id: `n${page}`, isRead: read.has(`n${page}`) }], unreadCount: 30 - read.size, meta: { hasMore: page < 3 } });
beforeEach(() => {
  read.clear();
  clearPageCache();
  mocks.auth.user.id = 'user-a';
  mocks.list.mockReset().mockImplementation(async ({ page }) => response(page));
  mocks.markRead.mockImplementation(async (id: string) => { read.add(id); return { success: true }; });
  mocks.markAllRead.mockResolvedValue({ success: true });
});
afterEach(() => { cleanup(); clearPageCache(); });

it('appends three pages without dropping the previous pages', async () => {
  const hook = renderHook(useNotifications);
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  act(() => hook.result.current.loadMore());
  await waitFor(() => expect(hook.result.current.page).toBe(2));
  act(() => hook.result.current.loadMore());
  await waitFor(() => expect(hook.result.current.page).toBe(3));
  expect(hook.result.current.notifications.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
  expect(hook.result.current.unreadCount).toBe(30);
  await act(async () => { await hook.result.current.markAsRead('n1'); });
  await act(async () => { await hook.result.current.markAsRead('n1'); });
  expect(hook.result.current.unreadCount).toBe(29);
  expect(hook.result.current.notifications.map(n => n.id)).toEqual(['n1', 'n2', 'n3']);
});

it('does not show another user notifications within the same tenant', async () => {
  const hook = renderHook(useNotifications);
  await waitFor(() => expect(hook.result.current.notifications).toHaveLength(1));
  mocks.auth.user.id = 'user-b';
  mocks.list.mockReturnValue(new Promise(() => {}));
  hook.rerender();
  expect(hook.result.current.notifications).toEqual([]);
});

it('restores page-one pagination metadata on return navigation', async () => {
  const hook = renderHook(useNotifications);
  await waitFor(() => expect(hook.result.current.hasMore).toBe(true));
  hook.unmount();
  mocks.list.mockReturnValue(new Promise(() => {}));
  const next = renderHook(useNotifications);
  expect(next.result.current.notifications).toHaveLength(1);
  expect(next.result.current.hasMore).toBe(true);
});

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNotifications } from '../use-notifications';
import { clearPageCache } from '@/shared/cache/page-cache';

const mocks = vi.hoisted(() => ({
  auth: { tenant: { id: 'tenant-a' }, user: { id: 'user-a', role: 'Sales Rep' } },
  list: vi.fn(), counts: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/shared/services/notifications.api', () => ({ notificationsApi: mocks }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const read = new Set<string>();
const response = (page: number) => ({ data: [{ id: `n${page}`, isRead: read.has(`n${page}`) }], unreadCount: 30 - read.size, totalCount: 30, meta: { hasMore: page < 3 } });
beforeEach(() => {
  read.clear();
  clearPageCache();
  mocks.auth.user.id = 'user-a';
  mocks.list.mockReset().mockImplementation(async ({ page }) => response(page));
  mocks.counts.mockImplementation(async () => ({ success: true, unreadCount: 30 - read.size, totalCount: 30 }));
  mocks.markRead.mockImplementation(async (id: string) => { read.add(id); return { success: true, totalCount: 30, unreadCount: 30 - read.size }; });
  mocks.markAllRead.mockResolvedValue({ success: true, totalCount: 30, unreadCount: 0 });
  mocks.delete.mockReset();
});

it('filters on the server and immediately updates the bell and unread view only after success', async () => {
  const unread = renderHook(() => useNotifications('unread'));
  const bell = renderHook(() => useNotifications());
  await waitFor(() => expect(unread.result.current.isLoading).toBe(false));
  await waitFor(() => expect(bell.result.current.isLoading).toBe(false));
  expect(mocks.list).toHaveBeenCalledWith({ page: 1, limit: 20, isRead: false });
  mocks.list.mockReturnValue(new Promise(() => {}));
  await act(async () => { await unread.result.current.markAsRead('n1'); });
  expect(unread.result.current.notifications).toEqual([]);
  expect(bell.result.current.unreadCount).toBe(29);
  expect(bell.result.current.notifications[0].isRead).toBe(true);
});

it('keeps failed deletions intact and broadcasts committed deletes to every mounted consumer', async () => {
  const page = renderHook(useNotifications), bell = renderHook(useNotifications);
  await waitFor(() => expect(page.result.current.notifications).toHaveLength(1));
  await waitFor(() => expect(bell.result.current.notifications).toHaveLength(1));
  mocks.delete.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => { expect(await page.result.current.deleteNotifications(['n1'])).toBe(false); });
  expect(page.result.current.notifications).toHaveLength(1);
  expect(bell.result.current.unreadCount).toBe(30);
  mocks.list.mockReturnValue(new Promise(() => {}));
  mocks.delete.mockResolvedValue({ success: true, totalCount: 29, unreadCount: 29 });
  await act(async () => { expect(await page.result.current.deleteNotifications(['n1'])).toBe(true); });
  expect(page.result.current.notifications).toEqual([]);
  expect(bell.result.current.notifications).toEqual([]);
  expect(bell.result.current.totalCount).toBe(29);
  expect(bell.result.current.unreadCount).toBe(29);
});

it('refreshes loaded pages without retaining deleted rows or duplicating shifted records', async () => {
  const hook = renderHook(useNotifications);
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  act(() => hook.result.current.loadMore());
  await waitFor(() => expect(hook.result.current.page).toBe(2));
  mocks.list.mockImplementation(async ({ page }) => ({ ...response(page), data: [{ id: page === 1 ? 'n2' : 'n3', isRead: false }] }));
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.notifications.map(n => n.id)).toEqual(['n2', 'n3']);
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

it('shares a single badge request and does not download feed pages for the bell or a closed dropdown', async () => {
  mocks.counts.mockClear(); mocks.list.mockClear();
  const bell = renderHook(() => useNotifications('all', { countsOnly: true }));
  const otherBell = renderHook(() => useNotifications('all', { countsOnly: true }));
  renderHook(() => useNotifications('all', { enabled: false, limit: 5 }));
  await waitFor(() => expect(bell.result.current.unreadCount).toBe(30));
  expect(otherBell.result.current.unreadCount).toBe(30);
  expect(mocks.counts).toHaveBeenCalledTimes(1);
  expect(mocks.list).not.toHaveBeenCalled();
});

it('does not let a stale response populate another user or tenant scope', async () => {
  let finish!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(useNotifications);
  mocks.auth.user.id = 'user-b';
  mocks.list.mockResolvedValue({ ...response(1), data: [{ id: 'new-user', isRead: false }] });
  hook.rerender();
  await waitFor(() => expect(hook.result.current.notifications[0]?.id).toBe('new-user'));
  await act(async () => { finish(response(1)); });
  expect(hook.result.current.notifications.map(n => n.id)).toEqual(['new-user']);
});

it('blocks concurrent conflicting mutations across mounted views', async () => {
  const first = renderHook(useNotifications), second = renderHook(useNotifications);
  await waitFor(() => expect(first.result.current.notifications).toHaveLength(1));
  let finish!: (value: unknown) => void;
  mocks.delete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let deletion!: Promise<boolean>;
  act(() => { deletion = first.result.current.deleteNotifications(['n1']); });
  await act(async () => { expect(await second.result.current.markAsRead('n1')).toBe(false); });
  await act(async () => { finish({ success: true, totalCount: 29, unreadCount: 29 }); await deletion; });
});

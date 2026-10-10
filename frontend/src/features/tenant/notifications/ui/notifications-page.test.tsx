import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NotificationsPage from './notifications-page';
import { clearPageCache } from '@/shared/cache/page-cache';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ list: vi.fn(), counts: vi.fn(), destination: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), delete: vi.fn(), push: vi.fn() }));
vi.mock('@/shared/services/notifications.api', () => ({ notificationsApi: mocks }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'user' } }) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('motion/react', () => ({ motion: {
  div: ({ initial, animate, exit, transition, ...props }: any) => <div {...props} />,
  span: ({ initial, animate, exit, transition, ...props }: any) => <span {...props} />,
}, useReducedMotion: () => true }));

let records: { id: string; type: string; title: string; body: string; isRead: boolean; createdAt: string }[];
const counts = () => ({ success: true, totalCount: records.length, unreadCount: records.filter(n => !n.isRead).length });
beforeEach(() => {
  vi.clearAllMocks(); clearPageCache();
  records = [false, false, true].map((isRead, i) => ({ id: `${i}`, type: 'task_overdue', title: `Notice ${i}`, body: 'Follow up with new lead', isRead, createdAt: '2026-10-03T10:00:00Z' }));
  mocks.list.mockImplementation(async ({ isRead }) => {
    const data = records.filter(n => isRead === undefined || n.isRead === isRead);
    return { ...counts(), data, meta: { total: data.length, page: 1, limit: 20, hasMore: false } };
  });
  mocks.delete.mockImplementation(async (ids: string[]) => { records = records.filter(n => !ids.includes(n.id)); return counts(); });
  mocks.counts.mockImplementation(async () => counts());
  mocks.destination.mockResolvedValue({ success: true, destination: null });
  mocks.markRead.mockImplementation(async (id: string) => { records = records.map(n => n.id === id ? { ...n, isRead: true } : n); return counts(); });
  mocks.markAllRead.mockImplementation(async () => { records = records.map(n => ({ ...n, isRead: true })); return counts(); });
});
afterEach(() => { cleanup(); clearPageCache(); });

it('selects rows without reading/deleting, cancels confirmation, and deletes the selected set only after success', async () => {
  render(<NotificationsPage />);
  await screen.findByText('Notice 0');
  expect(screen.queryByRole('button', { name: /^Delete \(/ })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select notification: Notice 0' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select notification: Notice 1' }));
  expect(mocks.markRead).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete (2)' }));
  expect(screen.getByRole('alertdialog').textContent).toContain('delete 2 selected notifications');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete (2)' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 notifications deleted'));
  expect(screen.queryByText('Notice 0')).toBeNull(); expect(screen.queryByText('Notice 1')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Delete \(/ })).toBeNull();
  expect(screen.getByRole('tab', { name: /All\s*1/ })).toBeTruthy();
  expect(screen.getByText("You're all caught up.")).toBeTruthy();
});

it('filters tabs, scopes Select all, moves reads immediately, and displays all three empty states', async () => {
  render(<NotificationsPage />); await screen.findByText('Notice 0');
  fireEvent.click(screen.getByRole('tab', { name: /Unread\s*2/ }));
  await waitFor(() => expect(screen.queryByText('Notice 2')).toBeNull());
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all notifications shown' }));
  expect(screen.getByRole('button', { name: 'Delete (2)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all notifications shown' }));
  expect(screen.queryByRole('button', { name: /^Delete \(/ })).toBeNull();
  fireEvent.click(screen.getByText('Notice 0'));
  await waitFor(() => expect(screen.queryByText('Notice 0')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Mark all notifications as read' }));
  await screen.findByText('No unread notifications');
  fireEvent.click(screen.getByRole('tab', { name: /Read\s*3/ }));
  await screen.findByText('Notice 0');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all notifications shown' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete (3)' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await screen.findByText('No read notifications');
  fireEvent.click(screen.getByRole('tab', { name: /All\s*0/ }));
  await screen.findByText('No notifications yet');
});

it('shows a single-delete dialog and keeps data and selection on failure', async () => {
  mocks.delete.mockRejectedValueOnce(new Error('Offline'));
  render(<NotificationsPage />); await screen.findByText('Notice 0');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select notification: Notice 0' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete notification' })[0]);
  expect(screen.getByText('Delete notification?')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete notifications'));
  expect(screen.getByText('Notice 0')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete (1)' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notification deleted'));
});

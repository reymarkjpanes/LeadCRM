import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InboxPage from './inbox-page';

const mocks = vi.hoisted(() => ({ status: vi.fn(), list: vi.fn(), sync: vi.fn(), disconnect: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('../services/gmail.service', () => ({ getGmailStatus: mocks.status, fetchGmailEmails: mocks.list, syncGmail: mocks.sync, disconnectGmail: mocks.disconnect }));
vi.mock('./inbox-current-empty', () => ({ default: () => <div>Connect email</div> }));
vi.mock('./inbox-done-empty', () => ({ default: () => <div>No done emails</div> }));
vi.mock('./inbox-future-empty', () => ({ default: () => <div>No future emails</div> }));
vi.mock('./email-conversation-view', () => ({ default: () => <div>Conversation</div> }));
vi.mock('./compose-modal', () => ({ default: () => null }));
vi.mock('motion/react', () => ({ motion: { div: ({ initial: _i, animate: _a, exit: _e, transition: _t, ...props }: any) => <div {...props} /> }, AnimatePresence: ({ children }: any) => children, useReducedMotion: () => true }));

const email = { id: 'm1', threadId: 't1', from: 'Customer <customer@example.test>', to: ['staff@example.test'], subject: 'Saved customer email', snippet: 'Customer update', body: 'Hello', date: '2026-10-01T10:00:00Z', isRead: false, labels: ['INBOX'] };
const throttle = (seconds = 60) => Object.assign(new Error('Provider limit'), { code: 'GMAIL_RATE_LIMITED', status: 429, retryAt: new Date(Date.now() + seconds * 1000).toISOString() });
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.status.mockResolvedValue({ isConnected: true, email: 'staff@example.test', connectedAt: '2026-10-01', lastSyncAt: '2026-10-01' });
  mocks.list.mockResolvedValue({ emails: [email] });
  mocks.sync.mockResolvedValue({ hasMore: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Inbox request recovery', () => {
  it('waits for search typing to pause and loads each filter only once', async () => {
    render(<InboxPage />); await flush();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Search email'), { target: { value: 'quo' } });
    await advance(200);
    fireEvent.change(screen.getByLabelText('Search email'), { target: { value: 'quotation' } });
    await advance(399);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list.mock.lastCall?.[0].query).toContain('quotation');
    fireEvent.click(screen.getByLabelText('Filter emails'));
    fireEvent.click(screen.getByText('Unread only')); await flush();
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(mocks.list.mock.lastCall?.[0].query).toContain('is:unread');
  });
  it('keeps loaded mail visible, disables extra requests and automatically recovers', async () => {
    render(<InboxPage />); await flush();
    mocks.list.mockRejectedValueOnce(throttle(120));
    fireEvent.click(screen.getByLabelText('Refresh')); await flush();
    expect(screen.getByText('Saved customer email')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Retrying automatically');
    expect((screen.getByText('Sync now') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Refresh') as HTMLButtonElement).disabled).toBe(true);
    await advance(119999);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.sync).not.toHaveBeenCalled();
    await advance(252);
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/Gmail updates are paused/)).toBeNull();
    expect(screen.getByText('Saved customer email')).toBeTruthy();
  });
  it('shows an honest waiting state for an initial limit, then loads without another click', async () => {
    mocks.list.mockRejectedValueOnce(throttle());
    render(<InboxPage />); await flush();
    expect(screen.getByText('Waiting for Gmail')).toBeTruthy();
    expect(screen.queryByText('Your inbox is empty')).toBeNull();
    await advance(60251);
    expect(screen.getByText('Saved customer email')).toBeTruthy();
  });
  it('does not show another category’s emails during the cooldown', async () => {
    render(<InboxPage />); await flush();
    mocks.list.mockRejectedValueOnce(throttle());
    fireEvent.click(screen.getByLabelText('Refresh')); await flush();
    fireEvent.click(screen.getByText('Promotions')); await flush();
    expect(screen.queryByText('Saved customer email')).toBeNull();
    expect(screen.getByText('Waiting for Gmail')).toBeTruthy();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await advance(60251);
    expect(mocks.list.mock.lastCall?.[0].query).toContain('category:promotions');
  });
  it('refreshes once after manual sync and never reloads after a failed sync', async () => {
    render(<InboxPage />); await flush();
    fireEvent.click(screen.getByText('Sync now')); await flush();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    mocks.sync.mockRejectedValueOnce(throttle());
    fireEvent.click(screen.getByText('Sync now')); await flush();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Saved customer email')).toBeTruthy();
  });
  it('still displays permission failures instead of concealing them as a cooldown', async () => {
    render(<InboxPage />); await flush();
    mocks.list.mockRejectedValueOnce(Object.assign(new Error('Reconnect work email'), { status: 403 }));
    fireEvent.click(screen.getByLabelText('Refresh')); await flush();
    expect(screen.getByText('Reconnect work email')).toBeTruthy();
    expect(screen.queryByText('Saved customer email')).toBeNull();
    expect(screen.queryByText('Waiting for Gmail')).toBeNull();
  });
  it('refreshes background updates only when sync processed messages', async () => {
    mocks.sync.mockResolvedValueOnce({ hasMore: false, processed: 2 }).mockResolvedValue({ hasMore: false, processed: 0 });
    render(<InboxPage />); await flush();
    await advance(15001);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await advance(300000);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('does not get stuck loading after Strict Mode effect cleanup', async () => {
    render(<StrictMode><InboxPage /></StrictMode>); await flush();
    expect(screen.getByText('Saved customer email')).toBeTruthy();
    expect(screen.queryByText('Loading emails...')).toBeNull();
  });
  it('cancels automatic recovery when leaving the inbox', async () => {
    mocks.list.mockRejectedValueOnce(throttle());
    const view = render(<InboxPage />); await flush();
    view.unmount();
    await advance(60251);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});

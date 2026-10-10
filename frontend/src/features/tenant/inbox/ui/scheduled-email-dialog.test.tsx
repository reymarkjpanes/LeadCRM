import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScheduledEmailDialog } from './scheduled-email-dialog';
import { getScheduledGmailEmail, cancelScheduledGmailEmail } from '../services/gmail.service';
vi.mock('../services/gmail.service', () => ({ getScheduledGmailEmail: vi.fn(), cancelScheduledGmailEmail: vi.fn() }));
const detail = { id: 'schedule', status: 'pending', recipients: ['customer@example.com'], subject: 'Follow up', scheduledAt: '2026-10-10T01:00:00Z', body: '<p>Hello</p><script>evil()</script><img src="https://tracker.example.com">', lastError: null, canCancel: true };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getScheduledGmailEmail).mockResolvedValue(detail); vi.mocked(cancelScheduledGmailEmail).mockResolvedValue({ id: 'schedule', status: 'cancelled' }); });
afterEach(cleanup);
it('shows scheduled recipients and sanitized content, confirms cancellation, and updates the inbox', async () => {
  const onClose = vi.fn(), onCancelled = vi.fn();
  render(<ScheduledEmailDialog id="schedule" onClose={onClose} onCancelled={onCancelled} />);
  await screen.findByText('Follow up');
  expect(screen.getByText('customer@example.com')).toBeTruthy();
  const body = screen.getByLabelText('Scheduled message content'); expect(body.textContent).toBe('Hello'); expect(body.querySelector('img, script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled send' }));
  expect(cancelScheduledGmailEmail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await waitFor(() => expect(onCancelled).toHaveBeenCalledOnce()); expect(onClose).toHaveBeenCalledOnce();
});
it('keeps the schedule visible when cancellation loses a race with delivery', async () => {
  vi.mocked(cancelScheduledGmailEmail).mockRejectedValue(new Error('Delivery has already started.'));
  const onClose = vi.fn(); render(<ScheduledEmailDialog id="schedule" onClose={onClose} onCancelled={vi.fn()} />);
  await screen.findByText('Follow up'); fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled send' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Delivery has already started.'); expect(onClose).not.toHaveBeenCalled();
});
it('blocks cancellation of uncertain delivery and explains provider verification', async () => {
  vi.mocked(getScheduledGmailEmail).mockResolvedValue({ ...detail, status: 'uncertain', canCancel: false, lastError: 'Automatic resend is paused.' });
  render(<ScheduledEmailDialog id="schedule" onClose={vi.fn()} onCancelled={vi.fn()} />); await screen.findByText('Automatic resend is paused.');
  expect(screen.queryByRole('button', { name: 'Cancel scheduled send' })).toBeNull(); expect(screen.getByText(/Check Gmail Sent/)).toBeTruthy();
});

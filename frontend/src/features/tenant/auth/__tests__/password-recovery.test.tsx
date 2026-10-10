import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const recovery = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ requestPasswordReset: recovery, login: vi.fn(), confirmPasswordReset: vi.fn() }) }));
vi.mock('sonner', () => ({ toast }));
import ModernLoginPage from '../../pages/modern-login-page';
function form(email = 'unknown@example.com') {
  render(<ModernLoginPage onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: email } });
  return screen.getByLabelText('Email Address').closest('form')!;
}
beforeEach(() => { recovery.mockReset(); toast.error.mockReset(); toast.success.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const success = { success: true, message: 'Recovery requested.', expiresInMinutes: 25, resendAfterSeconds: 60 };
describe('finalized recovery UI', () => {
  it('A: uses the stable code, shows the exact toast, keeps email/form and restores submission', async () => {
    recovery.mockRejectedValue(Object.assign(new Error('Localized server text'), { code: 'ACCOUNT_NOT_FOUND', status: 404 }));
    fireEvent.submit(form());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No account exists with this email address.'));
    expect((screen.getByLabelText('Email Address') as HTMLInputElement).value).toBe('unknown@example.com');
    expect((screen.getByRole('button', { name: 'Send Reset Link' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Check your email')).toBeNull(); expect(screen.queryByText('Email Sent Successfully')).toBeNull();
  });
  it('B/D: normalizes input, uses backend expiry and never claims inbox delivery', async () => {
    recovery.mockResolvedValue(success); fireEvent.submit(form(' Staff@CAMXIAN.COM '));
    await screen.findByText('Check your email');
    expect(recovery).toHaveBeenCalledWith('staff@camxian.com'); expect(screen.getByText('25 minutes')).toBeTruthy();
    expect(screen.getByText('Password reset email requested')).toBeTruthy(); expect(screen.queryByText('Email Sent Successfully')).toBeNull();
    expect((screen.getByRole('button', { name: /Resend in/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('C: invalid email never calls recovery', () => {
    fireEvent.submit(form('invalid')); expect(recovery).not.toHaveBeenCalled(); expect(toast.error).toHaveBeenCalledWith('Valid email required');
  });
  it('F: provider error keeps the form and displays the actual safe message', async () => {
    const message = 'Unable to send the password reset email. Please try again later.';
    recovery.mockRejectedValue(Object.assign(new Error(message), { code: 'PASSWORD_RESET_EMAIL_FAILED' })); fireEvent.submit(form());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message)); expect(screen.getByLabelText('Email Address')).toBeTruthy();
    expect(screen.queryByText('Check your email')).toBeNull();
  });
  it('G: repeated submit events create only one pending request', async () => {
    let finish!: (value: typeof success) => void; recovery.mockReturnValue(new Promise(done => { finish = done; }));
    const element = form(); fireEvent.submit(element); fireEvent.submit(element);
    expect(recovery).toHaveBeenCalledOnce(); expect((screen.getByRole('button', { name: 'Sending...' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(success));
  });
  it('H: resend reuses recovery protections and displays safe error without a success toast', async () => {
    vi.useFakeTimers(); recovery.mockResolvedValueOnce(success);
    fireEvent.submit(form()); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(61_000); });
    recovery.mockRejectedValueOnce(Object.assign(new Error('Too many password reset requests — try again in an hour.'), { status: 429, retryAt: new Date(Date.now() + 3600_000).toISOString() }));
    fireEvent.click(screen.getByRole('button', { name: 'Resend link' })); await act(async () => {});
    expect(toast.error).toHaveBeenCalledWith('Too many password reset requests — try again in an hour.'); expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /Resend in/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('H: account removed before resend returns to the form with the entered address', async () => {
    vi.useFakeTimers(); recovery.mockResolvedValueOnce(success); fireEvent.submit(form('removed@camxian.com')); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(61_000); });
    recovery.mockRejectedValueOnce(Object.assign(new Error('unknown'), { code: 'ACCOUNT_NOT_FOUND' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resend link' })); await act(async () => {});
    expect((screen.getByLabelText('Email Address') as HTMLInputElement).value).toBe('removed@camxian.com'); expect(screen.queryByText('Check your email')).toBeNull();
  });
});

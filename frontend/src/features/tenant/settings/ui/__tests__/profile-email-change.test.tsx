import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMAIL_AVAILABILITY_MESSAGES } from '@leadcrm/shared';

const mocks = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn(), confirm: vi.fn(), logout: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/shared/services/auth.api', () => ({ authApi: { requestProfileEmailChange: mocks.request, confirmProfileEmailChange: mocks.confirm } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'admin', tenantId: 'tenant', role: 'Client Admin' }, tenant: { id: 'tenant' }, logout: mocks.logout,
}) }));

import { ProfileEmailChange } from '../profile-email-change';

const available = { success: true, data: { available: true } };
const advance = async (milliseconds = 600) => { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup() {
  const onClose = vi.fn();
  render(<ProfileEmailChange onClose={onClose} />);
  const email = screen.getByLabelText('New email address') as HTMLInputElement;
  const password = screen.getByLabelText('Current password') as HTMLInputElement;
  const change = (value: string) => fireEvent.change(email, { target: { value } });
  const icon = () => email.parentElement!.querySelector('svg.lucide-check');
  const send = screen.getByRole('button', { name: 'Send verification code' }) as HTMLButtonElement;
  const submit = async () => { await act(async () => { fireEvent.submit(email.closest('form')!); }); };
  fireEvent.change(password, { target: { value: 'current password' } });
  return { email, password, change, icon, send, submit, onClose };
}
async function sendCode() {
  const form = setup();
  form.change(' New@Example.test ');
  await advance();
  await form.submit();
  return form;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  mocks.get.mockResolvedValue(available);
  mocks.request.mockResolvedValue({ success: true });
  mocks.confirm.mockResolvedValue({ success: true });
  mocks.logout.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); cleanup(); vi.useRealTimers(); });

it('preserves the fields and toggles password visibility without submitting', () => {
  const { email, password } = setup();
  expect(email.placeholder).toBe('Enter new email address');
  expect(password.placeholder).toBe('Enter current password');
  expect(password.type).toBe('password');
  expect(password.autocomplete).toBe('current-password');
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password.type).toBe('text');
  expect(password.value).toBe('current password');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password.type).toBe('password');
  expect(mocks.request).not.toHaveBeenCalled();
});

it('validates while typing and waits for debounced backend confirmation before sending', async () => {
  const check = deferred<typeof available>(); mocks.get.mockReturnValueOnce(check.promise);
  const { email, change, icon, send, submit } = setup();
  expect(send.disabled).toBe(true);
  change('bad-email');
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(email.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  await submit(); expect(mocks.request).not.toHaveBeenCalled();
  change(' New@Example.test ');
  expect(screen.queryByRole('alert')).toBeNull();
  await advance(599); expect(mocks.get).not.toHaveBeenCalled();
  await advance(1);
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/administration/users/email-availability', expect.objectContaining({ params: { email: 'new@example.test' } }));
  expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
  await submit(); expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => { check.resolve(available); });
  expect(icon()?.getAttribute('aria-hidden')).toBe('true');
  expect(icon()?.classList.contains('text-green-600')).toBe(true);
  expect(icon()?.classList.contains('dark:text-green-400')).toBe(true);
  expect(send.disabled).toBe(false);
  await submit();
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ email: 'new@example.test', currentPassword: 'current password' });
  expect((screen.getByLabelText('Verification code') as HTMLInputElement).placeholder).toBe('Enter verification code');
});

it('clears rejected addresses on edit and rejects submission even if the form is submitted directly', async () => {
  mocks.get.mockResolvedValueOnce({ success: true, data: { available: false, reason: 'EMAIL_IN_USE' } });
  const { change, icon, send, submit } = setup();
  change('taken@example.test'); await advance();
  expect(screen.getByRole('alert').textContent).toBe(EMAIL_AVAILABILITY_MESSAGES.EMAIL_IN_USE);
  expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
  await submit(); expect(mocks.request).not.toHaveBeenCalled();
  change('free@example.test');
  expect(screen.queryByRole('alert')).toBeNull(); expect(icon()).toBeNull();
  await advance(); expect(icon()).not.toBeNull();
  change(''); expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
});

it('ignores stale availability successes and errors after the address changes', async () => {
  const old = deferred<unknown>(), next = deferred<unknown>(), current = deferred<unknown>();
  mocks.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockReturnValueOnce(current.promise);
  const { change, icon, send } = setup();
  change('first@example.test'); await advance();
  const signal = mocks.get.mock.calls[0][1].signal as AbortSignal;
  change('second@example.test'); expect(signal.aborted).toBe(true); await advance();
  await act(async () => { old.resolve(available); });
  expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
  change('third@example.test'); await advance();
  await act(async () => { next.resolve({ success: true, data: { available: false, reason: 'EMAIL_IN_USE' } }); });
  expect(screen.queryByRole('alert')).toBeNull(); expect(icon()).toBeNull();
  await act(async () => { current.resolve(available); }); expect(icon()).not.toBeNull();
  change('fourth@example.test'); expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
});

it('blocks failed availability checks and retries on blur', async () => {
  mocks.get.mockRejectedValueOnce(new Error('offline'));
  const { email, change, icon, send, submit } = setup();
  change('new@example.test'); await advance();
  expect(screen.getByRole('alert').textContent).toBe('Unable to verify this email. Please try again.');
  expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
  await submit(); expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => { fireEvent.blur(email); });
  expect(mocks.get).toHaveBeenCalledTimes(2); expect(icon()).not.toBeNull();
});

it('removes confirmed availability when the send endpoint reports an email conflict', async () => {
  mocks.request.mockRejectedValueOnce(Object.assign(new Error('Email taken'), { code: 'EMAIL_IN_USE', status: 409 }));
  const { change, icon, send, submit } = setup();
  change('new@example.test'); await advance(); await submit();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert').textContent).toBe(EMAIL_AVAILABILITY_MESSAGES.EMAIL_IN_USE);
  expect(icon()).toBeNull(); expect(send.disabled).toBe(true);
  change('other@example.test'); expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps backend password errors and blocks duplicate requests and dismissal while sending', async () => {
  const request = deferred<unknown>(); mocks.request.mockReturnValueOnce(request.promise);
  const { email, password, change, submit, onClose } = setup();
  change('new@example.test'); await advance();
  await submit(); await submit();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(email.disabled).toBe(true); expect(password.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' })); expect(onClose).not.toHaveBeenCalled();
  await act(async () => { request.reject(new Error('Current password is incorrect.')); });
  expect(screen.getByRole('alert').textContent).toBe('Current password is incorrect.');
  expect(password.disabled).toBe(false);
});

it('resets the password and visibility when requesting another code and rechecks availability', async () => {
  const { password, change, submit } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  change('new@example.test'); await advance(); await submit();
  expect(screen.getByText('Enter the 6-digit code sent to new@example.test.')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Verify$/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '042986' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request a new code' }));
  const newPassword = screen.getByLabelText('Current password') as HTMLInputElement;
  expect(password.isConnected).toBe(false);
  expect(newPassword.value).toBe(''); expect(newPassword.type).toBe('password');
  expect((screen.getByRole('button', { name: 'Send verification code' }) as HTMLButtonElement).disabled).toBe(true);
  await advance(); expect(mocks.get).toHaveBeenCalledTimes(2);
  fireEvent.change(newPassword, { target: { value: 'current password' } });
  await act(async () => { fireEvent.submit(newPassword.closest('form')!); });
  expect((screen.getByLabelText('Verification code') as HTMLInputElement).value).toBe('');
});

it('retains confirmation errors and requires a valid code before confirming', async () => {
  await sendCode();
  const code = screen.getByLabelText('Verification code');
  await act(async () => { fireEvent.submit(code.closest('form')!); });
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(code.getAttribute('aria-invalid')).toBe('true');
  expect(code.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  mocks.confirm.mockRejectedValueOnce(new Error('Invalid or expired verification code.'));
  fireEvent.change(code, { target: { value: '042986' } });
  await act(async () => { fireEvent.submit(code.closest('form')!); });
  expect(screen.getByRole('alert').textContent).toBe('Invalid or expired verification code.');
  expect(mocks.logout).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: '042987' } });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('focuses one accessible numeric input with six decorative slots and supports leading zeros, deletion and paste', async () => {
  await sendCode();
  const input = screen.getByLabelText('Verification code') as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(input.type).toBe('text'); expect(input.inputMode).toBe('numeric');
  expect(input.autocomplete).toBe('one-time-code'); expect(input.maxLength).toBe(6);
  const slots = input.parentElement!.querySelector('[aria-hidden="true"]')!;
  expect(slots.children).toHaveLength(6);
  for (const value of ['0', '04', '042', '0429', '04298', '042986']) fireEvent.change(input, { target: { value } });
  expect(input.value).toBe('042986'); expect(slots.textContent).toBe('042986');
  fireEvent.change(input, { target: { value: '04298' } });
  expect(slots.textContent).toBe('04298–');
  fireEvent.change(input, { target: { value: '0a42b9c86' } });
  expect(input.value).toBe('042986');
  fireEvent.change(input, { target: { value: '12' } });
  fireEvent.paste(input, { clipboardData: { getData: () => ' 000042 ' } });
  expect(input.value).toBe('000042'); expect(input.selectionStart).toBe(6);
  expect(slots.textContent).toBe('000042'); expect(mocks.confirm).not.toHaveBeenCalled();
});

it('shows the exhausted-code error inline and keeps the request-new-code action available', async () => {
  await sendCode();
  const input = screen.getByLabelText('Verification code');
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('Too many incorrect codes. Request a new code.'), { status: 429, code: 'PROFILE_EMAIL_CODE_ATTEMPTS_EXCEEDED' }));
  fireEvent.change(input, { target: { value: '042986' } });
  await act(async () => { fireEvent.submit(input.closest('form')!); });
  expect(screen.getByRole('alert').textContent).toBe('Too many incorrect codes. Request a new code.');
  expect((screen.getByRole('button', { name: 'Request a new code' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([false, true])('logs out and redirects after confirmation, including logout failure=%s', async logoutFails => {
  await sendCode();
  const replace = vi.fn();
  const browserWindow = window;
  vi.stubGlobal('window', new Proxy(browserWindow, { get: (target, key) => key === 'location' ? { replace } : Reflect.get(target, key, target) }));
  if (logoutFails) mocks.logout.mockRejectedValueOnce(new Error('Logout failed'));
  const confirmation = deferred<unknown>(); mocks.confirm.mockReturnValueOnce(confirmation.promise);
  const code = screen.getByLabelText('Verification code');
  fireEvent.change(code, { target: { value: '042986' } });
  await act(async () => { fireEvent.submit(code.closest('form')!); fireEvent.submit(code.closest('form')!); });
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({ code: '042986' });
  expect((code as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Please wait…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.logout).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  await act(async () => { confirmation.resolve({ success: true }); });
  expect(mocks.logout).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledExactlyOnceWith('/login');
});

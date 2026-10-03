import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const api = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock('@/shared/services/auth.api', () => ({ authApi: api }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', passwordChangedAt: '2026-09-30T00:00:00Z' }, applyAuthUser: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
import { SecuritySettings } from '../security-settings';
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
it('opens a password dialog without sending a change request and clears fields on cancel', async () => {
  render(<SecuritySettings />);
  fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
  const dialog = await screen.findByRole('dialog');
  expect(api.changePassword).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Current Password *')).toBeNull();
  fireEvent.change(within(dialog).getByLabelText('New password *'), { target: { value: 'Camxian1!' } });
  expect(within(dialog).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5');
  fireEvent.click(within(dialog).getByText('Cancel'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
  expect((await screen.findByLabelText('New password *') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('Last changed: Never')).toBeNull();
});
it('shows one field error under the input and never sends mismatched confirmation', async () => {
  render(<SecuritySettings />); fireEvent.click(screen.getByText('Change Password'));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('New password *'), { target: { value: 'Camxian2026!' } });
  fireEvent.change(screen.getByLabelText('Confirm new password *'), { target: { value: 'Mismatch1!' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Change password', { selector: 'button' }));
  expect(screen.getAllByText('Passwords do not match.')).toHaveLength(1);
  expect(screen.getByLabelText('Confirm new password *').getAttribute('aria-describedby')).toBe('confirm-error');
  expect(api.changePassword).not.toHaveBeenCalled();
});
it('renders only password settings and uses the canonical password-change date', () => {
  render(<SecuritySettings />);
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Change Password']);
  expect(screen.getByText(/^Last changed:/)).toBeTruthy();
  expect(Object.values(api).every(mock => mock.mock.calls.length === 0)).toBe(true);
});

it('requires all rules and confirmation, preserves password characters and blocks duplicate submission', async () => {
  let resolve!: (value: unknown) => void;
  api.changePassword.mockReturnValue(new Promise(done => { resolve = done; }));
  render(<SecuritySettings />); fireEvent.click(screen.getByText('Change Password'));
  const dialog = await screen.findByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Change password' }) as HTMLButtonElement;
  const password = screen.getByLabelText('New password *');
  const confirm = screen.getByLabelText('Confirm new password *');
  expect(submit.disabled).toBe(true);
  for (const value of ['Ab1!', 'password1!', 'PASSWORD1!', 'Password!', 'Password1']) {
    fireEvent.change(password, { target: { value } });
    fireEvent.change(confirm, { target: { value } });
    expect(submit.disabled).toBe(true);
  }
  const value = '  Strong pass1!  ';
  fireEvent.change(password, { target: { value } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(confirm, { target: { value } });
  expect(submit.disabled).toBe(false);
  expect(within(dialog).getByRole('progressbar').children).toHaveLength(5);
  expect(within(dialog).getByText('Strong')).toBeTruthy();
  expect(within(dialog).getAllByLabelText('Met')).toHaveLength(5);
  fireEvent.click(screen.getByLabelText('Show new password'));
  expect(password.getAttribute('type')).toBe('text');
  fireEvent.click(submit);
  expect(submit.disabled).toBe(true);
  fireEvent.submit(submit.closest('form')!);
  expect(api.changePassword).toHaveBeenCalledTimes(1);
  expect(api.changePassword).toHaveBeenCalledWith({ password: value });
  resolve({ data: { user: { id: 'me', passwordChangedAt: '2026-09-30T00:00:00Z' } } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

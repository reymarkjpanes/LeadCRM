import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const { changePassword, applyAuthUser } = vi.hoisted(() => ({ changePassword: vi.fn(), applyAuthUser: vi.fn() }));
vi.mock('@/shared/services/auth.api', () => ({ authApi: { changePassword } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'employee', email: 'employee@camxian.com', mustChangePassword: true }, applyAuthUser, logout: vi.fn() }) }));
import ChangePasswordPage from '../ui/change-password-page';
beforeEach(() => { cleanup(); vi.resetAllMocks(); });
function fill(confirm = 'Personal2!') {
  fireEvent.change(screen.getByLabelText('New password *'), { target: { value: 'Personal2!' } });
  fireEvent.change(screen.getByLabelText('Confirm new password *'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}
it('changes credentials then applies the canonical response using the preserved session', async () => {
  changePassword.mockResolvedValue({ success: true, data: { user: { id: 'employee', mustChangePassword: false } } });
  render(<ChangePasswordPage />); fill();
  await waitFor(() => expect(applyAuthUser).toHaveBeenCalledWith({ id: 'employee', mustChangePassword: false }, 'employee'));
  expect(changePassword).toHaveBeenCalledWith({ password: 'Personal2!' });
});
it('does not update authentication after the server rejects password reuse', async () => {
  changePassword.mockRejectedValue(new Error('Choose a password different from your current password.'));
  render(<ChangePasswordPage />); fill();
  expect((await screen.findByRole('alert')).textContent).toContain('Choose a password');
  expect(applyAuthUser).not.toHaveBeenCalled();
});
it('checks confirmation before sending credentials', async () => {
  render(<ChangePasswordPage />); fill('Different3!');
  expect(screen.getByRole('alert').textContent).toContain('Passwords do not match');
  expect(changePassword).not.toHaveBeenCalled();
});
it('shows the exact inline error when the lowercase temporary credential is reused', async () => {
  const message = 'You cannot reuse your temporary password. Please choose a new password.';
  changePassword.mockRejectedValue(Object.assign(new Error(message), { code: 'PASSWORD_REUSE' }));
  render(<ChangePasswordPage />);
  fireEvent.change(screen.getByLabelText('New password *'), { target: { value: 'first.last42' } });
  fireEvent.change(screen.getByLabelText('Confirm new password *'), { target: { value: 'first.last42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(changePassword).toHaveBeenCalledWith({ password: 'first.last42' });
  expect(applyAuthUser).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /cancel|skip/i })).toBeNull();
});

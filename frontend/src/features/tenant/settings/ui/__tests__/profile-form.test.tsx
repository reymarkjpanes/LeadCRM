import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn(), upload: vi.fn(), requestEmail: vi.fn(), get: vi.fn() }));
const user = { id: 'me', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@camxian.com', role: 'User', jobTitle: 'Engineer' };
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user, updateProfile: mocks.save, applyAuthUser: vi.fn() }) }));
vi.mock('@/shared/utils/toast', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/shared/services/auth.api', () => ({ authApi: { uploadAvatar: mocks.upload, requestProfileEmailChange: mocks.requestEmail } }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
import { ProfileForm } from '../profile-form';
beforeEach(() => {
  vi.resetAllMocks(); user.role = 'User';
  mocks.get.mockResolvedValue({ success: true, data: { available: true } });
});
afterEach(cleanup);

it.each(['First Name', 'Last Name'])('shows and clears accessible special-character errors immediately for %s', label => {
  render(<ProfileForm />);
  fireEvent.click(screen.getByText('Edit'));
  const input = screen.getByLabelText(label);
  const message = `${label === 'First Name' ? 'First name' : 'Last name'} must not contain special characters.`;
  for (const symbol of ['@', '#', '$', '%', '&', '*', '+', '=', '!', '_', '.', '/', '\\', '(', ')', '"', '😀']) {
    const value = `John${symbol}`;
    fireEvent.input(input, { target: { value } });
    const error = screen.getByText(message);
    expect(input).toHaveProperty('value', value);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(error.getAttribute('role')).toBe('alert');
    fireEvent.click(screen.getByText('Save Changes'));
    expect(mocks.save).not.toHaveBeenCalled();
  }
  fireEvent.input(input, { target: { value: 'María' } });
  expect(screen.queryByText(message)).toBeNull();
  expect(input.getAttribute('aria-invalid')).toBe('false');
  expect(input.getAttribute('aria-describedby')).toBeNull();
});

it('prioritizes numbers over symbols and keeps independent length errors after correction', async () => {
  mocks.save.mockResolvedValue(undefined);
  render(<ProfileForm />);
  fireEvent.click(screen.getByText('Edit'));
  const first = screen.getByLabelText('First Name');
  const last = screen.getByLabelText('Last Name');
  const overlong = 'A'.repeat(51);
  fireEvent.input(first, { target: { value: overlong + '@1' } });
  fireEvent.input(last, { target: { value: 'Smith#' } });
  expect(screen.getByText('First name must not contain numbers.')).toBeTruthy();
  expect(screen.getByText('Last name must not contain special characters.')).toBeTruthy();
  fireEvent.input(first, { target: { value: overlong + '@' } });
  expect(first).toHaveProperty('value', overlong + '@');
  expect(screen.queryByText('First name must not contain numbers.')).toBeNull();
  expect(screen.getByText('First name must not contain special characters.')).toBeTruthy();
  fireEvent.input(first, { target: { value: overlong } });
  expect(first).toHaveProperty('value', overlong);
  expect(screen.queryByText('First name must not contain special characters.')).toBeNull();
  expect(screen.getByText('First name must not exceed 50 characters.')).toBeTruthy();
  fireEvent.click(screen.getByText('Save Changes'));
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.input(first, { target: { value: 'Anne-Marie' } });
  expect(screen.getByText('Last name must not contain special characters.')).toBeTruthy();
  fireEvent.input(last, { target: { value: 'O’Connor' } });
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(screen.getByText('Edit')).toBeTruthy());
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ firstName: 'Anne-Marie', lastName: 'O’Connor', phone: null });
});

it.each(['John', 'Mary Jane', 'Anne-Marie', "O'Connor", 'María', 'Mari\u0301a', '李', 'अर्जुन', 'O‘Connor', 'O’Connor', 'Anne‐Marie', 'Anne‑Marie', 'A'.repeat(50), ' Ada '])('accepts and saves the valid name %s', async value => {
  mocks.save.mockResolvedValue(undefined);
  render(<ProfileForm />);
  fireEvent.click(screen.getByText('Edit'));
  for (const label of ['First Name', 'Last Name']) {
    fireEvent.input(screen.getByLabelText(label), { target: { value } });
    expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('false');
  }
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(screen.getByText('Edit')).toBeTruthy());
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ firstName: value.trim(), lastName: value.trim(), phone: null });
});

it.each(['First Name', 'Last Name'])('preserves required-field errors for empty and whitespace-only %s', label => {
  render(<ProfileForm />);
  fireEvent.click(screen.getByText('Edit'));
  const input = screen.getByLabelText(label);
  const message = `${label === 'First Name' ? 'First name' : 'Last name'} is required`;
  for (const value of ['', '   ']) {
    fireEvent.input(input, { target: { value } });
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.click(screen.getByText('Save Changes'));
    expect(mocks.save).not.toHaveBeenCalled();
  }
  fireEvent.input(input, { target: { value: 'Ada' } });
  expect(screen.queryByText(message)).toBeNull();
  expect(input.getAttribute('aria-invalid')).toBe('false');
});

it('checks names immediately and retains the length rule after digits are removed', async () => {
  mocks.save.mockResolvedValue(undefined);
  render(<ProfileForm />);
  fireEvent.click(screen.getByText('Edit'));
  const first = screen.getByLabelText('First Name');
  const last = screen.getByLabelText('Last Name');
  const overlong = 'A'.repeat(51);
  fireEvent.input(first, { target: { value: overlong + '1' } });
  const firstError = screen.getByText('First name must not contain numbers.');
  expect(first.getAttribute('aria-describedby')).toBe(firstError.id);
  expect(first).toHaveProperty('value', overlong + '1');
  fireEvent.input(last, { target: { value: 'Rey2es' } });
  const lastError = screen.getByText('Last name must not contain numbers.');
  expect(last.getAttribute('aria-describedby')).toBe(lastError.id);
  fireEvent.click(screen.getByText('Save Changes'));
  expect(mocks.save).not.toHaveBeenCalled();

  fireEvent.input(first, { target: { value: overlong } });
  expect(screen.queryByText('First name must not contain numbers.')).toBeNull();
  expect(screen.getByText('First name must not exceed 50 characters.')).toBeTruthy();
  expect(lastError.isConnected).toBe(true);
  fireEvent.input(first, { target: { value: 'Anne-Marie' } });
  fireEvent.input(last, { target: { value: 'Reyes' } });
  expect(screen.queryByText('Last name must not contain numbers.')).toBeNull();
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(screen.getByText('Edit')).toBeTruthy());
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ firstName: 'Anne-Marie', lastName: 'Reyes' }));
});

it('starts read-only with database values and Cancel discards unsaved edits', () => {
  render(<ProfileForm />);
  expect(screen.queryByLabelText('Time Zone')).toBeNull();
  expect((screen.getByLabelText('First Name') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Department')).toBeNull();
  expect(screen.getByLabelText('Groups').textContent).toBe('No groups assigned');
  expect(screen.queryByText('Save Changes')).toBeNull();
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByLabelText('Email Address').tagName).toBe('P');
  expect(screen.getByLabelText('Job Title').textContent).toBe('Engineer');
  expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Unsaved@' } });
  expect(screen.getByText('First name must not contain special characters.')).toBeTruthy();
  fireEvent.click(screen.getByText('Cancel'));
  expect((screen.getByLabelText('First Name') as HTMLInputElement).value).toBe('Ada');
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  fireEvent.click(screen.getByText('Edit'));
  expect(screen.getByLabelText('First Name').getAttribute('aria-invalid')).toBe('false');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('opens the verified email-change flow only for a Client Administrator', async () => {
  user.role = 'Client Admin';
  mocks.requestEmail.mockResolvedValue({ success: true });
  render(<ProfileForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  act(() => screen.getByLabelText('Email Address').focus());
  fireEvent.change(screen.getByLabelText('New email address'), { target: { value: ' New@Camxian.com ' } });
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current password' } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Send verification code' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
  expect(await screen.findByLabelText('Verification code')).toBeTruthy();
  expect(mocks.requestEmail).toHaveBeenCalledExactlyOnceWith({ email: 'new@camxian.com', currentPassword: 'current password' });
  expect((screen.getByLabelText('Email Address') as HTMLInputElement).value).toBe(user.email);
});

it.each(['Client Admin', 'User', 'Sales', 'Admin'])('shows plain email and the shared primary Edit button for %s', role => {
  user.role = role;
  render(<ProfileForm />);
  expect(screen.getByLabelText('Email Address').tagName).toBe('P');
  expect(screen.getByLabelText('Email Address').textContent).toBe(user.email);
  expect(screen.queryByText('Change email')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  const edit = screen.getByRole('button', { name: 'Edit' });
  expect(edit.classList.contains('bg-primary')).toBe(true);
  expect(edit.querySelector('svg.lucide-pencil')).toBeTruthy();
});

it('reveals a read-only email input on Edit and opens the modal only when clicked', () => {
  user.role = 'Client Admin';
  render(<ProfileForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const email = screen.getByLabelText('Email Address') as HTMLInputElement;
  expect(email.tagName).toBe('INPUT');
  expect(email.value).toBe(user.email);
  expect(email.readOnly).toBe(true);
  expect(email.disabled).toBe(false);
  expect(email.getAttribute('aria-haspopup')).toBe('dialog');
  expect(email.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(email);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog').id).toBe(email.getAttribute('aria-controls'));
  expect(email.getAttribute('aria-expanded')).toBe('true');
});

it.each(['close button', 'Escape', 'backdrop'])('preserves drafts and suppresses restored focus after %s dismissal', async dismissal => {
  user.role = 'Client Admin';
  render(<ProfileForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const first = screen.getByLabelText('First Name') as HTMLInputElement;
  const last = screen.getByLabelText('Last Name') as HTMLInputElement;
  const phone = screen.getByLabelText('Phone Number') as HTMLInputElement;
  const email = screen.getByLabelText('Email Address') as HTMLInputElement;
  fireEvent.change(first, { target: { value: 'Unsaved' } });
  fireEvent.change(last, { target: { value: 'Reyes2' } });
  fireEvent.change(phone, { target: { value: '9123456789' } });
  act(() => email.focus());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  if (dismissal === 'close button') fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  else if (dismissal === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  else fireEvent.click(screen.getByRole('dialog').previousElementSibling!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(email);
  expect(email.getAttribute('aria-expanded')).toBe('false');
  expect(email.value).toBe(user.email);
  expect(first.value).toBe('Unsaved');
  expect(last.value).toBe('Reyes2');
  expect(phone.value).toBe('9123456789');
  expect(screen.getByText('Last name must not contain numbers.')).toBeTruthy();

  // A click on the already-focused trigger must still reopen the modal.
  fireEvent.click(email);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => first.focus());
  act(() => email.focus());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('saves only ordinary profile fields after modal dismissal and Cancel still discards edits', async () => {
  user.role = 'Client Admin';
  mocks.save.mockResolvedValue(undefined);
  render(<ProfileForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Anne' } });
  fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '9123456789' } });
  act(() => screen.getByLabelText('Email Address').focus());
  fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'pending@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ firstName: 'Anne', lastName: 'Lovelace', phone: '+639123456789' });
  expect(screen.getByLabelText('Email Address').textContent).toBe(user.email);
  expect(mocks.requestEmail).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Discard' } });
  act(() => screen.getByLabelText('Email Address').focus());
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((screen.getByLabelText('First Name') as HTMLInputElement).value).toBe('Ada');
  expect(screen.getByLabelText('Email Address').tagName).toBe('P');
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it.each(['User', 'Sales', 'Admin', 'Client Administrator'])('keeps email read-only and other fields editable for %s', role => {
  user.role = role;
  render(<ProfileForm />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const email = screen.getByLabelText('Email Address');
  expect(email.tagName).toBe('P');
  expect((screen.getByLabelText('First Name') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('Last Name') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('Phone Number') as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(email);
  fireEvent.focus(email);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Change email')).toBeNull();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.requestEmail).not.toHaveBeenCalled();
});

it('waits for server confirmation, blocks duplicate saves and remains editable on failure', async () => {
  user.role = 'Client Admin';
  let reject!: (reason: Error) => void;
  mocks.save.mockReturnValue(new Promise((_, r) => { reject = r; }));
  render(<ProfileForm />);
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Adele' } });
  fireEvent.click(screen.getByText('Save Changes'));
  expect(mocks.success).not.toHaveBeenCalled();
  expect((screen.getByText('Saving…') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Email Address') as HTMLInputElement).disabled).toBe(true);
  reject(new Error('Server rejected update'));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Server rejected update'));
  expect(screen.getByText('Save Changes')).toBeTruthy();
  mocks.save.mockResolvedValue(undefined);
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('email');
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('role');
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('timeZone');
  expect(screen.getByText('Edit')).toBeTruthy();
});
it('rejects invalid file types and oversized files without uploading', async () => {
  render(<ProfileForm />); fireEvent.click(screen.getByText('Edit'));
  const picker = screen.getByLabelText('Choose profile picture');
  fireEvent.change(picker, { target: { files: [new File(['html'], 'test.html', { type: 'text/html' })] } });
  const big = new File(['x'], 'large.png', { type: 'image/png' }); Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
  fireEvent.change(picker, { target: { files: [big] } });
  expect(mocks.error).toHaveBeenCalledTimes(2);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it('shows field errors for overlong profile fields and reuses the PH mobile rule', async () => {
  render(<ProfileForm />); fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'A'.repeat(51) } });
  expect((screen.getByLabelText('First Name') as HTMLInputElement).value).toBe('A'.repeat(51));
  expect(screen.getByText('First name must not exceed 50 characters.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'B'.repeat(51) } });
  expect((screen.getByLabelText('Last Name') as HTMLInputElement).value).toBe('B'.repeat(51));
  expect(screen.getByText('Last name must not exceed 50 characters.')).toBeTruthy();
  fireEvent.click(screen.getByText('Save Changes'));
  expect(mocks.save).not.toHaveBeenCalled();
  const phone = screen.getByLabelText('Phone Number') as HTMLInputElement;
  expect(screen.getByText('+63')).toBeTruthy();
  fireEvent.change(phone, { target: { value: '9123456789abc' } });
  expect(phone.value).toBe('');
  expect(screen.getByText('Enter a valid 10-digit Philippine mobile number starting with 9.')).toBeTruthy();
  fireEvent.change(phone, { target: { value: '91234567890' } });
  expect(phone.value).toBe('');
  fireEvent.change(phone, { target: { value: '8123456789' } });
  expect(phone.value).toBe('8123456789');
  expect(screen.getByText('Enter a valid 10-digit Philippine mobile number starting with 9.')).toBeTruthy();
  fireEvent.change(phone, { target: { value: '+639123456789' } });
  expect(screen.getByText('Enter a valid 10-digit Philippine mobile number starting with 9.')).toBeTruthy();
  fireEvent.change(phone, { target: { value: '9123456789' } });
  expect(screen.queryByText('Enter a valid 10-digit Philippine mobile number starting with 9.')).toBeNull();
});

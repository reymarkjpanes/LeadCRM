import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), reset: vi.fn(), success: vi.fn(), error: vi.fn(), getGroups: vi.fn(), actor: { role: 'User', tenantId: 't' } }));
vi.mock('@/features/tenant/administration/users/services/users.service', () => ({ usersService: { create: mocks.create, update: mocks.update, sendPasswordReset: mocks.reset } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ userCan: () => true, user: mocks.actor }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/shared/services/groups.api', () => ({ groupsApi: { getAll: mocks.getGroups } }));
import { UserPanel } from '../user-panel';
import type { User } from '@/store/types';
const user: User = { id: 'u', tenantId: 't', firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@camxian.com', role: 'Sales', status: 'active', phone: '+639171234567', jobTitle: 'Agent' };
const roles = [{ id: 'r', name: 'Sales' }];
const renderPanel = (saved?: User) => { const onSaved = vi.fn(), onClose = vi.fn(); render(<UserPanel user={saved} roles={roles} canEdit onSaved={onSaved} onClose={onClose} />); return { onSaved, onClose }; };
beforeEach(() => { vi.resetAllMocks(); mocks.actor.role = 'User'; mocks.getGroups.mockResolvedValue({ data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales', members: [] }] }); });
afterEach(cleanup);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });

it('renders red required markers and one accessible error below each invalid control', () => {
  renderPanel();
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
  fireEvent.click(screen.getByText('Create User'));
  const fields = ['First Name', 'Last Name', 'Email', 'Phone', 'Role'];
  for (const label of fields) {
    const control = screen.getByLabelText(label, { exact: false });
    const error = document.getElementById(control.getAttribute('aria-describedby')!)!;
    const labelElement = document.querySelector(`label[for="${control.id}"]`)!;
    expect(labelElement.querySelector('.text-red-500')?.textContent).toBe('*');
    expect(labelElement.contains(error)).toBe(false);
    expect(control.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect((control as HTMLInputElement).required).toBe(true);
  }
  expect(screen.getAllByRole('alert')).toHaveLength(5);
  expect(mocks.create).not.toHaveBeenCalled();
  change('First Name', 'Juan');
  expect(screen.queryByText('First name is required.')).toBeNull();
  change('Phone', '8171234567');
  expect(screen.getByText('Philippine mobile number must start with 9.')).toBeTruthy();
  change('Phone', '917123456');
  expect(screen.getByText('Phone number must contain exactly 10 digits.')).toBeTruthy();
  change('Phone', '91712345678');
  expect((screen.getByLabelText('Phone', { exact: false }) as HTMLInputElement).value).toBe('9171234567');
  expect(screen.queryByText('Phone number must contain exactly 10 digits.')).toBeNull();
});

it('awaits creation, normalizes the API payload, blocks duplicates and preserves failed inputs', async () => {
  const { onClose, onSaved } = renderPanel();
  change('First Name', ' Juan '); change('Last Name', ' Dela Cruz '); change('Email', ' JUAN '); change('Phone', '9171234567'); change('Role', 'Sales');
  let reject!: (error: Error) => void;
  mocks.create.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const form = screen.getByLabelText('First Name', { exact: false }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz', phone: '+639171234567', email: 'juan@camxian.com', role: 'Sales' });
  expect(onClose).not.toHaveBeenCalled();
  reject(Object.assign(new Error('Email already exists'), { status: 409 }));
  await screen.findByText('Email already exists');
  expect((screen.getByLabelText('First Name', { exact: false }) as HTMLInputElement).value).toBe(' Juan ');
  change('Email', 'juan2');
  mocks.create.mockResolvedValueOnce({ data: user }); fireEvent.submit(form);
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(user));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('opens readonly, cancels to persisted values and keeps edit mode on failed saves', async () => {
  renderPanel(user);
  expect(screen.getByText('User Details')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByText('Edit User')); change('Job Title', 'Changed');
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByText('Agent')).toBeTruthy();
  fireEvent.click(screen.getByText('Edit User')); change('Job Title', ' Manager ');
  mocks.update.mockRejectedValueOnce(new Error('Unavailable')); fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Unavailable'));
  expect((screen.getByLabelText('Job Title') as HTMLInputElement).value).toBe(' Manager ');
  mocks.update.mockResolvedValueOnce({ data: { ...user, jobTitle: 'Manager' } }); fireEvent.click(screen.getByText('Save Changes'));
  await screen.findByText('Manager'); expect(screen.queryByRole('textbox')).toBeNull();
  expect(mocks.update.mock.lastCall?.[1]).not.toHaveProperty('email');
  mocks.reset.mockResolvedValue({ success: true }); fireEvent.click(screen.getByText('Send Password Reset'));
  await waitFor(() => expect(mocks.reset).toHaveBeenCalledWith(user.id));
});

it('shows placeholders and a locked domain and rejects invalid usernames', () => {
  renderPanel();
  for (const placeholder of ['e.g. Juan', 'e.g. Dela Cruz', 'e.g. juan.delacruz', '9xxxxxxxxx', 'e.g. Sales Representative']) expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
  const suffix = screen.getByText('@camxian.com');
  expect(suffix.tagName).toBe('SPAN');
  const email = screen.getByLabelText('Email', { exact: false }) as HTMLInputElement;
  change('Email', 'someone@gmail.com'); expect(email.value).toBe('');
  for (const invalid of ['bad user', 'bad!user', 'bad..user', 'bad\u0001user']) {
    change('Email', invalid); fireEvent.blur(email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
  }
  change('Email', ' Juan.Dela_Cruz+sales-2 '); fireEvent.blur(email);
  expect(email.getAttribute('aria-invalid')).toBe('false');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('admin edits existing Groups while ordinary staff cannot grant themselves membership', async () => {
  mocks.actor.role = 'Client Admin'; renderPanel(user); fireEvent.click(screen.getByText('Edit User'));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Sales' }));
  mocks.update.mockResolvedValue({ data: { ...user, groups: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales' }] } });
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('u', expect.objectContaining({ groupIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] })));
  expect(screen.queryByLabelText('Department')).toBeNull();
});
it('clearing all Groups submits an explicit empty membership list', async () => {
  mocks.actor.role = 'Client Admin'; renderPanel({ ...user, groups: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales' }] });
  fireEvent.click(screen.getByText('Edit User')); fireEvent.click(await screen.findByRole('checkbox', { name: 'Sales' }));
  mocks.update.mockResolvedValue({ data: { ...user, groups: [] } }); fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('u', expect.objectContaining({ groupIds: [] })));
});

import React from 'react';
vi.mock('@/shared/hooks/use-email-availability', () => ({ useEmailAvailability: (email: string) => ({ available: true, blocked: false, confirm: () => true, email: email.trim().toLowerCase(), retry: vi.fn(), reject: vi.fn() }) }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Archive, UserX } from 'lucide-react';
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), reset: vi.fn(), success: vi.fn(), error: vi.fn(), getGroups: vi.fn(), denied: new Set<string>(), actor: { role: 'User', tenantId: 't' } }));
vi.mock('@/features/tenant/administration/users/services/users.service', () => ({ usersService: { create: mocks.create, update: mocks.update, sendPasswordReset: mocks.reset } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ userCan: (module: string, action: string) => !mocks.denied.has(`${module}.${action}`), user: mocks.actor }) }));
vi.mock('@/shared/utils/toast', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/shared/services/groups.api', () => ({ groupsApi: { getAll: mocks.getGroups } }));
import { UserPanel } from '../user-panel';
import type { User } from '@/store/types';
const user: User = { id: 'u', tenantId: 't', firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@camxian.com', role: 'Sales', status: 'active', phone: '+639171234567', jobTitle: 'Agent' };
const roles = [{ id: 'r', name: 'Sales' }];
const renderPanel = (saved?: User, props: Partial<React.ComponentProps<typeof UserPanel>> = {}) => { const onSaved = vi.fn(), onClose = vi.fn(); const view = render(<UserPanel user={saved} roles={roles} canEdit onSaved={onSaved} onClose={onClose} {...props} />); return { onSaved, onClose, ...view }; };
beforeEach(() => { vi.resetAllMocks(); mocks.denied.clear(); mocks.actor.role = 'User'; mocks.getGroups.mockResolvedValue({ data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales', members: [] }] }); });
afterEach(cleanup);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
const groupChoices = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales', members: [] },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'IT', members: [] },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Operations', members: [] },
];
const fillNewUser = () => {
  change('First Name', 'New'); change('Last Name', 'Staff'); change('Email', 'new@camxian.com'); change('Phone', '9171234567'); change('Role', 'Sales');
};

it('checks both new user names as they change and blocks creation until corrected', async () => {
  mocks.create.mockResolvedValue({ data: user });
  renderPanel();
  fillNewUser();
  change('First Name', 'John123');
  const firstError = screen.getByText('First name must not contain numbers.');
  expect(screen.getByLabelText('First Name', { exact: false }).getAttribute('aria-describedby')).toBe(firstError.id);
  change('Last Name', '123');
  const lastError = screen.getByText('Last name must not contain numbers.');
  const create = screen.getByRole('button', { name: 'Create User' });
  fireEvent.click(create);
  expect(mocks.create).not.toHaveBeenCalled();

  change('First Name', 'María');
  expect(screen.queryByText(firstError.textContent!)).toBeNull();
  expect(lastError.isConnected).toBe(true);
  fireEvent.click(create);
  expect(mocks.create).not.toHaveBeenCalled();
  change('Last Name', 'O’Connor');
  expect(screen.queryByText(lastError.textContent!)).toBeNull();
  fireEvent.click(create);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ firstName: 'María', lastName: 'O’Connor' })));
});

it('submits a Client Admin selection from an existing admin without changing the create payload shape', async () => {
  mocks.actor.role = 'Client Admin';
  const created = { ...user, role: 'Client Admin' };
  mocks.create.mockResolvedValue({ data: created });
  const { onSaved } = renderPanel(undefined, { roles: [...roles, { id: 'admin-role', name: 'Client Admin' }] });
  fillNewUser(); change('Role', 'Client Admin');
  fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ role: 'Client Admin', email: 'new@camxian.com' });
  expect(screen.queryByText(/The same memberships are used by workflow assignment/)).toBeNull();
});

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
  change('First Name', ' Juan '); change('Last Name', ' Dela Cruz '); change('Email', ' JUAN@CAMXIAN.COM '); change('Phone', '9171234567'); change('Role', 'Sales');
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
  change('Email', 'juan2@camxian.com');
  mocks.create.mockResolvedValueOnce({ data: user }); fireEvent.submit(form);
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(user));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('renders the user identity, two accessible accordions, every field and only the password reset footer', () => {
  renderPanel({ ...user, phone: undefined, jobTitle: undefined });
  const panel = screen.getByRole('dialog', { name: 'User Details' });
  expect(within(panel).getByRole('heading', { name: 'Juan Dela Cruz' })).toBeTruthy();
  for (const section of ['Basic Information', 'Organization']) {
    const trigger = within(panel).getByRole('button', { name: section });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const content = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    fireEvent.click(trigger); expect(content.hidden).toBe(true);
    fireEvent.click(trigger); expect(content.hidden).toBe(false);
  }
  for (const field of ['First Name', 'Last Name', 'Email', 'Phone', 'Role', 'Job Title', 'Status', 'Groups']) expect(within(panel).getByText(field, { exact: true })).toBeTruthy();
  for (const value of ['Juan', 'Dela Cruz', user.email, 'Active', 'No groups assigned']) expect(within(panel).getByText(value, { exact: true })).toBeTruthy();
  expect(within(panel).getAllByText('—')).toHaveLength(2);
  expect(within(panel).queryByRole('tablist')).toBeNull();
  expect(within(panel).queryByRole('tab')).toBeNull();
  for (const name of ['Edit User', 'Save Changes', 'Approve registered email', 'Edit Email', 'Edit Status']) expect(within(panel).queryByRole('button', { name })).toBeNull();
  const reset = within(panel).getByRole('button', { name: 'Send Password Reset' });
  expect(within(reset.parentElement!).getAllByRole('button')).toHaveLength(1);
});

it.each([
  ['firstName', 'First Name', ' Maria ', 'Maria'],
  ['lastName', 'Last Name', ' Reyes ', 'Reyes'],
  ['phone', 'Phone', '09181234567', '+639181234567'],
] as const)('saves only %s and synchronizes the persisted value without closing', async (field, label, input, persisted) => {
  const updated = { ...user, [field]: persisted };
  const { onSaved, onClose } = renderPanel(user);
  mocks.update.mockResolvedValue({ data: updated });
  fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` })); change(label, input);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith(user.id, { [field]: persisted });
  expect(screen.getByRole('button', { name: `Edit ${label}` }).textContent).toContain(persisted);
  expect(onClose).not.toHaveBeenCalled();
});

it('cancels only the current field and retains other field drafts across a parent refresh', () => {
  const { rerender, onSaved, onClose } = renderPanel(user);
  fireEvent.click(screen.getByRole('button', { name: 'Edit First Name' })); change('First Name', 'Draft');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Last Name' })); change('Last Name', 'Discard');
  const lastNameEditor = screen.getByRole('textbox', { name: 'Last Name' }).closest('dd')!;
  fireEvent.click(within(lastNameEditor).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Edit Last Name' }).textContent).toContain('Dela Cruz');
  expect(screen.queryByRole('button', { name: 'Edit Job Title' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit Email' })).toBeNull();
  rerender(<UserPanel user={{ ...user, lastName: 'Refreshed' }} roles={roles} canEdit onSaved={onSaved} onClose={onClose} />);
  expect(screen.getByRole('textbox', { name: 'First Name' })).toHaveProperty('value', 'Draft');
  expect(screen.getByText('Refreshed', { exact: true })).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('keeps a failed editor and persisted value, shows server field errors and allows retry', async () => {
  const { onSaved } = renderPanel(user);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Last Name' })); change('Last Name', ' Manager ');
  mocks.update.mockRejectedValueOnce(Object.assign(new Error('Invalid input'), { fieldErrors: { lastName: ['Try another name'] } }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Try another name');
  expect(screen.getByRole('textbox', { name: 'Last Name' })).toHaveProperty('value', ' Manager ');
  expect(onSaved).not.toHaveBeenCalled();
  mocks.update.mockResolvedValue({ data: { ...user, lastName: 'Manager' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('button', { name: 'Edit Last Name' });
  expect(screen.getByText('Manager', { exact: true })).toBeTruthy();
});

it.each(['', 'bad\u0001', 'a'.repeat(101)])('rejects invalid inline names without calling the API', async value => {
  renderPanel(user); fireEvent.click(screen.getByRole('button', { name: 'Edit First Name' })); change('First Name', value);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'First Name' })).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('validates inline phone input once and retains its draft', async () => {
  renderPanel(user); fireEvent.click(screen.getByRole('button', { name: 'Edit Phone' })); change('Phone', '8171234567');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Philippine mobile number must start with 9.');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByLabelText('Phone').getAttribute('aria-invalid')).toBe('true');
  expect(mocks.update).not.toHaveBeenCalled();
});

it('blocks duplicate and concurrent saves without discarding a waiting field draft', async () => {
  renderPanel(user);
  fireEvent.click(screen.getByRole('button', { name: 'Edit First Name' })); change('First Name', 'Maria');
  let resolve!: (value: unknown) => void;
  mocks.update.mockReturnValue(new Promise(done => { resolve = done; }));
  const firstSave = screen.getByRole('button', { name: 'Save' }); fireEvent.click(firstSave); fireEvent.click(firstSave);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Last Name' })); change('Last Name', 'Waiting');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Another request is in progress. Please try again.')).toBeTruthy();
  expect(mocks.update).toHaveBeenCalledTimes(1);
  resolve({ data: { ...user, firstName: 'Maria' } });
  await screen.findByRole('button', { name: 'Edit First Name' });
  expect(screen.getByRole('textbox', { name: 'Last Name' })).toHaveProperty('value', 'Waiting');
});

it('allows role-only assignment and protects Client Admin and permission-denied roles', async () => {
  const { rerender, onSaved, onClose } = renderPanel(user, { canEdit: false, roles: [...roles, { id: 'manager', name: 'Manager' }] });
  expect(screen.queryByRole('button', { name: 'Edit First Name' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Role' })); change('Role', 'Manager');
  mocks.update.mockResolvedValue({ data: { ...user, role: 'Manager' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith(user.id, { role: 'Manager' }));
  rerender(<UserPanel user={{ ...user, role: 'Client Admin' }} roles={roles} canEdit onSaved={onSaved} onClose={onClose} />);
  expect(screen.queryByRole('button', { name: 'Edit Role' })).toBeNull();
  mocks.denied.add('roles.canAssign');
  rerender(<UserPanel user={user} roles={roles} canEdit onSaved={onSaved} onClose={onClose} />);
  expect(screen.queryByRole('button', { name: 'Edit Role' })).toBeNull();
});

it.each([{ canEdit: false, status: 'active', role: 'Client Admin', denied: false }, { canEdit: true, status: 'inactive', role: 'Client Admin', denied: false }, { canEdit: true, status: 'active', role: 'User', denied: false }, { canEdit: true, status: 'active', role: 'Client Admin', denied: true }])('protects Groups for %j', props => {
  mocks.actor.role = props.role; if (props.denied) mocks.denied.add('groups.canEdit');
  renderPanel({ ...user, status: props.status as User['status'] }, { canEdit: props.canEdit });
  expect(screen.queryByRole('button', { name: 'Edit Groups' })).toBeNull();
});

it('has a header menu before Close, with icons, callbacks, disabled reasons and owned Escape behavior', () => {
  const deactivate = vi.fn(), archive = vi.fn();
  renderPanel(user, { actions: [{ id: 'status', label: 'Deactivate', icon: <UserX />, onClick: deactivate }, { id: 'archive', label: 'Archive', icon: <Archive />, disabled: true, disabledReason: 'Protected user', onClick: archive }] });
  const trigger = screen.getByRole('button', { name: 'User actions' }), close = screen.getByRole('button', { name: 'Close drawer' });
  expect(trigger.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(trigger);
  for (const action of screen.getAllByRole('menuitem')) expect(action.querySelector('svg')).toBeTruthy();
  const disabled = screen.getByRole('menuitem', { name: 'Archive' }); expect(disabled).toHaveProperty('disabled', true);
  expect(document.getElementById(disabled.getAttribute('aria-describedby')!)?.textContent).toBe('Protected user');
  fireEvent.click(disabled); expect(archive).not.toHaveBeenCalled();
  const item = screen.getByRole('menuitem', { name: 'Deactivate' }); item.focus(); fireEvent.keyDown(item, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(screen.getByRole('dialog')).toBeTruthy(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' })); expect(deactivate).toHaveBeenCalledOnce();
});

it('uses authorized avatars and retains initials when the image fails', () => {
  renderPanel({ ...user, avatarUrl: '/api/proxy/auth/profile/avatar/stored' });
  const avatar = screen.getByRole('img', { name: 'Juan Dela Cruz' });
  expect(avatar.getAttribute('src')).toBe('/api/proxy/administration/users/u/avatar/stored');
  fireEvent.error(avatar); expect(screen.getByText('JD')).toBeTruthy();
});

it.each([{ canEdit: false, status: 'active' }, { canEdit: true, status: 'inactive' }])('disables password recovery for %j', props => {
  renderPanel({ ...user, status: props.status as User['status'] }, { canEdit: props.canEdit });
  const reset = screen.getByRole('button', { name: 'Send Password Reset' }); expect(reset).toHaveProperty('disabled', true);
  fireEvent.click(reset); expect(mocks.reset).not.toHaveBeenCalled();
});
it('requests password recovery through the unchanged service and prevents duplicates', async () => {
  renderPanel(user); mocks.reset.mockResolvedValue({ success: true });
  const reset = screen.getByRole('button', { name: 'Send Password Reset' }); fireEvent.click(reset); fireEvent.click(reset);
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Password reset email requested.'));
  expect(mocks.reset).toHaveBeenCalledExactlyOnceWith(user.id);
});

it('accepts full registered email addresses and rejects malformed addresses', () => {
  renderPanel();
  for (const placeholder of ['e.g. Juan', 'e.g. Dela Cruz', 'e.g. juan@camxian.com', '9xxxxxxxxx', 'e.g. Sales Representative']) expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
  expect(screen.queryByText('@camxian.com')).toBeNull();
  const email = screen.getByLabelText('Email', { exact: false }) as HTMLInputElement;
  change('Email', 'someone@gmail.com'); expect(email.value).toBe('someone@gmail.com');
  for (const invalid of ['bad user@gmail.com', 'missing-domain', 'bad..user@gmail.com', 'bad\u0001user@gmail.com']) {
    change('Email', invalid); fireEvent.blur(email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
  }
  change('Email', ' Juan.Dela_Cruz+sales-2@camxian.com '); fireEvent.blur(email);
  expect(email.getAttribute('aria-invalid')).toBe('false');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('lets Client Admin provision Gmail staff using the exact full address', async () => {
  mocks.actor.role = 'Client Admin'; renderPanel();
  change('First Name', 'New'); change('Last Name', 'Staff'); change('Email', ' NEW.STAFF@GMAIL.COM '); change('Phone', '9171234567'); change('Role', 'Sales');
  mocks.create.mockResolvedValue({ data: { ...user, email: 'new.staff@gmail.com' } });
  fireEvent.click(screen.getByText('Create User'));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'new.staff@gmail.com' })));
});
it('does not let delegated staff approve an external email', async () => {
  renderPanel();
  change('First Name', 'New'); change('Last Name', 'Staff'); change('Email', 'new@gmail.com'); change('Phone', '9171234567'); change('Role', 'Sales');
  fireEvent.click(screen.getByText('Create User'));
  expect(screen.getByText('Only Client Admin users can approve an external staff email.')).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('selects multiple New User Groups in a dropdown and submits their IDs through the existing create service', async () => {
  mocks.actor.role = 'Client Admin'; mocks.getGroups.mockResolvedValue({ data: groupChoices });
  renderPanel(); fillNewUser();
  const trigger = screen.getByRole('button', { name: 'Groups' });
  await waitFor(() => expect(trigger).toHaveProperty('disabled', false));
  expect(trigger.textContent).toBe('Select groups...');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(/The same memberships are used by workflow assignment/)).toBeNull();
  fireEvent.click(trigger);
  for (const group of groupChoices) expect(screen.getByRole('checkbox', { name: group.name })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sales' }));
  expect(trigger.textContent).toBe('Sales');
  fireEvent.click(screen.getByRole('checkbox', { name: 'IT' }));
  expect(trigger.textContent).toBe('2 selected');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Operations' }));
  expect(trigger.textContent).toBe('3 selected');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Operations' }));
  expect(trigger.textContent).toBe('2 selected');
  fireEvent.keyDown(screen.getByRole('checkbox', { name: 'IT' }), { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'New User' })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(screen.getByRole('checkbox', { name: 'Sales' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'IT' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'Operations' })).toHaveProperty('checked', false);
  fireEvent.keyDown(document, { key: 'Escape' });
  mocks.create.mockResolvedValue({ data: user });
  fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
  expect(trigger).toHaveProperty('disabled', true);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ groupIds: [groupChoices[0].id, groupChoices[1].id] })));
  expect(mocks.getGroups).toHaveBeenCalledTimes(1);
});

it('clears only the New User Group validation error when selection changes', async () => {
  mocks.actor.role = 'Client Admin'; renderPanel(); fillNewUser();
  const trigger = screen.getByRole('button', { name: 'Groups' });
  await waitFor(() => expect(trigger).toHaveProperty('disabled', false));
  mocks.create.mockRejectedValueOnce(Object.assign(new Error('Invalid input'), { fieldErrors: { groupIds: ['Choose an available group.'], jobTitle: ['Try another title.'] } }));
  fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
  await screen.findByText('Choose an available group.');
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('checkbox', { name: 'Sales' }));
  expect(screen.queryByText('Choose an available group.')).toBeNull();
  expect(screen.getByText('Try another title.')).toBeTruthy();
});

it('preserves New User Groups loading and error messages and disables the selector until recovery', async () => {
  mocks.actor.role = 'Client Admin';
  let reject!: (error: Error) => void;
  mocks.getGroups.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  renderPanel();
  const trigger = screen.getByRole('button', { name: 'Groups' });
  expect(screen.getByRole('status').textContent).toBe('Loading available groups…');
  expect(trigger).toHaveProperty('disabled', true);
  fireEvent.click(trigger); expect(screen.queryByRole('checkbox')).toBeNull();
  reject(new Error('Unavailable'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Groups could not load. Manage memberships in the Groups tab.');
  expect(screen.queryByRole('status')).toBeNull();
  expect(trigger).toHaveProperty('disabled', true);
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent(window, new Event('leadcrm:groups-changed'));
  await waitFor(() => expect(trigger).toHaveProperty('disabled', false));
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole('checkbox', { name: 'Sales' })).toBeTruthy();
});

it('shows the New User empty Groups message inside the dropdown', async () => {
  mocks.actor.role = 'Client Admin'; mocks.getGroups.mockResolvedValue({ data: [] }); renderPanel();
  const trigger = screen.getByRole('button', { name: 'Groups' });
  await waitFor(() => expect(trigger).toHaveProperty('disabled', false));
  expect(screen.queryByText('No groups have been created.')).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText('No groups have been created.')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it.each([
  { role: 'User', canEdit: true, denied: false },
  { role: 'Client Admin', canEdit: false, denied: false },
  { role: 'Client Admin', canEdit: true, denied: true },
])('preserves New User Group restrictions for %j', props => {
  mocks.actor.role = props.role; if (props.denied) mocks.denied.add('groups.canEdit');
  renderPanel(undefined, { canEdit: props.canEdit });
  expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('No groups assigned')).toBeTruthy();
  expect(mocks.getGroups).not.toHaveBeenCalled();
});

it('admin edits existing Groups while ordinary staff cannot grant themselves membership', async () => {
  mocks.actor.role = 'Client Admin'; renderPanel(user); fireEvent.click(screen.getByRole('button', { name: 'Edit Groups' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Sales' }));
  mocks.update.mockResolvedValue({ data: { ...user, groups: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales' }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('u', { groupIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }));
  expect(screen.getByRole('button', { name: 'Edit Groups' }).textContent).toBe('Sales');
  expect(screen.queryByLabelText('Department')).toBeNull();
});
it('clearing all Groups submits an explicit empty membership list', async () => {
  mocks.actor.role = 'Client Admin'; renderPanel({ ...user, groups: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Groups' })); fireEvent.click(await screen.findByRole('checkbox', { name: 'Sales' }));
  mocks.update.mockResolvedValue({ data: { ...user, groups: [] } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('u', { groupIds: [] }));
});

it('blocks membership saves during loading or failure and refreshes group choices without losing drafts', async () => {
  mocks.actor.role = 'Client Admin';
  const sales = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Sales', members: [] };
  const marketing = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Marketing', members: [] };
  let reject!: (error: Error) => void;
  mocks.getGroups.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  renderPanel({ ...user, groups: [sales] });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Groups' }));
  expect(screen.getByRole('status').textContent).toContain('Loading');
  expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  reject(new Error('Unavailable'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Groups could not load. Manage memberships in the Groups tab.');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.getGroups.mockResolvedValue({ data: [sales, marketing] });
  fireEvent(window, new Event('leadcrm:groups-changed'));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Marketing' }));
  expect(screen.queryByRole('alert')).toBeNull();
  mocks.getGroups.mockResolvedValue({ data: [{ ...sales, name: 'Renamed Sales' }, marketing] });
  fireEvent(window, new Event('leadcrm:groups-changed'));
  expect(await screen.findByRole('checkbox', { name: 'Renamed Sales' })).toHaveProperty('checked', true);
  expect(screen.getByRole('checkbox', { name: 'Marketing' })).toHaveProperty('checked', true);
  mocks.update.mockResolvedValue({ data: { ...user, groups: [sales, marketing] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('u', { groupIds: [sales.id, marketing.id] }));
});

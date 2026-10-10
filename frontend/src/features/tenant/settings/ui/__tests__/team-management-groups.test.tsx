import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupsSubTab } from '../team-management-groups';
import type { TenantGroup } from '@leadcrm/shared';
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), success: vi.fn(), error: vi.fn(), role: 'Client Admin' }));
vi.mock('@/shared/services/groups.api', () => ({ groupsApi: mocks }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { role: mocks.role }, userCan: () => true }) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('sonner', () => ({ toast: mocks }));
const user = { id: 'julie', firstName: 'Julie Ann', lastName: 'Tiron', email: 'julie@example.com', role: 'Sales Marketing' };
const group = (members = true): TenantGroup => ({ id: 'sales', tenantId: 'tenant', name: 'Sales', createdAt: '', updatedAt: '', members: members ? [{ id: 'membership', userId: user.id, user }] : [] });
const mount = () => render(<GroupsSubTab tenantUsers={[user] as never} />);
const openGroup = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Open Sales' })); };
beforeEach(() => { vi.clearAllMocks(); mocks.role = 'Client Admin'; mocks.getAll.mockResolvedValue({ data: [group()] }); mocks.remove.mockResolvedValue(undefined); mocks.removeMember.mockResolvedValue(undefined); mocks.addMember.mockResolvedValue(undefined); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses initial skeletons, searches groups and retains rows during background refresh', async () => {
  let resolve!: (value: unknown) => void; mocks.getAll.mockReturnValueOnce(new Promise(done => { resolve = done; })); mount();
  expect(screen.getByRole('status', { name: 'Loading groups' })).toBeTruthy(); expect(screen.queryByText(/Loading groups/)).toBeNull(); expect(screen.queryByRole('button', { name: /Filter/ })).toBeNull();
  await act(async () => resolve({ data: [group()] }));
  fireEvent.change(screen.getByLabelText('Search groups'), { target: { value: 'none' } }); expect(screen.getByText('No groups match your search.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search groups'), { target: { value: 'sal' } }); expect(screen.getByText('Sales')).toBeTruthy();
  mocks.getAll.mockReturnValueOnce(new Promise(done => { resolve = done; })); const refresh = screen.getByRole('button', { name: 'Refresh' }); fireEvent.click(refresh); fireEvent.click(refresh);
  expect(screen.getByText('Sales')).toBeTruthy(); expect(screen.queryByRole('status', { name: 'Loading groups' })).toBeNull(); expect(mocks.getAll).toHaveBeenCalledTimes(2); await act(async () => resolve({ data: [group()] }));
});

it('refetches a Group change that arrives while the first response is in flight', async () => {
  let resolve!: (value: unknown) => void;
  mocks.getAll.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ data: [{ ...group(), name: 'Sales renamed' }] });
  mount();
  await act(async () => window.dispatchEvent(new Event('leadcrm:groups-changed')));
  await act(async () => resolve({ data: [group()] }));
  expect(await screen.findByText('Sales renamed')).toBeTruthy();
  expect(mocks.getAll).toHaveBeenCalledTimes(2);
});
it('requires trimmed names and creates a group with zero optional members, without duplicate requests', async () => {
  mount(); await screen.findByText('Sales'); fireEvent.click(screen.getByRole('button', { name: 'New Group' }));
  const field = screen.getByRole('textbox', { name: /^Name/ }); expect(field.hasAttribute('required')).toBe(true);
  fireEvent.change(field, { target: { value: '   ' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
  expect(await screen.findByText('Name is required.')).toBeTruthy(); expect(mocks.create).not.toHaveBeenCalled(); expect(field.getAttribute('aria-invalid')).toBe('true');
  let resolve!: (value: unknown) => void; mocks.create.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.change(field, { target: { value: ' Support ' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
  fireEvent.submit(field.closest('form')!); expect(mocks.create).toHaveBeenCalledExactlyOnceWith('Support');
  await act(async () => resolve({ data: { ...group(false), id: 'support', name: 'Support' } }));
  expect(mocks.success).toHaveBeenCalledWith('Group created successfully.'); expect(mocks.addMember).not.toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'Support' })).toBeTruthy();
});
it.each(['Julie', 'Tiron', 'Julie Ann Tiron', 'julie@example', 'Sales Marketing'])('searches actual group members by %s', async query => {
  // Deliberately omit tenantUsers: the group response is the complete membership source.
  render(<GroupsSubTab tenantUsers={[]} />); await openGroup(); fireEvent.change(screen.getByLabelText('Search members...'), { target: { value: query } }); expect(screen.getByText('Julie Ann Tiron')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search members...'), { target: { value: 'no match' } }); expect(screen.getByText('No members match your search.')).toBeTruthy();
});
it('lets other roles view members but hides membership controls', async () => {
  mocks.role = 'Sales'; mount(); await openGroup();
  expect(screen.getByText('Julie Ann Tiron')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add Members' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove Julie Ann Tiron' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit group' })).toBeTruthy();
});
it('requires removal confirmation, traps focus, cancels safely and updates membership/counts after success', async () => {
  mount(); await openGroup(); fireEvent.click(screen.getByRole('button', { name: 'Remove Julie Ann Tiron' }));
  expect(mocks.removeMember).not.toHaveBeenCalled(); const dialog = screen.getByRole('alertdialog'); expect(dialog.textContent).toContain('remove Julie Ann Tiron');
  const remove = within(dialog).getByRole('button', { name: 'Remove Member' }); remove.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close confirmation' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(mocks.removeMember).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Julie Ann Tiron' })); fireEvent.click(screen.getByRole('button', { name: 'Remove Member' }));
  await waitFor(() => expect(mocks.removeMember).toHaveBeenCalledWith('sales', 'julie')); await waitFor(() => expect(screen.queryByText('Julie Ann Tiron')).toBeNull()); expect(mocks.success).toHaveBeenCalledWith('Member removed successfully.');
});
it('blocks nonempty deletion and confirms empty deletion with the requested toast', async () => {
  const view = mount(); await screen.findByText('Sales'); fireEvent.click(screen.getByRole('button', { name: 'Delete Sales' })); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledWith('Remove all members from this group before deleting it.');
  view.unmount(); mocks.getAll.mockResolvedValue({ data: [group(false)] }); mount(); await screen.findByText('Sales'); fireEvent.click(screen.getByRole('button', { name: 'Delete Sales' })); expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Group' })); await screen.findByText('No groups yet.'); expect(mocks.success).toHaveBeenCalledWith('Group deleted successfully.');
});
it('preserves meaningful API failures and allows retry', async () => {
  mocks.getAll.mockRejectedValueOnce(new Error('Groups unavailable')); mount(); expect(await screen.findByRole('alert')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('Sales');
  fireEvent.click(screen.getByRole('button', { name: 'New Group' })); mocks.create.mockRejectedValueOnce(new Error('Duplicate group name')); fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Sales' } }); fireEvent.click(screen.getByRole('button', { name: 'Create Group' }));
  await screen.findByText('Duplicate group name'); expect(mocks.error).toHaveBeenCalledWith('Duplicate group name'); expect(screen.getByDisplayValue('Sales')).toBeTruthy();
});
it('renames a group and adds only available members with a success toast', async () => {
  mocks.getAll.mockResolvedValue({ data: [group(false)] }); mount(); fireEvent.click(await screen.findByRole('button', { name: 'Open Sales' }));
  mocks.update.mockResolvedValue({ data: { ...group(false), name: 'Sales team' } }); fireEvent.click(screen.getByRole('button', { name: 'Edit group' })); fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: ' Sales team ' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('heading', { name: 'Sales team' }); expect(mocks.update).toHaveBeenCalledWith('sales', 'Sales team');
  fireEvent.click(screen.getByRole('button', { name: 'Add Members' })); const dialog = screen.getByRole('dialog'); fireEvent.click(within(dialog).getByLabelText('Select Julie Ann Tiron'));
  mocks.getAll.mockResolvedValue({ data: [group()] }); fireEvent.click(within(dialog).getByRole('button', { name: 'Add Members' }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Member added successfully.')); expect(mocks.addMember).toHaveBeenCalledExactlyOnceWith('sales', 'julie');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Add Members' })); expect(screen.getByText('No users available.')).toBeTruthy();
});

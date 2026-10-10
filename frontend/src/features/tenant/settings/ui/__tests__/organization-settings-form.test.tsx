import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), apply: vi.fn(), success: vi.fn(), error: vi.fn(), canView: true, canEdit: true, tenant: 'tenant' }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: mocks.tenant }, userCan: (_module: string, action: string) => action === 'canView' ? mocks.canView : mocks.canEdit, applyOrganizationSettings: mocks.apply }) }));
vi.mock('../../services/settings.service', () => ({ settingsApiService: { getOrganization: mocks.get, updateOrganization: mocks.save } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
import { OrganizationSettingsForm } from '../organization-settings-form';
const saved = { id: 'tenant', status: 'ACTIVE', name: 'Original', industry: 'Technology', email: 'info@example.com', phone: '+63281233488', domain: 'example.com', address: 'Manila' };
beforeEach(() => { vi.resetAllMocks(); mocks.canView = true; mocks.canEdit = true; mocks.tenant = 'tenant'; mocks.get.mockResolvedValue({ data: saved }); });
afterEach(cleanup);
const name = () => screen.getByRole('textbox', { name: 'Organization Name' }) as HTMLInputElement;

it('hydrates readonly values, Edit enables fields, Cancel restores the persisted snapshot', async () => {
  render(<OrganizationSettingsForm />);
  await screen.findByDisplayValue('Original');
  expect(name().readOnly).toBe(true);
  expect(screen.queryByText('Save Changes')).toBeNull();
  fireEvent.click(screen.getByText('Edit'));
  expect(name().readOnly).toBe(false);
  fireEvent.change(name(), { target: { value: 'Unsaved' } });
  fireEvent.click(screen.getByText('Cancel'));
  expect(name().value).toBe('Original');
  expect(name().readOnly).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('blocks duplicate saves, retains edits on failure, and displays the canonical saved response on retry', async () => {
  let reject!: (error: Error) => void;
  mocks.save.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original');
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(name(), { target: { value: ' Changed ' } });
  const form = name().closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.success).not.toHaveBeenCalled();
  reject(new Error('Save failed'));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Save failed'));
  expect(name().value).toBe(' Changed ');
  expect(name().readOnly).toBe(false);
  mocks.save.mockResolvedValue({ data: { ...saved, name: 'Changed' } });
  fireEvent.submit(form);
  await waitFor(() => expect(name().readOnly).toBe(true));
  expect(name().value).toBe('Changed');
  expect(mocks.apply).toHaveBeenCalledWith({ ...saved, name: 'Changed' });
});

it('reloads from the API and never offers Edit without permission', async () => {
  mocks.canEdit = false;
  const view = render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original');
  expect(screen.queryByText('Edit')).toBeNull();
  expect(name().readOnly).toBe(true);
  view.unmount(); mocks.get.mockResolvedValue({ data: { ...saved, name: 'Persisted' } });
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Persisted');
  expect(mocks.get).toHaveBeenCalledTimes(2);
});

it('ignores stale fetches after a tenant change and resets editing', async () => {
  let resolve!: (value: { data: typeof saved }) => void;
  mocks.get.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(<OrganizationSettingsForm />);
  mocks.tenant = 'other'; mocks.get.mockResolvedValue({ data: { ...saved, id: 'other', name: 'Other' } });
  view.rerender(<OrganizationSettingsForm />); await screen.findByDisplayValue('Other');
  resolve({ data: saved });
  await waitFor(() => expect(name().value).toBe('Other'));
});

it('shows a structural skeleton without editable controls until the real response arrives', async () => {
  let resolve!: (value: { data: typeof saved }) => void;
  mocks.get.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<OrganizationSettingsForm />);
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading organization settings');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(6);
  resolve({ data: saved }); await screen.findByDisplayValue('Original');
  expect(screen.queryByRole('status')).toBeNull();
});

it('uses the fixed prefix, rejects letters, validates inline, and submits a normalized telephone', async () => {
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original');
  fireEvent.click(screen.getByText('Edit'));
  const phone = screen.getByLabelText('Phone') as HTMLInputElement;
  expect(screen.getByText('+63')).toBeTruthy(); expect(phone.value).toBe('(28) 123-3488');
  fireEvent.change(phone, { target: { value: 'fbdfbdgddfg' } });
  expect(phone.value).toBe('(28) 123-3488'); expect(screen.getByText('Enter a valid Philippine telephone number.')).toBeTruthy();
  fireEvent.change(phone, { target: { value: '123' } }); fireEvent.submit(phone.closest('form')!);
  expect(mocks.save).not.toHaveBeenCalled(); expect(phone.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(phone, { target: { value: '(28) 123-3488' } });
  mocks.save.mockResolvedValue({ data: saved }); fireEvent.submit(phone.closest('form')!);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ phone: '+63281233488' })));
});

it('shows backend field errors below the phone field without discarding edits', async () => {
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original'); fireEvent.click(screen.getByText('Edit'));
  mocks.save.mockRejectedValue(Object.assign(new Error('Telephone rejected'), { fieldErrors: { phone: ['Telephone rejected'] } }));
  fireEvent.click(screen.getByText('Save Changes')); await screen.findByText('Telephone rejected');
  expect((screen.getByLabelText('Phone') as HTMLInputElement).readOnly).toBe(false);
});

it('validates organization limits and domain-only values inline', async () => {
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original'); fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(name(), { target: { value: 'O'.repeat(151) } });
  expect(name().value).toBe('Original');
  expect(screen.getByText('Organization name must not exceed 150 characters.')).toBeTruthy();
  const email = screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'e'.repeat(255) } });
  expect(email.value).toBe(saved.email);
  expect(screen.getByText('Email must not exceed 254 characters.')).toBeTruthy();
  const domain = screen.getByRole('textbox', { name: 'Domain' }) as HTMLInputElement;
  fireEvent.change(domain, { target: { value: 'd'.repeat(254) } });
  expect(domain.value).toBe(saved.domain);
  expect(screen.getByText('Domain must not exceed 253 characters.')).toBeTruthy();
  fireEvent.change(domain, { target: { value: 'https://camxian.com' } });
  expect(screen.getByText('Enter a valid domain, such as camxian.com')).toBeTruthy();
  fireEvent.change(domain, { target: { value: 'CRM.Camxian.com' } });
  expect(screen.queryByText('Enter a valid domain, such as camxian.com')).toBeNull();
  const address = screen.getByRole('textbox', { name: 'Office Address' }) as HTMLTextAreaElement;
  fireEvent.change(address, { target: { value: 'a'.repeat(501) } });
  expect(address.value).toBe(saved.address);
  expect(screen.getByText('Address must not exceed 500 characters.')).toBeTruthy();
  fireEvent.submit(name().closest('form')!);
  expect(mocks.save).not.toHaveBeenCalled();
});

it.each([
  ['SANDBOX', 'Sandbox'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['CANCELLED', 'Cancelled'], ['DELETED', 'Deleted'],
])('displays persisted %s status and keeps system fields read-only during editing', async (status, label) => {
  mocks.get.mockResolvedValue({ data: { ...saved, status } });
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original');
  const system = screen.getByRole('region', { name: 'System Information' });
  expect(within(system).getByText(saved.id)).toBeTruthy();
  expect(within(system).getByText(label)).toBeTruthy();
  fireEvent.click(screen.getByText('Edit'));
  expect(system.querySelectorAll('input, select, textarea')).toHaveLength(0);
  expect(within(system).queryByText('Edit')).toBeNull();
  mocks.save.mockResolvedValue({ data: { ...saved, status } });
  fireEvent.click(screen.getByText('Save Changes'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('id');
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('status');
});

it('copies the full authoritative ID with success and failure feedback', async () => {
  const id = '84cfe8a5-1f4a-4c84-bf93-6a1cd6b133fd';
  mocks.tenant = id; mocks.get.mockResolvedValue({ data: { ...saved, id } });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original');
  fireEvent.click(screen.getByRole('button', { name: 'Copy Account ID' }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Account ID copied'));
  expect(writeText).toHaveBeenCalledWith(id);
  writeText.mockRejectedValue(new Error('Clipboard denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy Account ID' }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Unable to copy Account ID. Please copy it manually.'));
  expect(mocks.save).not.toHaveBeenCalled();
});

it('denies protected reads without View and hides loaded data when access is revoked', async () => {
  mocks.canView = false;
  const view = render(<OrganizationSettingsForm />);
  expect(screen.getByRole('alert')).toBeTruthy(); expect(mocks.get).not.toHaveBeenCalled();
  mocks.canView = true; view.rerender(<OrganizationSettingsForm />);
  await screen.findByDisplayValue('Original');
  mocks.canView = false; view.rerender(<OrganizationSettingsForm />);
  expect(screen.queryByRole('region', { name: 'System Information' })).toBeNull();
  expect(screen.queryByDisplayValue('Original')).toBeNull();
});

it('shows missing status without fabricating Active and rejects a mismatched or missing tenant ID', async () => {
  mocks.get.mockResolvedValueOnce({ data: { ...saved, status: undefined } });
  const view = render(<OrganizationSettingsForm />); await screen.findByText('Unavailable');
  expect(screen.queryByText('Active')).toBeNull();
  view.unmount(); mocks.get.mockResolvedValueOnce({ data: { ...saved, id: 'another-tenant' } });
  const next = render(<OrganizationSettingsForm />);
  await screen.findByText('Unable to load organization information for this workspace.');
  expect(screen.queryByDisplayValue('Original')).toBeNull(); next.unmount();
  mocks.get.mockResolvedValueOnce({ data: { ...saved, id: undefined } });
  render(<OrganizationSettingsForm />);
  await screen.findByText('Unable to load organization information for this workspace.');
});

it('retries failed reads, refreshes status on focus, and leaves edits untouched on focus', async () => {
  mocks.get.mockRejectedValueOnce(new Error('Load failed'));
  render(<OrganizationSettingsForm />); await screen.findByText('Load failed');
  expect(screen.queryByRole('region', { name: 'System Information' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByDisplayValue('Original');
  mocks.get.mockResolvedValue({ data: { ...saved, status: 'SANDBOX' } });
  fireEvent(window, new Event('focus')); await screen.findByText('Sandbox');
  fireEvent.click(screen.getByText('Edit')); fireEvent.change(name(), { target: { value: 'Unsaved' } });
  fireEvent(window, new Event('focus')); expect(name().value).toBe('Unsaved');
  expect(mocks.get).toHaveBeenCalledTimes(3);
});

it('ignores an in-flight save after switching tenants', async () => {
  let finish!: (response: { data: typeof saved }) => void;
  mocks.save.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<OrganizationSettingsForm />); await screen.findByDisplayValue('Original');
  fireEvent.click(screen.getByText('Edit')); fireEvent.click(screen.getByText('Save Changes'));
  mocks.tenant = 'other'; mocks.get.mockResolvedValue({ data: { ...saved, id: 'other', name: 'Other' } });
  view.rerender(<OrganizationSettingsForm />); await screen.findByDisplayValue('Other');
  mocks.apply.mockClear();
  await act(async () => finish({ data: { ...saved, name: 'Late old save' } }));
  expect(name().value).toBe('Other'); expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});

vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { userId: 'agent', tenantId: 'tenant', assignmentRestricted: false, clientAdmin: false } }) }));
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [] }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [] }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: vi.fn() }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: { fields: [], values: {}, files: [] }, error: null, isInitialLoad: false }) }));
import { AccountFormInner } from '../account-form';
afterEach(cleanup);
it.each([false, true])('submits an Account without obsolete fields (edit=%s)', async edit => {
  const save = vi.fn();
  render(<AccountFormInner initialData={edit ? { id: 'account', tenantId: 'tenant', name: 'Account', createdAt: '2026-09-24T00:00:00Z' } : undefined} onSave={save} onCancel={vi.fn()} />);
  if (!edit) {
    expect(screen.queryByText('Assigned Agent')).toBeNull();
    expect(screen.queryByText('Products & Interests')).toBeNull();
    expect(screen.queryByText('Active Products')).toBeNull();
    expect(screen.queryByLabelText('Internal Notes')).toBeNull();
    expect(screen.queryByLabelText('Notes')).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
  }
  for (const label of ['Tax ID', 'Customer Type', 'Customer Since', 'Customer Classification']) expect(screen.queryByText(label)).toBeNull();
  fireEvent.change(screen.getByLabelText(/Account Name/), { target: { value: 'New Account' } });
  const address = screen.getByLabelText('Company Address');
  expect(address.tagName).toBe('TEXTAREA');
  expect(address.parentElement?.parentElement?.className).toContain('sm:col-span-2');
  fireEvent.change(address, { target: { value: '123 Main Street\nMakati City, Metro Manila, Philippines' } });
  fireEvent.submit(screen.getByLabelText(/Account Name/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(screen.queryByLabelText('Owning Group')).toBeNull();
  expect(save.mock.calls[0][0]).not.toHaveProperty('ownerGroupId');
  expect(save.mock.calls[0][0]).toMatchObject({ name: 'New Account', address: '123 Main Street\nMakati City, Metro Manila, Philippines' });
  for (const field of ['city', 'province', 'country']) expect(save.mock.calls[0][0]).not.toHaveProperty(field);
  for (const label of ['City', 'Province', 'Country']) expect(screen.queryByLabelText(label)).toBeNull();
  for (const field of ['assignedUserId', 'productInterests', 'activeProducts', 'taxId', 'customerType', 'customerSince']) expect(save.mock.calls[0][0]).not.toHaveProperty(field);
  for (const field of ['notes', 'internalNotes', 'activeProducts', 'tags']) expect(save.mock.calls[0][0]).not.toHaveProperty(field);
});

it('awaits backend confirmation, retains failed input and exposes field errors for correction', async () => {
  let reject!: (error: Error) => void;
  const failure = Object.assign(new Error('The account website is invalid. Enter a complete URL.'), { status: 400, fieldErrors: { website: ['Enter a complete URL.'] } });
  const save = vi.fn().mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; })).mockResolvedValue(undefined);
  render(<AccountFormInner onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Account Name/), { target: { value: 'Keep this draft' } });
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://draft.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
  expect((await screen.findByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);
  expect(save).toHaveBeenCalledOnce(); reject(failure);
  await screen.findByText(failure.message);
  expect((screen.getByLabelText(/Account Name/) as HTMLInputElement).value).toBe('Keep this draft');
  expect(screen.getByLabelText('Website').getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://fixed.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0][0].requestId).toMatch(/^[a-f\d-]{36}$/i);
  expect(save.mock.calls[1][0].requestId).toBe(save.mock.calls[0][0].requestId);
});

it('sends an explicit clear when an existing Company Size is emptied', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<AccountFormInner initialData={{ id: 'account', tenantId: 'tenant', name: 'Account', size: '11-50', createdAt: '2026-09-24T00:00:00Z' }} onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Company Size'), { target: { value: '' } });
  fireEvent.submit(screen.getByLabelText(/Account Name/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ size: null });
  expect(save.mock.calls[0][0]).not.toHaveProperty('name');
  expect(save.mock.calls[0][0]).not.toHaveProperty('requestId');
});

it('keeps international address data and omits legacy note inputs when editing', async () => {
  const save = vi.fn();
  render(<AccountFormInner initialData={{ id: 'account', tenantId: 'tenant', name: 'Account', createdAt: '2026-09-24T00:00:00Z', address: '42 Queen Street\nToronto, Ontario, Canada', notes: 'Historical notes' }} onSave={save} onCancel={vi.fn()} />);
  expect(screen.queryByLabelText('Notes')).toBeNull();
  expect(screen.queryByLabelText('Internal Notes')).toBeNull();
  expect((screen.getByLabelText('Company Address') as HTMLTextAreaElement).value).toBe('42 Queen Street\nToronto, Ontario, Canada');
  fireEvent.submit(screen.getByLabelText(/Account Name/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).not.toHaveProperty('address');
  expect(save.mock.calls[0][0]).not.toHaveProperty('notes');
  expect(save.mock.calls[0][0]).not.toHaveProperty('internalNotes');
  for (const field of ['city', 'province', 'country']) expect(save.mock.calls[0][0]).not.toHaveProperty(field);
});

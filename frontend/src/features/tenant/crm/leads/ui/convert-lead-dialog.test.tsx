import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Lead } from '@/store/types';
import type { CustomFieldState } from '@leadcrm/shared';
import { ConvertLeadDialog } from './convert-lead-dialog';
const mocks = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined), canCreateAccount: true, data: { fields: [], values: {}, files: [] } as CustomFieldState }));
vi.mock('@/lib/api/client', () => ({ apiClient: { post: mocks.post } }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ refreshContacts: mocks.refresh, refreshOrganizations: mocks.refresh, refreshDeals: mocks.refresh }) }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: () => <div /> }));
vi.mock('@/shared/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (grant: string) => grant !== 'accounts.create' || mocks.canCreateAccount }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: mocks.data, error: null, isInitialLoad: false }) }));
afterEach(cleanup);
beforeEach(() => { mocks.post.mockReset(); mocks.refresh.mockClear(); mocks.canCreateAccount = true; mocks.data = { fields: [], values: {}, files: [] }; });
it('confirms conversion without promising Closed status or requiring a Won Deal', async () => {
  mocks.post.mockResolvedValue({ data: {} });
  const onSuccess = vi.fn();
  render(<ConvertLeadDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} lead={{ id: 'lead', firstName: 'Ada', lastName: 'Lead', status: 'Warm', companyName: 'Example' } as Lead} />);
  for (let step = 1; step <= 4; step++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText(/Lead will be marked as/).textContent).toContain('converted');
  expect(screen.getByText(/Sales completion remains a separate Closed Deal operation/)).toBeTruthy();
  expect(screen.queryByText(/must already be confirmed/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/crm/leads/lead/convert', expect.objectContaining({ newAccount: expect.objectContaining({ name: 'Example', requestId: expect.any(String) }), createContact: true, createDeal: false })));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
});

it('keeps required Account custom values through wizard steps and retains them after a failed conversion', async () => {
  mocks.data.fields = [{ id: 'context', name: 'Company context', module: 'accounts', group: 'Basic Information', type: 'Text', active: true, required: true, visibleInForm: true, visibleInDetails: true, options: [], order: 0, description: '', version: 1 }];
  mocks.post.mockRejectedValueOnce(new Error('Conversion could not be saved. Please retry.')).mockResolvedValue({ data: {} });
  const onClose = vi.fn();
  render(<ConvertLeadDialog isOpen onClose={onClose} lead={{ id: 'lead', firstName: 'Ada', lastName: 'Lead', status: 'Warm', companyName: 'Example' } as Lead} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(mocks.post).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Create new account' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Company context/), { target: { value: 'Required context retained' } });
  for (let step = 2; step <= 4; step++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  await screen.findByRole('alert');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  const first = mocks.post.mock.calls[0][1];
  expect(first.newAccount.customFieldValues).toEqual({ context: 'Required context retained' });
  expect(mocks.post.mock.calls[1][1]).toEqual(first);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it('protects conversion progress and prevents closing or duplicate requests during conversion', async () => {
  let fail!: (error: Error) => void;
  mocks.post.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue({ data: {} });
  const close = vi.fn();
  render(<ConvertLeadDialog isOpen onClose={close} lead={{ id: 'lead', firstName: 'Ada', lastName: 'Lead', status: 'Warm' } as Lead} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  for (let step = 2; step <= 4; step++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fail(new Error('Controlled conversion failure'));
  await screen.findByText('Controlled conversion failure');
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.post).toHaveBeenCalledTimes(2);
  expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]);
});

it.each(['Use existing Account', 'Create anyway'])('preserves the conversion draft when choosing %s', async action => {
  const token = 'a'.repeat(64);
  mocks.post.mockRejectedValueOnce(Object.assign(new Error('Possible duplicate'), {
    duplicateReview: { token, matches: [{ id: 'account', name: 'Example Inc.' }] },
  })).mockResolvedValueOnce({ data: {} });
  const close = vi.fn();
  render(<ConvertLeadDialog isOpen onClose={close} lead={{ id: 'lead', firstName: 'Ada', lastName: 'Lead', status: 'Warm', companyName: 'Example' } as Lead} />);
  for (let step = 1; step <= 4; step++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  fireEvent.click(await screen.findByRole('button', { name: action }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const { newAccount, ...original } = mocks.post.mock.calls[0][1];
  expect(mocks.post.mock.calls[1][1]).toEqual(action === 'Create anyway'
    ? { ...original, newAccount: { ...newAccount, duplicateReviewToken: token } }
    : { ...original, accountId: 'account' });
});

it('lets a Sales Associate with Accounts View continue without an Account', async () => {
  mocks.canCreateAccount = false;
  mocks.post.mockResolvedValueOnce({ data: {} });
  render(<ConvertLeadDialog isOpen onClose={vi.fn()} lead={{ id: 'lead', firstName: 'Ada', lastName: 'Lead', status: 'Warm', companyName: 'Example' } as Lead} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByRole('button', { name: 'Create new account' })).toBeNull();
  for (let step = 2; step <= 4; step++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Convert Lead' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/crm/leads/lead/convert', { createContact: true, createDeal: false, skipAccountCreation: true }));
});

vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent', firstName: 'My', lastName: 'Agent', email: 'my@camxian.com' } }) }));
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LeadFormSheet } from '@/features/tenant/crm/leads/ui/lead-form';
import { ContactFormSheet as ContactForm } from '@/features/tenant/crm/contacts/ui/contact-form';
import type { Lead } from '@/store/types';
import { AccountFormSheet } from '@/features/tenant/crm/accounts/ui/account-form';

vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { clientAdmin: true } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [], organizations: [] }) }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: undefined, isInitialLoad: false, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [{ id: 'product', name: 'Camera', dealValue: 100 }], loading: false }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/hooks/use-duplicate-check', () => ({ useDuplicateCheck: () => ({ matches: [], hasDuplicates: false, isChecking: false, dismiss: vi.fn() }) }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: ({ onChange }: { onChange: (id: string) => void }) => <button type="button" onClick={() => onChange('account')}>Choose account</button> }));
vi.mock('@/shared/components/crm/record-custom-fields', () => ({ useRecordCustomFields: () => ({ fields: [], blocked: false, dirty: false, uploadCount: 0, validate: () => true, payload: () => ({}), query: {} }), CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null, CustomFieldInput: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

const forms = [{ name: 'Lead', Form: LeadFormSheet }, { name: 'Contact', Form: ContactForm }] as const;
const changeDraft = {
  name: () => fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Ada' } }),
  phone: () => fireEvent.change(screen.getByPlaceholderText('9xxxxxxxxx'), { target: { value: '9123456789' } }),
  products: () => {
    fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Camera' }));
    fireEvent.keyDown(screen.getByRole('group', { name: 'Product interests' }), { key: 'Escape' });
  },
  account: () => fireEvent.click(screen.getByRole('button', { name: 'Choose account' })),
  companyName: () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create new account' }));
    fireEvent.change(screen.getByLabelText(/^Company(?: Name)? \*$/), { target: { value: 'Draft company' } });
  },
};

it.each(forms.flatMap(form => Object.entries(changeDraft).map(([field, change]) => ({ ...form, field, change }))))('$name protects changes to $field and preserves them after Keep editing', async ({ Form, change }) => {
  const closed = vi.fn();
  render(<Form isOpen onClose={closed} onSave={vi.fn()} />);
  change();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
  expect(closed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
});

it.each(forms)('$name closes without a prompt when unchanged', ({ Form }) => {
  const closed = vi.fn();
  render(<Form isOpen onClose={closed} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(closed).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it.each(forms)('$name prevents duplicate saves and closing while pending, retains the draft on failure, and retries', async ({ Form, name }) => {
  let fail!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
  const closed = vi.fn();
  render(<Form isOpen onClose={closed} onSave={save} />);
  changeDraft.name();
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'ada@example.test' } });
  const form = screen.getByLabelText('First Name *').closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  fireEvent.submit(form);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  expect(save).toHaveBeenCalledOnce();
  expect(closed).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fail(new Error('Controlled save failure. Please retry.'));
  await screen.findByText('Controlled save failure. Please retry.');
  expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Controlled save failure. Please retry.');
  expect(screen.getByLabelText('First Name *')).toHaveProperty('value', 'Ada');
  await waitFor(() => expect((screen.getByRole('button', { name: `Create ${name}` }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});

it('preserves a Lead draft when the same record is refreshed', () => {
  const lead = { id: 'lead', firstName: 'Original', lastName: 'Reyes', email: 'ada@example.test', status: 'Warm' } as Lead;
  const props = { isOpen: true, onClose: vi.fn(), onSave: vi.fn() };
  const view = render(<LeadFormSheet {...props} initialData={lead} />);
  changeDraft.name();
  view.rerender(<LeadFormSheet {...props} initialData={{ ...lead, firstName: 'Server refresh' }} />);
  expect(screen.getByLabelText('First Name *')).toHaveProperty('value', 'Ada');
});

it('rejects an incomplete Contact phone number before saving and keeps the input', async () => {
  const save = vi.fn();
  render(<ContactForm isOpen onClose={vi.fn()} onSave={save} />);
  changeDraft.name();
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'ada@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('9xxxxxxxxx'), { target: { value: '912' } });
  fireEvent.submit(screen.getByLabelText('First Name *').closest('form')!);
  await waitFor(() => expect(screen.getByPlaceholderText('9xxxxxxxxx').getAttribute('aria-invalid')).toBe('true'));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText('9xxxxxxxxx')).toHaveProperty('value', '912');
});

it('keeps the Account save lock and retry identity until the original request completes', async () => {
  let fail!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
  const closed = vi.fn();
  render(<AccountFormSheet isOpen onClose={closed} onSave={save} />);
  fireEvent.change(screen.getByLabelText('Account Name *'), { target: { value: 'Draft account' } });
  const form = screen.getByLabelText('Account Name *').closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  fireEvent.submit(form);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  expect(closed).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fail(new Error('Controlled Account failure'));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Account Name *')).toHaveProperty('value', 'Draft account');
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
});

// Historical security scope must survive edits without becoming customer input.
it.each(forms.flatMap(form => [false, true].map(edit => ({ ...form, edit }))))('$name create/edit=$edit omits Owning Group from controls and submissions', async ({ Form, edit }) => {
  const save = vi.fn();
  render(<Form isOpen onClose={() => {}} onSave={save} initialData={edit ? { id: 'customer', tenantId: 'tenant', createdAt: '2026-10-01T00:00:00Z', ownerGroupId: 'historical-group', firstName: 'Ada', lastName: 'Reyes', email: 'ada@example.test', status: 'Warm' } : undefined} />);
  expect(screen.queryByText('Owning Group')).toBeNull();
  expect(screen.queryByLabelText('Owning Group')).toBeNull();
  if (!edit) {
    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'ada@example.test' } });
  }
  fireEvent.submit(screen.getByLabelText('First Name *').closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).not.toHaveProperty('ownerGroupId');
});
it.each([false, true])('Account create/edit=%s omits Owning Group from controls and submissions', async edit => {
  const save = vi.fn();
  render(<AccountFormSheet isOpen onClose={() => {}} onSave={save} initialData={edit ? { id: 'account', tenantId: 'tenant', createdAt: '2026-10-01T00:00:00Z', name: 'Example', ownerGroupId: 'historical-group' } : undefined} />);
  expect(screen.queryByText('Owning Group')).toBeNull();
  fireEvent.change(screen.getByLabelText('Account Name *'), { target: { value: 'Updated company' } });
  fireEvent.submit(screen.getByLabelText('Account Name *').closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).not.toHaveProperty('ownerGroupId');
});

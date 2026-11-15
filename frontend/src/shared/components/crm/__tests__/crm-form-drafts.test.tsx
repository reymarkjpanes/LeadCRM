vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent', firstName: 'My', lastName: 'Agent', email: 'my@camxian.com' } }) }));
import React from 'react';
vi.mock('@/shared/hooks/use-email-availability', () => ({ useEmailAvailability: () => ({ available: true, blocked: false, confirm: () => true, retry: vi.fn(), reject: vi.fn() }) }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LeadFormSheet } from '@/features/tenant/crm/leads/ui/lead-form';
import { ContactFormSheet as ContactForm } from '@/features/tenant/crm/contacts/ui/contact-form';
import type { Lead } from '@/store/types';
import { AccountFormSheet } from '@/features/tenant/crm/accounts/ui/account-form';
import { INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR, STAFF_PHONE_CONFLICT, CUSTOMER_PHONE_CONFLICT } from '@leadcrm/shared';
import { toast } from '@/shared/utils/toast';

vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
const phoneApi = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: phoneApi.get } }));
beforeEach(() => phoneApi.get.mockReset().mockResolvedValue({ success: true, data: { available: true } }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { clientAdmin: true } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [], organizations: [] }) }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: undefined, isInitialLoad: false, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [{ id: 'product', name: 'Camera', category: 'Security', dealValue: 100 }], loading: false }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/hooks/use-duplicate-check', () => ({ useDuplicateCheck: () => ({ matches: [], hasDuplicates: false, isChecking: false, dismiss: vi.fn() }) }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: ({ onChange }: { onChange: (id: string) => void }) => <button type="button" onClick={() => onChange('account')}>Choose account</button> }));
vi.mock('@/shared/components/crm/record-custom-fields', () => ({ useRecordCustomFields: () => ({ fields: [], blocked: false, dirty: false, uploadCount: 0, validate: () => true, payload: () => ({}), query: {} }), CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null, CustomFieldInput: () => null }));
vi.mock('@/shared/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

const forms = [{ name: 'Lead', Form: LeadFormSheet }, { name: 'Contact', Form: ContactForm }] as const;

it.each(forms.flatMap(form => [false, true].flatMap(edit => ['STAFF_PHONE_NOT_ALLOWED', 'CUSTOMER_PHONE_CONFLICT'].map(reason => ({ ...form, edit, reason })))))('$name rejects $reason directly below the field and allows correction (edit=$edit)', async ({ Form, edit, reason }) => {
  phoneApi.get.mockResolvedValue({ success: true, data: { available: false, reason } });
  const save = vi.fn();
  render(<Form isOpen onClose={vi.fn()} onSave={save} initialData={edit ? { id: 'existing', firstName: 'Ada', lastName: 'Reyes', email: 'ada@example.test', status: 'Inquiry' } as any : undefined} />);
  changeDraft.name();
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'ada@example.test' } });
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9171234567' } });
  const message = await screen.findByText(reason === 'STAFF_PHONE_NOT_ALLOWED' ? STAFF_PHONE_CONFLICT : CUSTOMER_PHONE_CONFLICT);
  const input = screen.getByLabelText('Phone');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBe(message);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  fireEvent.submit(input.closest('form')!); expect(save).not.toHaveBeenCalled();
  phoneApi.get.mockResolvedValue({ success: true, data: { available: true } });
  fireEvent.change(input, { target: { value: '9181234567' } });
  const button = await screen.findByRole('button', { name: edit ? 'Save Changes' : `Create ${Form === LeadFormSheet ? 'Lead' : 'Contact'}` });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
  expect(screen.queryByText(message.textContent!)).toBeNull();
  expect(screen.getByTestId('phone-available')).toBeTruthy();
  expect(phoneApi.get.mock.calls.at(-1)?.[1].params.excludeId).toBe(edit ? 'existing' : undefined);
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].phone).toBe('+639181234567');
});

it.each(forms)('$name blocks pending and failed phone checks, retries, and retains late customer conflicts until correction', async ({ Form, name }) => {
  let fail!: (error: Error) => void;
  phoneApi.get.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const save = vi.fn().mockRejectedValueOnce(Object.assign(new Error(CUSTOMER_PHONE_CONFLICT), { fieldErrors: { phone: [CUSTOMER_PHONE_CONFLICT] } })).mockResolvedValue(undefined);
  render(<Form isOpen onClose={vi.fn()} onSave={save} />);
  changeDraft.name();
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'ada@example.test' } });
  const input = screen.getByLabelText('Phone'), form = input.closest('form')!;
  fireEvent.change(input, { target: { value: '9171234567' } });
  fireEvent.submit(form); expect(save).not.toHaveBeenCalled();
  await waitFor(() => expect(fail).toBeTypeOf('function'), { timeout: 2000 });
  fail(new Error('offline'));
  await screen.findByText('Unable to verify this phone number. Please try again.');
  fireEvent.submit(form); expect(save).not.toHaveBeenCalled();
  fireEvent.blur(input);
  await waitFor(() => expect(screen.queryByTestId('phone-available')).toBeTruthy());
  fireEvent.submit(form);
  await screen.findByText(CUSTOMER_PHONE_CONFLICT);
  expect(screen.queryByTestId('phone-available')).toBeNull();
  expect(screen.getByRole('button', { name: `Create ${name}` })).toHaveProperty('disabled', true);
  fireEvent.submit(form); expect(save).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { value: '9181234567' } });
  expect(screen.queryByText(CUSTOMER_PHONE_CONFLICT)).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: `Create ${name}` })).toHaveProperty('disabled', false), { timeout: 2000 });
  fireEvent.submit(form); await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});

it.each(forms)('$name derives Product Category above Product Interest from the current selection', async ({ Form }) => {
  render(<Form isOpen onClose={vi.fn()} onSave={vi.fn()} />);
  changeDraft.products();
  const category = await screen.findByText('Product Category');
  expect(category.parentElement?.textContent).toContain('Security');
  expect(category.compareDocumentPosition(screen.getByRole('button', { name: 'Product Interest' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(category.closest('section')?.textContent).toContain('Status & Interest');
});

it.each(forms.flatMap(form => [false, true].map(edit => ({ ...form, edit }))))('$name employee email rejection preserves the draft, shows one toast and inline error, and retries (edit=$edit)', async ({ Form, edit }) => {
  vi.clearAllMocks();
  const message = INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR;
  const save = vi.fn().mockRejectedValueOnce(Object.assign(new Error(message), { status: 400, fieldErrors: { email: [message] } })).mockResolvedValue(undefined);
  const close = vi.fn();
  render(<Form isOpen onClose={close} onSave={save} initialData={edit ? { id: 'legacy', firstName: 'Ada', lastName: 'Reyes', email: 'original@example.test', status: 'Inquiry' } as any : undefined} />);
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'employee@example.test' } });
  const form = screen.getByLabelText('First Name *').closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByLabelText('Email *').getAttribute('aria-invalid')).toBe('true'));
  const email = screen.getByLabelText('Email *');
  expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent?.trim()).toBe(message);
  expect(email).toHaveProperty('value', 'employee@example.test');
  expect(screen.getByLabelText('First Name *')).toHaveProperty('value', 'Ada');
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(message);
  expect(toast.success).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.change(email, { target: { value: 'external@example.test' } });
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].email).toBe('external@example.test');
});
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

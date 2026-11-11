vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { userId: 'actor', tenantId: 'tenant', assignmentRestricted: false, clientAdmin: true } }) }));
import React from 'react';
vi.mock('@/shared/hooks/use-email-availability', () => ({ useEmailAvailability: (email: string) => ({ available: true, blocked: false, confirm: () => true, email: email.trim(), retry: vi.fn(), reject: vi.fn() }) }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { InlineEditRows } from '../inline-edit-rows';
import { INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR as employeeMessage } from '@leadcrm/shared';
import { toast } from '@/shared/utils/toast';
vi.mock('@/shared/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [], organizations: [], contacts: [], pipelines: [] }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { role: 'Client Admin' }, userCan: () => true }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-cached-page', () => ({
  useCachedPage: ({ params }: { params: { customFields?: boolean } }) => ({
    data: params.customFields ? { fields: [], values: {}, files: [] } : undefined,
    isInitialLoad: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: vi.fn() }));
vi.mock('@/features/tenant/crm/deals/ui/deal-account-field', () => ({ DealAccountField: () => <div /> }));
vi.mock('@/features/tenant/crm/deals/ui/deal-contacts-field', () => ({ DealContactsField: () => <div /> }));
import { AddLeadForm } from '@/features/tenant/crm/leads/ui/lead-form';
import { ContactFormInner } from '@/features/tenant/crm/contacts/ui/contact-form';
import { AccountFormInner } from '@/features/tenant/crm/accounts/ui/account-form';
import { DealForm } from '@/features/tenant/crm/deals/ui/deal-form';
import { DealEditForm } from '@/features/tenant/crm/deals/ui/deal-edit-form';
import type { Deal } from '@/store/types';
import { EntityCombobox } from '@/shared/components/entity-combobox';
afterEach(cleanup);
it('keeps an inline employee email edit open with an error toast and accepts correction', async () => {
  vi.clearAllMocks();
  const save = vi.fn().mockRejectedValueOnce(Object.assign(new Error(employeeMessage), { status: 400, fieldErrors: { email: [employeeMessage] } })).mockResolvedValue(undefined);
  render(<InlineEditRows canEdit onSave={save} rows={[{ label: 'Email', apiField: 'email', value: 'customer@example.test', type: 'email' }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Email' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'employee@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(employeeMessage);
  expect(screen.getByLabelText('Email')).toHaveProperty('value', 'employee@example.test');
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(employeeMessage);
  expect(toast.success).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'external@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByLabelText('Email')).toBeNull());
});
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });

it.each([
  ['Lead create', AddLeadForm, false],
  ['Lead edit', AddLeadForm, true],
  ['Contact create', ContactFormInner, false],
  ['Contact edit', ContactFormInner, true],
] as const)('%s checks both names before saving', async (_label, Form, editing) => {
  const save = vi.fn();
  const initialData = editing ? {
    id: 'person', tenantId: 'tenant', createdAt: '2026-09-30T00:00:00Z',
    firstName: 'Maria', lastName: 'Visitor', email: 'visitor@example.test', status: 'Inquiry' as const,
  } : undefined;
  const { container } = render(<Form initialData={initialData} onSave={save} onCancel={vi.fn()} />);
  const first = screen.getByLabelText('First Name *');
  const last = screen.getByLabelText('Last Name *');
  if (!editing) {
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'visitor@example.test' } });
  }
  fireEvent.input(first, { target: { value: 'Mar1a' } });
  const firstError = screen.getByText('First name must not contain numbers.');
  expect(first.getAttribute('aria-describedby')).toBe(firstError.id);
  fireEvent.input(last, { target: { value: '123' } });
  const lastError = screen.getByText('Last name must not contain numbers.');
  expect(last.getAttribute('aria-describedby')).toBe(lastError.id);
  expect(firstError.className).toBe(lastError.className);
  expect(first).toHaveProperty('value', 'Mar1a');

  const form = container.querySelector('form')!;
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(first, { target: { value: 'María' } });
  expect(screen.queryByText(firstError.textContent!)).toBeNull();
  expect(lastError.isConnected).toBe(true);
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();

  fireEvent.input(last, { target: { value: 'O’Connor' } });
  expect(screen.queryByText(lastError.textContent!)).toBeNull();
  fireEvent.input(first, { target: { value: 'María@' } });
  fireEvent.input(last, { target: { value: 'O’Connor_' } });
  expect(screen.getByText('First name must not contain special characters.').id).toBe(first.getAttribute('aria-describedby'));
  expect(screen.getByText('Last name must not contain special characters.').id).toBe(last.getAttribute('aria-describedby'));
  expect(first).toHaveProperty('value', 'María@');
  await act(async () => { fireEvent.submit(form); });
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(first, { target: { value: 'María' } });
  fireEvent.input(last, { target: { value: 'O’Connor' } });
  expect(screen.queryByText('First name must not contain special characters.')).toBeNull();
  expect(screen.queryByText('Last name must not contain special characters.')).toBeNull();
  await act(async () => { fireEvent.submit(form); });
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ firstName: 'María', lastName: 'O’Connor' }));
});

it.each([
  ['firstName', 'First name', 'First name must not contain numbers.'],
  ['lastName', 'Last name', 'Last name must not contain numbers.'],
] as const)('blocks Save and Enter for an invalid inline %s and accepts a correction', async (field, label, message) => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<InlineEditRows canEdit onSave={save} rows={[{ label, apiField: field, value: 'John', required: true }]} />);
  fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));
  const input = screen.getByLabelText(label);
  fireEvent.input(input, { target: { value: '123John' } });
  expect(screen.getByText(message).id).toBe(input.getAttribute('aria-describedby'));
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(input, { target: { value: 'Anne-Marie' } });
  expect(screen.queryByText(message)).toBeNull();
  fireEvent.input(input, { target: { value: 'John@' } });
  expect(screen.getByText(`${label} must not contain special characters.`)).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(input, { target: { value: 'Anne-Marie' } });
  expect(input.getAttribute('aria-invalid')).toBe('false');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: label })).toBeNull());
  expect(save).toHaveBeenCalledExactlyOnceWith(field, 'Anne-Marie');
});

it.each([['Lead', AddLeadForm], ['Contact', ContactFormInner]] as const)('%s edit omits unchanged historical names and validates only a changed name', async (_label, Form) => {
  const save = vi.fn();
  const initialData = { id: 'legacy', tenantId: 'tenant', createdAt: '2026-09-30T00:00:00Z', firstName: 'Old@1', lastName: 'Smith#', email: 'legacy@example.test', status: 'Inquiry' as const };
  const { container } = render(<Form initialData={initialData} onSave={save} onCancel={vi.fn()} />);
  expect(screen.queryAllByText(/must not contain/)).toHaveLength(0);
  fireEvent.input(screen.getByLabelText(_label === 'Lead' ? 'Lead Address' : 'Contact Address'), { target: { value: '123 Main St' } });
  await act(async () => { fireEvent.submit(container.querySelector('form')!); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).not.toHaveProperty('firstName');
  expect(save.mock.calls[0][0]).not.toHaveProperty('lastName');
  save.mockClear();
  const first = screen.getByLabelText('First Name *');
  fireEvent.input(first, { target: { value: 'New@' } });
  expect(screen.getByText('First name must not contain special characters.')).toBeTruthy();
  await act(async () => { fireEvent.submit(container.querySelector('form')!); });
  expect(save).not.toHaveBeenCalled();
  fireEvent.input(first, { target: { value: 'Anne-Marie' } });
  await act(async () => { fireEvent.submit(container.querySelector('form')!); });
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ firstName: 'Anne-Marie' }));
  expect(save.mock.calls[0][0]).not.toHaveProperty('lastName');
});

it('closes an unchanged historical inline name without resubmitting it and clears stale errors on correction', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('First name must not contain special characters.')).mockResolvedValue(undefined);
  render(<InlineEditRows canEdit onSave={save} rows={[{ label: 'First name', apiField: 'firstName', value: 'Legacy@1', required: true }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit First name' }));
  fireEvent.keyDown(screen.getByLabelText('First name'), { key: 'Enter' });
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('First name')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit First name' }));
  fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Anne' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('First name must not contain special characters.');
  fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'María' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.keyDown(screen.getByLabelText('First name'), { key: 'Enter' });
  await waitFor(() => expect(screen.queryByLabelText('First name')).toBeNull());
  expect(save).toHaveBeenLastCalledWith('firstName', 'María');
});

const emptyDeal: Deal = {
  id: 'deal', tenantId: 'tenant', pipelineId: 'pipeline', stageId: 'stage', title: '',
  contactIds: [], value: 0, order: 0, priority: 'MEDIUM', companyName: '', contactPerson: '',
  createdAt: '2026-09-24T00:00:00Z',
};

const cases = [
  { name: 'Lead', component: <AddLeadForm onSave={vi.fn()} onCancel={vi.fn()} />, labels: ['First Name *', 'Last Name *'] },
  { name: 'Contact', component: <ContactFormInner onSave={vi.fn()} onCancel={vi.fn()} />, labels: ['First Name *', 'Last Name *'] },
  { name: 'Account', component: <AccountFormInner onSave={vi.fn()} onCancel={vi.fn()} />, labels: ['Account Name *'] },
  { name: 'New Deal', component: <DealForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />, labels: ['Title *'] },
  { name: 'Edit Deal', component: <DealEditForm deal={emptyDeal} onSave={vi.fn()} onCancel={vi.fn()} />, labels: ['Title *'] },
];
it.each(cases)('$name renders one accessible error below each required field', async ({ name, component, labels }) => {
  const { container } = render(component);
  fireEvent.submit(container.querySelector('form')!);
  for (const label of labels) {
    const input = screen.getByLabelText(label);
    const expectedMessage = name === 'Lead' ? 'Name is required' : label.startsWith('First') ? 'First name is required' : label.startsWith('Last') ? 'Last name is required' : label.startsWith('Account') ? 'Account name is required.' : 'Title is required';
    await screen.findAllByText(expectedMessage);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(error).not.toBeNull();
    expect(within(error!.parentElement!).getAllByText(expectedMessage)).toHaveLength(1);
    expect(input.compareDocumentPosition(error!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(label);
    expect(input.className).toContain('border-red-500');
  }
});

it('keeps one associated selector error when opening the account search', () => {
  render(<EntityCombobox entityType="accounts" value={null} onChange={vi.fn()} error="Invalid account" />);
  const trigger = screen.getByRole('combobox');
  const error = screen.getByRole('alert');
  expect(trigger.getAttribute('aria-invalid')).toBe('true');
  expect(trigger.getAttribute('aria-describedby')).toBe(error.id);
  expect(trigger.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(trigger);
  expect(screen.getAllByText('Invalid account')).toHaveLength(1);
  expect(screen.getByRole('combobox', { name: 'Search accounts' }).getAttribute('aria-describedby')).toBe(error.id);
});


it.each([
  { name: 'Contact', component: <ContactFormInner onSave={vi.fn()} onCancel={vi.fn()} />, labels: ['First Name *', 'Last Name *'] },
  { name: 'Account', component: <AccountFormInner onSave={vi.fn()} onCancel={vi.fn()} />, labels: ['Account Name *'] },
])('rejects whitespace in required $name fields', async ({ component, labels }) => {
  render(component);
  for (const label of labels) fireEvent.change(screen.getByLabelText(label), { target: { value: '   ' } });
  fireEvent.submit(screen.getByLabelText(labels[0]).closest('form')!);
  for (const label of labels) {
    await screen.findByText(label.startsWith('First') ? 'First name is required' : label.startsWith('Last') ? 'Last name is required' : 'Account name is required.');
    expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true');
  }
});

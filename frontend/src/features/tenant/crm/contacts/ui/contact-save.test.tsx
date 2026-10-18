vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { userId: 'agent', tenantId: 'tenant', assignmentRestricted: false, clientAdmin: false } }) }));
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultFieldLayout, type FieldLayout } from '@leadcrm/shared';
import { ContactFormInner } from './contact-form';
const fixtures = vi.hoisted(() => ({ layout: undefined as FieldLayout | undefined }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: { id: 'account-1', name: 'Acme', industry: 'Technology', size: '11-50', website: 'https://acme.test' }, isInitialLoad: false, refetch: vi.fn() }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [
  { id: 'active', firstName: 'Active', lastName: 'Agent', role: 'Sales', status: 'ACTIVE', assignableAgent: true, assignableModules: ['contacts', 'deals'] },
  { id: 'inactive', firstName: 'Inactive', lastName: 'Agent', role: 'Sales', status: 'INACTIVE', assignableAgent: true },
  { id: 'admin', firstName: 'Client', lastName: 'Admin', role: 'Client Admin', status: 'ACTIVE', assignableAgent: true },
  { id: 'limited', firstName: 'Contact', lastName: 'Only', role: 'Sales', status: 'ACTIVE', assignableAgent: true, assignableModules: ['contacts'] },
] }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [], loading: false }) }));
vi.mock('@/shared/components/crm/product-interest-select', () => ({ ProductInterestSelect: ({ values, onChange }: any) => <select aria-label="Product Interest" value={values[0] ?? ''} onChange={event => onChange([event.target.value])}><option value="">Select product</option><option value="CCTV">CCTV</option></select> }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: ({ value, onChange }: any) => <select aria-label="Account" value={value ?? ''} onChange={event => onChange(event.target.value)}><option value="">No account</option><option value="account-1">Acme</option></select> }));
vi.mock('@/shared/components/crm/record-custom-fields', () => ({
  useRecordCustomFields: () => ({ fields: [], layout: fixtures.layout, blocked: false, validate: () => true, payload: () => ({}), query: {} }),
  CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null, CustomFieldInput: () => null,
}));
afterEach(cleanup);
beforeEach(() => { fixtures.layout = undefined; });
it('retains a failed draft and permits retry without submitting twice while saving', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; })).mockResolvedValue(undefined);
  render(<ContactFormInner onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Nora' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Lim' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nora@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await screen.findByRole('button', { name: 'Saving...' });
  expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error('Temporary save failure'));
  expect((await screen.findByRole('alert')).textContent).toBe('Temporary save failure');
  expect((screen.getByLabelText('First Name *') as HTMLInputElement).value).toBe('Nora');
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});

it('preserves Notes on Contact edits without the removed field', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ContactFormInner initialData={{ id: 'contact-1', tenantId: 'tenant-1', createdAt: '2026-01-01T00:00:00.000Z', firstName: 'Nora', lastName: 'Lim', email: 'nora@example.test', status: 'Warm', notes: 'Keep this note' }} onSave={save} onCancel={vi.fn()} />);
  expect(screen.queryByLabelText('Job Title')).toBeNull();
  expect(screen.queryByLabelText('Active Products')).toBeNull();
  expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Keep this note');
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Keep this note' })));
  expect(save.mock.calls[0][0]).not.toHaveProperty('jobTitle');
  expect(save.mock.calls[0][0]).not.toHaveProperty('activeProducts');
});

it('keeps a failed nested Account draft, separates addresses and reuses its current retry identity', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Unable to save the account. Please retry.')).mockResolvedValue(undefined);
  render(<ContactFormInner onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Nora' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Lim' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nora@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create new account' }));
  const organization = screen.getByRole('heading', { name: 'Organization' }).closest('section')!;
  fireEvent.change(within(organization).getByLabelText('Company *'), { target: { value: 'Nora Company' } });
  fireEvent.change(within(organization).getByLabelText('Full Address'), { target: { value: 'Company office\nMakati' } });
  const additional = screen.getByRole('heading', { name: 'Additional Information' }).closest('section')!;
  fireEvent.change(within(additional).getByLabelText('Full Address'), { target: { value: 'Personal address' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await screen.findByText('Unable to save the account. Please retry.');
  expect((within(organization).getByLabelText('Company *') as HTMLInputElement).value).toBe('Nora Company');
  expect((screen.getByLabelText('First Name *') as HTMLInputElement).value).toBe('Nora');
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
  expect(save.mock.calls[1][0]).toMatchObject({ address: 'Personal address', newAccount: { name: 'Nora Company', address: 'Company office\nMakati' } });
  expect(save.mock.calls[1][0]).not.toHaveProperty('accountId');
  expect(save.mock.calls[1][0]).not.toHaveProperty('companyName');
});

it.each([false, true])('creates with the required section order and saves Account, Product, Status and Agent (saved layout: %s)', async savedLayout => {
  if (savedLayout) {
    fixtures.layout = defaultFieldLayout('contacts');
    fixtures.layout.groups.reverse().forEach((group, order) => { group.order = order; });
    fixtures.layout.groups.find(group => group.id === 'contacts:section:1')!.label = 'Status & Classification';
    fixtures.layout.groups.find(group => group.id === 'contacts:section:2')!.label = 'Relationships';
    fixtures.layout.fields.assignedUserId = { label: 'Assigned Agent', groupId: 'contacts:section:2', order: 0, visibleInForm: true, visibleInDetails: true };
  }
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ContactFormInner onSave={save} onCancel={vi.fn()} />);
  expect(screen.getAllByRole('heading').map(heading => heading.textContent?.replace(/^\d+/, ''))).toEqual(['Basic Information', 'Status & Interest', 'Organization', 'Additional Information', 'Assigned Agent']);
  expect(screen.queryByLabelText('Job Title')).toBeNull();
  expect(screen.queryByLabelText('Notes')).toBeNull();
  const selector = screen.getByLabelText('Assigned Agent');
  expect(within(selector).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', 'active']);
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Nora' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Lim' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nora@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Link existing account' }));
  fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'account-1' } });
  fireEvent.change(screen.getByLabelText('Product Interest'), { target: { value: 'CCTV' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Hot' } });
  fireEvent.change(selector, { target: { value: 'active' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ firstName: 'Nora', lastName: 'Lim', email: 'nora@example.test', accountId: 'account-1', productInterest: ['CCTV'], status: 'Hot', assignedUserId: 'active' });
  expect(save.mock.calls[0][0]).not.toHaveProperty('notes');
  expect(save.mock.calls[0][0]).not.toHaveProperty('jobTitle');
});

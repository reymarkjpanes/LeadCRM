vi.mock('@/shared/hooks/use-deal-address-options', () => ({ useDealAddressOptions: () => ({ data: fixture.addressOptions, isInitialLoad: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { userId: 'agent', tenantId: 'tenant', assignmentRestricted: false, clientAdmin: true } }) }));
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { resolveDealAddress, type CustomFieldState } from '@leadcrm/shared';
const fixture = vi.hoisted(() => ({ addressOptions: [] as import('@leadcrm/shared').DealAddressOption[], data: { fields: [], values: {}, files: [] } as CustomFieldState }));
const product = { id: '0ff82f9c-48e9-4e1c-8c77-8a30755d704c', name: 'CCTV', dealValue: 5000 };
vi.mock('@/store/DataContext', () => ({ useData: () => ({ pipelines: [{ id: 'pipeline', name: 'Sales Pipeline', stages: [{ id: 'stage', name: 'Lead' }] }] }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [product, { id: 'e47c3b8e-0b85-4f11-b9a6-2aafdd587fe5', name: 'Biometrics', dealValue: 15000 }], loading: false, error: '' }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: fixture.data, error: null, isInitialLoad: false }) }));
vi.mock('./deal-account-field', () => ({ DealAccountField: () => null }));
vi.mock('./deal-contacts-field', () => ({ DealContactsField: () => null }));
vi.mock('./deal-leads-field', () => ({ DealLeadsField: () => null }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: ({ id, entityType, value, onChange, error }: any) => <><select id={id} aria-label={`Search ${entityType}`} value={value ?? ''} onChange={event => onChange(event.target.value)}><option value="">Choose</option><option value={`${entityType}-1`}>First record</option><option value={`${entityType}-2`}>Second record</option></select>{error && <p role="alert">{error}</p>}</> }));
import { DealForm } from './deal-form';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
afterEach(cleanup);
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); fixture.addressOptions = []; fixture.data = { fields: [], values: {}, files: [] }; });
it.each((['create', 'edit'] as const).flatMap(mode => [false, true].flatMap(visibleInForm => [false, true].map(visibleInDetails => ({ mode, visibleInForm, visibleInDetails })))))('$mode Deal uses Forms=$visibleInForm independently of Details=$visibleInDetails', ({ mode, visibleInForm, visibleInDetails }) => {
  fixture.data.fields = [{ id: 'cancellation-reason', name: 'Cancellation Reason', module: 'deals', group: 'Additional Details', type: 'Long Text', required: false, active: true, visibleInForm, visibleInDetails, options: [], description: '', order: 0, version: 1 }];
  render(<DealForm mode={mode} initialData={mode === 'edit' ? { id: 'deal', title: 'History', productInterestId: product.id } : undefined} preselect={{ pipelineId: 'pipeline', stageId: 'stage' }} onSubmit={vi.fn()} onCancel={() => {}} />);
  expect(screen.queryByLabelText('Industry')).toBeNull();
  expect(screen.queryByRole('option', { name: 'Uncategorized' })).toBeNull();
  if (visibleInForm) expect(screen.getByLabelText('Cancellation Reason').tagName).toBe('TEXTAREA');
  else expect(screen.queryByLabelText('Cancellation Reason')).toBeNull();
});
it('requires a catalog product and submits its ID array without a manual value', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<DealForm mode="create" preselect={{ pipelineId: 'pipeline', stageId: 'stage' }} onSubmit={save} onCancel={() => {}} />);
  expect(screen.queryByText('Owning Group')).toBeNull();
  const selector = screen.getByRole('button', { name: 'Product Interest' });
  expect(screen.queryByLabelText('Value')).toBeNull();
  expect(screen.queryByLabelText('Industry')).toBeNull();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Installation' } });
  fireEvent.change(screen.getByLabelText(/Associate Deal To/), { target: { value: 'lead' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search leads' }), { target: { value: 'leads-1' } });
  expect((screen.getByRole('button', { name: 'Create Deal' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(selector);
  fireEvent.click(screen.getByRole('checkbox', { name: 'CCTV' }));
  expect(screen.getByText(/5,000.00/)).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: 'CCTV' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText('Product Interests').closest('.space-y-4')?.textContent).toContain('Deal Information');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Biometrics' }));
  expect(screen.getByText('2 Deals will be created')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('group', { name: 'Product interests' }), { key: 'Escape' });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Create Deal' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Create Deal' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ productInterestIds: [product.id, 'e47c3b8e-0b85-4f11-b9a6-2aafdd587fe5'], value: undefined, productInterests: undefined, currency: 'PHP' })));
  expect(save.mock.calls[0][0]).not.toHaveProperty('industry');
  expect(save.mock.calls[0][0]).not.toHaveProperty('ownerGroupId');
});
it('does not send a catalog repricing or manual value when editing a historical Deal', async () => {
  const save = vi.fn();
  render(<DealForm mode="edit" initialData={{ ownerGroupId: 'historical-group', title: 'History', value: 1200, productInterestId: product.id, productInterests: ['CCTV'] }} onSubmit={save} onCancel={() => {}} />);
  expect(screen.queryByText('Owning Group')).toBeNull();
  expect(screen.getByLabelText('Value')).toHaveProperty('readOnly', true);
  expect(screen.getByLabelText('Value')).toHaveProperty('value', '1,200.00');
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ value: undefined })));
  expect(save.mock.calls[0][0]).not.toHaveProperty('ownerGroupId');
});

it('protects a changed Deal and blocks closing and duplicate saves until the request finishes', async () => {
  let fail!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValue(undefined);
  const close = vi.fn();
  render(<SlidingDrawer isOpen onClose={close} title="Edit Deal"><DealForm mode="edit" initialData={{ title: 'History', productInterestId: product.id }} onSubmit={save} onCancel={close} /></SlidingDrawer>);
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Unsaved Deal' } });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Update Deal' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  const form = screen.getByLabelText(/Title/).closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  fireEvent.submit(form);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true));
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fail(new Error('Controlled Deal failure'));
  await screen.findByText('Controlled Deal failure');
  expect(screen.getByLabelText(/Title/)).toHaveProperty('value', 'Unsaved Deal');
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});


it.each(['lead', 'contact'] as const)('requires a type and valid %s selection and submits only that relationship', async type => {
  const save = vi.fn();
  render(<DealForm mode="create" onSubmit={save} onCancel={() => {}} />);
  expect(screen.queryByRole('combobox', { name: /Search/ })).toBeNull();
  expect(screen.queryByText('Account')).toBeNull();
  expect(screen.queryByText('Assigned Agent')).toBeNull();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Associated Deal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'CCTV' }));
  const form = screen.getByLabelText(/Title/).closest('form')!;
  fireEvent.submit(form);
  await screen.findByText('Choose Lead or Contact.');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Associate Deal To/), { target: { value: type } });
  fireEvent.submit(form);
  await screen.findByText(`Select a ${type === 'lead' ? 'Lead' : 'Contact'}.`);
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: `Search ${type}s` }), { target: { value: `${type}s-1` } });
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject(type === 'lead' ? { leadIds: ['leads-1'] } : { contactIds: ['contacts-1'] });
  expect(save.mock.calls[0][0][type === 'lead' ? 'contactIds' : 'leadIds']).toBeUndefined();
  expect(save.mock.calls[0][0].assignedUserId).toBeUndefined();
  expect(save.mock.calls[0][0].organizationId).toBeUndefined();
});

it('clears the old selection on every type switch, including switching back', async () => {
  render(<DealForm mode="create" onSubmit={vi.fn()} onCancel={() => {}} />);
  const type = screen.getByLabelText(/Associate Deal To/);
  fireEvent.change(type, { target: { value: 'lead' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search leads' }), { target: { value: 'leads-1' } });
  fireEvent.change(type, { target: { value: 'contact' } });
  expect(screen.queryByRole('combobox', { name: 'Search leads' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Search contacts' })).toHaveProperty('value', '');
  fireEvent.change(type, { target: { value: 'lead' } });
  expect(screen.getByRole('combobox', { name: 'Search leads' })).toHaveProperty('value', '');
});

it.each(['lead', 'contact'] as const)('prefills a sole %s and sends a targeted edit without owner, Account or replacement arrays', async type => {
  const save = vi.fn();
  render(<DealForm mode="edit" initialData={{ title: 'Existing', productInterestId: product.id, leadIds: type === 'lead' ? ['leads-1'] : [], contactIds: type === 'contact' ? ['contacts-1'] : [], assignedUserId: 'owner', organizationId: 'account' }} onSubmit={save} onCancel={() => {}} />);
  expect(screen.getByLabelText(/Associate Deal To/)).toHaveProperty('value', type);
  expect(screen.getByRole('combobox', { name: `Search ${type}s` })).toHaveProperty('value', `${type}s-1`);
  const next = type === 'lead' ? 'contact' : 'lead';
  fireEvent.change(screen.getByLabelText(/Associate Deal To/), { target: { value: next } });
  fireEvent.change(screen.getByRole('combobox', { name: `Search ${next}s` }), { target: { value: `${next}s-2` } });
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const payload = save.mock.calls[0][0];
  expect(payload.primaryAssociation).toEqual({ type: next, id: `${next}s-2`, previous: { type, id: `${type}s-1` } });
  for (const field of ['assignedUserId', 'organizationId', 'leadIds', 'contactIds', 'associationType', 'associationId']) expect(payload[field]).toBeUndefined();
});

it.each([{}, { leadIds: ['leads-1', 'leads-2'], contactIds: ['contacts-1'] }])('preserves ambiguous and missing legacy relationships on unrelated edits', async relationships => {
  const save = vi.fn();
  render(<DealForm mode="edit" initialData={{ title: 'Legacy', ...relationships }} onSubmit={save} onCancel={() => {}} />);
  expect(screen.getByLabelText(/Associate Deal To/)).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Unrelated edit' } });
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  for (const field of ['primaryAssociation', 'leadIds', 'contactIds', 'assignedUserId', 'organizationId']) expect(save.mock.calls[0][0][field]).toBeUndefined();
});

it.each(['lead', 'contact'] as const)('preselects originating %s on create', type => {
  render(<DealForm mode="create" preselect={{ [type === 'lead' ? 'leadId' : 'contactId']: `${type}s-1` }} onSubmit={vi.fn()} onCancel={() => {}} />);
  expect(screen.getByLabelText(/Associate Deal To/)).toHaveProperty('value', type);
  expect(screen.getByRole('combobox', { name: `Search ${type}s` })).toHaveProperty('value', `${type}s-1`);
});


it('keeps the override blank while choosing and saving a live company address reference', async () => {
  fixture.addressOptions = [{ type: 'lead', id: 'leads-1', label: 'Lead: Customer', address: 'Personal street' }, { type: 'account', id: 'account', label: 'Company: Customer', address: 'Company street' }];
  const save = vi.fn();
  const initialData = { id: 'deal', title: 'Existing', leadIds: ['leads-1'], organizationId: 'account' };
  const view = render(<DealForm mode="edit" initialData={initialData} onSubmit={save} onCancel={() => {}} />);
  expect(screen.getByText('Choose a linked address')).toBeTruthy();
  expect(screen.getByLabelText('Deal Address (override)')).toHaveProperty('value', '');
  fireEvent.change(screen.getByLabelText('Customer Address'), { target: { value: 'account:account' } });
  expect(screen.getByText('Company street')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Deal Address (override)'), { target: { value: 'Installation site' } });
  fixture.addressOptions = fixture.addressOptions.map(option => option.type === 'account' ? { ...option, address: 'Updated office' } : option);
  view.rerender(<DealForm mode="edit" initialData={{ ...initialData, title: 'Server refresh' }} onSubmit={save} onCancel={() => {}} />);
  expect(screen.getByLabelText('Deal Address (override)')).toHaveProperty('value', 'Installation site');
  expect(screen.getByText('Updated office')).toBeTruthy();
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ address: 'Installation site', addressSource: { type: 'account', id: 'account' } });
  expect(save.mock.calls[0][0].leadIds).toBeUndefined();
});
it('rejects a stale changed selection before submitting and allows returning to automatic', async () => {
  fixture.addressOptions = [{ type: 'lead', id: 'leads-1', label: 'Lead: Customer', address: 'Personal street' }];
  const save = vi.fn();
  const view = render(<DealForm mode="edit" initialData={{ title: 'Existing' }} onSubmit={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Customer Address'), { target: { value: 'lead:leads-1' } });
  fixture.addressOptions = [];
  view.rerender(<DealForm mode="edit" initialData={{ title: 'Existing' }} onSubmit={save} onCancel={() => {}} />);
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await screen.findByText('Choose an available linked customer address or return to Automatic.');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Customer Address'), { target: { value: '' } });
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
});


it('explicitly clears a redacted unavailable source without copying the automatic address', async () => {
  fixture.addressOptions = [{ type: 'account', id: 'account', label: 'Company: Customer', address: 'Current office' }];
  const save = vi.fn();
  render(<DealForm mode="edit" initialData={{ title: 'Legacy source', addressSource: null, addressContext: { ...resolveDealAddress('', { type: 'lead', id: 'unavailable' }, fixture.addressOptions), source: null } }} onSubmit={save} onCancel={() => {}} />);
  expect(screen.getByLabelText('Customer Address')).toHaveProperty('value', '__unavailable__');
  fireEvent.change(screen.getByLabelText('Customer Address'), { target: { value: '' } });
  expect(screen.getByText('Current office')).toBeTruthy();
  fireEvent.submit(screen.getByLabelText(/Title/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ addressSource: null, address: '' });
});

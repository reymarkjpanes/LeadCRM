vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'agent', firstName: 'My', lastName: 'Agent', email: 'my@camxian.com' } }) }));
vi.mock('@/shared/hooks/use-email-availability', () => ({ useEmailAvailability: () => ({ available: true, blocked: false, confirm: () => true, retry: vi.fn(), reject: vi.fn() }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true, policy: { userId: 'actor', tenantId: 'tenant', assignmentRestricted: false, clientAdmin: true } }) }));
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CRM_STATUSES, CrmStatusSchema } from '@leadcrm/shared';
import { LeadFormSheet } from '@/features/tenant/crm/leads/ui/lead-form';
import { ContactFormSheet } from '@/features/tenant/crm/contacts/ui/contact-form';
import { toBackendCreateContact, toBackendUpdateContact } from '@/lib/api/adapters/contact.adapter';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import { CrmStatusIndicator, CustomerStatusMenu } from '../crm-status';

const transport = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: transport }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [] }) }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: { fields: [], values: {}, files: [] }, isInitialLoad: false, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/use-duplicate-check', () => ({ useDuplicateCheck: () => ({ matches: [], hasDuplicates: false }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: () => null }));
const ids = ['082b88e3-ca9c-e96a-ebdc-1e14b7ca4266', '9acc2460-e846-9826-9889-bb85bce8cfda'];
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [
  { id: '082b88e3-ca9c-e96a-ebdc-1e14b7ca4266', name: 'Smart Lock' },
  { id: '9acc2460-e846-9826-9889-bb85bce8cfda', name: 'Biometrics' },
], loading: false }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  transport.post.mockResolvedValue({ success: true, data: { id: 'contact' } });
  transport.put.mockResolvedValue({ success: true, data: { id: 'contact' } });
});

it('renders a readable badge without an editing control for unauthorized users', () => {
  render(<CustomerStatusMenu status="Cancelled" canEdit={false} onChange={vi.fn()} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Cancelled')).toBeTruthy();
});

it.each(CRM_STATUSES)('shows the normalized current status %s with a selected check or a Closed Deal badge', async status => {
  const change = vi.fn();
  render(<CustomerStatusMenu status={status.toUpperCase().replace(' ', '_')} canEdit onChange={change} />);
  if (status === 'Closed Deal') {
    expect(screen.getByText(status)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    return;
  }
  fireEvent.click(screen.getByRole('button', { name: status }));
  const selected = screen.getByRole('menuitemradio', { checked: true });
  expect(selected.textContent).toBe(status);
  expect(selected.querySelector('.lucide-check')).toBeTruthy();
  expect(screen.getAllByRole('menuitemradio', { checked: false })).toHaveLength(5);
  expect(screen.queryByText('Manual engagement changes retain existing sales and automation rules. Closed Deal requires a confirmed sale.')).toBeNull();
});

it('updates the selected check from new record props and preserves same-value manual selections', async () => {
  const change = vi.fn().mockResolvedValue(undefined);
  const view = render(<CustomerStatusMenu status="Hot" canEdit onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hot' }));
  expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toBe('Hot');
  view.rerender(<CustomerStatusMenu status="WARM" canEdit onChange={change} />);
  expect(screen.getByRole('menuitemradio', { checked: true }).textContent).toBe('Warm');
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Warm' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('Warm');
});

it('does not expose or submit a status action when explicitly read-only', () => {
  const change = vi.fn();
  render(<CustomerStatusMenu status="Warm" readOnly canEdit onChange={change} />);
  fireEvent.click(screen.getByText('Warm'));
  expect(screen.queryByRole('button')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it.each(CRM_STATUSES)('keeps manual Lead Inquiry when status %s is injected and preserves selected Product IDs', async status => {
  const submitted = vi.fn();
  render(<LeadFormSheet isOpen onClose={() => {}} onSave={data => submitted(toBackendCreateContact(data))} />);
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Testing' } });
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'lead@example.test' } });
  const select = screen.getByLabelText('Status') as HTMLInputElement;
  expect(select.value).toBe('Inquiry'); expect(select.readOnly).toBe(true);
  fireEvent.change(select, { target: { value: status } });
  fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Smart Lock' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Biometrics' }));
  fireEvent.keyDown(screen.getByRole('group', { name: 'Product interests' }), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(submitted).toHaveBeenCalledOnce());
  expect(submitted.mock.calls[0][0]).toMatchObject({ status: 'Inquiry', productInterest: ids });
  expect(screen.queryByLabelText('Owning Group')).toBeNull();
  expect(submitted.mock.calls[0][0]).not.toHaveProperty('ownerGroupId');
  expect(CrmStatusSchema.parse(submitted.mock.calls[0][0].status)).toBe('Inquiry');
  expect(toBackendUpdateContact({ status, productInterest: ids })).toEqual({ status, productInterest: ids });
});

it.each(CRM_STATUSES)('creates Inquiry and displays canonical %s without resubmitting unchanged engagement', async status => {
  const created = render(<ContactFormSheet isOpen onClose={() => {}} onSave={data => { void contactsV2Api.create({ ...data, requestId: '72d1f071-a18d-4722-9ed9-c7c63084c230' }); }} />);
  expect(screen.queryByLabelText('Owning Group')).toBeNull();
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Testing' } });
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Contact' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'contact@example.test' } });
  const select = screen.getByLabelText('Status') as HTMLInputElement;
  expect(select.value).toBe('Inquiry'); expect(select.readOnly).toBe(true);
  fireEvent.change(select, { target: { value: status } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await waitFor(() => expect(transport.post).toHaveBeenCalledWith('/crm/contacts', expect.objectContaining({ status: 'Inquiry' })));
  created.unmount();
  render(<ContactFormSheet isOpen initialData={{ id: 'contact', tenantId: 'tenant', createdAt: '2026-09-30T00:00:00Z', firstName: 'Testing', lastName: 'Contact', email: 'contact@example.test', status: status.toUpperCase() }} onClose={() => {}} onSave={data => { void contactsV2Api.update('contact', data); }} />);
  expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe(status);
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(transport.put).toHaveBeenCalledWith('/crm/contacts/contact', expect.any(Object)));
  expect(transport.put.mock.calls.at(-1)?.[1]).not.toHaveProperty('status');
});

it.each([
  ['Hot', 'rgb(239, 68, 68)'], ['Warm', 'rgb(245, 158, 11)'], ['Cold', 'rgb(59, 130, 246)'],
  ['Closed Deal', 'rgb(139, 92, 246)'], ['Cancelled', 'rgb(51, 65, 85)'],
])('renders %s using the shared CRM palette, including legacy records', (status, color) => {
  const { container } = render(<CrmStatusIndicator status={status.toUpperCase()} />);
  expect(screen.getByText(status)).toBeTruthy();
  expect((container.querySelector('[aria-hidden]') as HTMLElement).style.backgroundColor).toBe(color);
  expect(container.textContent).not.toContain(status.toUpperCase());
});

it('rejects invalid write statuses instead of silently changing them to Inquiry', () => {
  expect(() => toBackendCreateContact({ status: 'WARM' })).toThrow();
  expect(toBackendUpdateContact({ email: 'test@example.test' })).not.toHaveProperty('status');
});

it('shows every manual status, disables closing without sale proof, and saves a permitted selection', async () => {
  const change = vi.fn().mockResolvedValue(undefined);
  render(<CustomerStatusMenu status="Inquiry" canEdit onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inquiry' }));
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
  expect(screen.getByRole('menuitemradio', { name: 'Closed Deal' }).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitemradio', { name: 'Closed Deal' }).title).toContain('Confirm a related Deal');
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Cold' }));
  await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith('Cold'));
});

it('retains all statuses while enabling only reopening for a manually cancelled managed customer', async () => {
  const change = vi.fn().mockResolvedValue(undefined);
  render(<CustomerStatusMenu status="Cancelled" managed manuallyCancelled canEdit onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelled' }));
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
  for (const item of screen.getAllByRole('menuitemradio')) expect(item.getAttribute('aria-disabled')).toBe(item.textContent?.includes('Reopen customer') ? 'false' : 'true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Inquiry.*Reopen customer/ }));
  await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith('Inquiry'));
});

it.each(['lead', 'contact'] as const)('edits a linked %s engagement while preserving other fields', async kind => {
  const save = vi.fn();
  const initialData = { id: 'person', tenantId: 'tenant', createdAt: '2026-09-30T00:00:00Z', firstName: 'Testing', lastName: 'Person', email: 'person@example.test', status: 'Hot', statusManagedByDeals: true };
  render(kind === 'lead'
    ? <LeadFormSheet isOpen initialData={initialData} onClose={() => {}} onSave={save} />
    : <ContactFormSheet isOpen initialData={initialData} onClose={() => {}} onSave={save} />);
  expect((screen.getByLabelText('Status') as HTMLSelectElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Warm' } });
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Updated' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ lastName: 'Updated', status: 'Warm' })));
});

it.each(['lead', 'contact'] as const)('keeps a %s status draft and its original version during background updates', async kind => {
  const save = vi.fn().mockRejectedValue(new Error('Recoverable status conflict'));
  const initialData = { id: 'person', tenantId: 'tenant', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-10-01T00:00:00.000Z', firstName: 'Testing', lastName: 'Person', email: 'person@example.test', status: 'Hot', statusManagedByDeals: true };
  const view = (record: typeof initialData) => kind === 'lead'
    ? <LeadFormSheet isOpen initialData={record} onClose={() => {}} onSave={save} />
    : <ContactFormSheet isOpen initialData={record} onClose={() => {}} onSave={save} />;
  const mounted = render(view(initialData));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Warm' } });
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Unsaved name' } });
  mounted.rerender(view({ ...initialData, status: 'Cold', updatedAt: '2026-10-02T00:00:00.000Z' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ status: 'Warm', expectedUpdatedAt: initialData.updatedAt, lastName: 'Unsaved name' })));
  expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('Warm');
  expect((screen.getByLabelText(/Last Name/) as HTMLInputElement).value).toBe('Unsaved name');
});

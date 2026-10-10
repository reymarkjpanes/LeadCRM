import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CRM_STATUSES, CrmStatusSchema } from '@leadcrm/shared';
import { LeadFormSheet } from '@/features/tenant/crm/leads/ui/lead-form';
import { ContactFormSheet } from '@/features/tenant/crm/contacts/ui/contact-form';
import { toBackendCreateContact, toBackendUpdateContact } from '@/lib/api/adapters/contact.adapter';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import { CrmStatusIndicator } from '../crm-status';

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

it.each(CRM_STATUSES)('submits the New Lead side panel with %s and both selected product IDs', async status => {
  const submitted = vi.fn();
  render(<LeadFormSheet isOpen onClose={() => {}} onSave={data => submitted(toBackendCreateContact(data))} />);
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Testing' } });
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Test' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'lead@example.test' } });
  const select = screen.getByLabelText('Status') as HTMLSelectElement;
  expect(select.value).toBe('Warm');
  expect(Array.from(select.options).map(option => option.value)).toEqual(CRM_STATUSES);
  fireEvent.change(select, { target: { value: status } });
  fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Smart Lock' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Biometrics' }));
  fireEvent.keyDown(screen.getByRole('group', { name: 'Product interests' }), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(submitted).toHaveBeenCalledOnce());
  expect(submitted.mock.calls[0][0]).toMatchObject({ status, productInterest: ids });
  expect(CrmStatusSchema.parse(submitted.mock.calls[0][0].status)).toBe(status);
  expect(toBackendUpdateContact({ status, productInterest: ids })).toEqual({ status, productInterest: ids });
});

it.each(CRM_STATUSES)('creates and edits Contacts with canonical %s', async status => {
  const created = render(<ContactFormSheet isOpen onClose={() => {}} onSave={data => { void contactsV2Api.create(data); }} />);
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Testing' } });
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Contact' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'contact@example.test' } });
  const select = screen.getByLabelText('Status') as HTMLSelectElement;
  expect(select.value).toBe('Warm');
  expect(Array.from(select.options).map(option => option.value)).toEqual(CRM_STATUSES);
  fireEvent.change(select, { target: { value: status } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await waitFor(() => expect(transport.post).toHaveBeenCalledWith('/crm/contacts', expect.objectContaining({ status })));
  created.unmount();
  render(<ContactFormSheet isOpen initialData={{ id: 'contact', tenantId: 'tenant', createdAt: '2026-09-30T00:00:00Z', firstName: 'Testing', lastName: 'Contact', email: 'contact@example.test', status: status.toUpperCase() }} onClose={() => {}} onSave={data => { void contactsV2Api.update('contact', data); }} />);
  expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe(status);
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(transport.put).toHaveBeenCalledWith('/crm/contacts/contact', expect.objectContaining({ status })));
});

it.each([
  ['Hot', 'rgb(239, 68, 68)'], ['Warm', 'rgb(245, 158, 11)'], ['Cold', 'rgb(59, 130, 246)'],
  ['Closed', 'rgb(139, 92, 246)'], ['Cancelled', 'rgb(107, 114, 128)'],
])('renders %s using the unchanged Leads dot style, including legacy records', (status, color) => {
  const { container } = render(<CrmStatusIndicator status={status.toUpperCase()} />);
  expect(screen.getByText(status)).toBeTruthy();
  expect((container.querySelector('[aria-hidden]') as HTMLElement).style.backgroundColor).toBe(color);
  expect(container.textContent).not.toContain(status.toUpperCase());
});

it('rejects invalid write statuses instead of silently changing them to Warm', () => {
  expect(() => toBackendCreateContact({ status: 'WARM' })).toThrow();
  expect(toBackendUpdateContact({ email: 'test@example.test' })).not.toHaveProperty('status');
});

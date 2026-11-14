import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMAIL_AVAILABILITY_MESSAGES } from '@leadcrm/shared';

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), error: vi.fn(), actor: { id: 'actor', tenantId: 'tenant', role: 'Client Admin' } }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: mocks.actor, tenant: { id: mocks.actor.tenantId }, userCan: () => true }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [], organizations: [] }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ policy: { clientAdmin: true, userId: 'actor' }, canMutate: () => true }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [], categories: [], loading: false }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/hooks/use-duplicate-check', () => ({ useDuplicateCheck: () => ({ matches: [], hasDuplicates: false }) }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: undefined, isInitialLoad: false }) }));
vi.mock('@/shared/components/crm/record-custom-fields', () => ({
  useRecordCustomFields: () => ({ fields: [], blocked: false, validate: () => true, payload: () => ({}), query: {} }),
  CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null, CustomFieldInput: () => null,
}));
vi.mock('@/shared/utils/toast', () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock('@/shared/services/groups.api', () => ({ groupsApi: { getAll: async () => ({ data: [] }) } }));
vi.mock('@/features/tenant/administration/users/services/users.service', () => ({ usersService: { create: mocks.create } }));

import { AddLeadForm } from '@/features/tenant/crm/leads/ui/lead-form';
import { ContactFormInner } from '@/features/tenant/crm/contacts/ui/contact-form';
import { UserPanel } from '@/features/tenant/settings/ui/user-panel';
import { useEmailAvailability } from '@/shared/hooks/use-email-availability';
import { showCrmMutationError } from '@/shared/utils/crm-mutation-error';

const available = { success: true, data: { available: true } };
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(600); }); };
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function setup(kind: 'Lead' | 'Contact' | 'User') {
  const save = vi.fn().mockResolvedValue(undefined);
  render(kind === 'Lead' ? <AddLeadForm onSave={save} onCancel={vi.fn()} />
    : kind === 'Contact' ? <ContactFormInner onSave={save} onCancel={vi.fn()} />
      : <UserPanel roles={[{ id: 'role', name: 'Sales' }]} canEdit onSaved={save} onClose={vi.fn()} />);
  const email = screen.getByLabelText(/^Email/) as HTMLInputElement;
  const change = (value: string) => fireEvent.change(email, { target: { value } });
  const icon = () => email.parentElement!.querySelector('svg.lucide-check');
  const button = screen.getByRole('button', { name: `Create ${kind}` }) as HTMLButtonElement;
  return { save, email, change, icon, button };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.actor.tenantId = 'tenant'; mocks.actor.role = 'Client Admin';
  mocks.get.mockResolvedValue(available);
  mocks.create.mockResolvedValue({ data: { id: 'new-user', email: 'customer@example.test' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(['Lead', 'Contact', 'User'] as const)('%s checks while typing, shows only an icon for availability, and saves valid input', async kind => {
  const { change, icon, button, email, save } = setup(kind);
  expect(icon()).toBeNull();
  change('bad-email');
  expect(email.getAttribute('aria-invalid')).toBe('true'); expect(icon()).toBeNull(); expect(mocks.get).not.toHaveBeenCalled();
  change(kind === 'User' ? 'customer@GMAIL.COM' : 'customer@example.test');
  expect(icon()).toBeNull(); expect(button.disabled).toBe(true);
  await advance();
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(mocks.get.mock.calls[0][0]).toBe(kind === 'User' ? '/administration/users/email-availability' : '/crm/email-availability');
  expect(icon()?.getAttribute('aria-hidden')).toBe('true');
  expect(icon()?.classList.contains('text-green-600')).toBe(true);
  expect(icon()?.querySelector('title')).toBeNull();
  expect(screen.queryByRole('tooltip')).toBeNull(); expect(screen.queryByText(/email (?:is )?available/i)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: 'Jane' } });
  fireEvent.change(screen.getByLabelText(/^Last Name/), { target: { value: 'Test' } });
  if (kind === 'User') {
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9171234567' } });
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'Sales' } });
  }
  await act(async () => { fireEvent.submit(email.closest('form')!); });
  expect(save).toHaveBeenCalledTimes(1);
  if (kind === 'User') expect(mocks.create).toHaveBeenCalledTimes(1);
});

it.each(['Lead', 'Contact', 'User'] as const)('%s rejects unavailable emails inline and clears them on correction', async kind => {
  const reason = kind === 'User' ? 'EMAIL_IN_USE' : 'STAFF_EMAIL_NOT_ALLOWED';
  mocks.get.mockResolvedValueOnce({ success: true, data: { available: false, reason } });
  const { change, icon, button, email, save } = setup(kind);
  change('staff@camxian.com'); await advance();
  expect(screen.getAllByText(EMAIL_AVAILABILITY_MESSAGES[reason])).toHaveLength(1);
  expect(email.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  expect(button.disabled).toBe(true); expect(icon()).toBeNull(); expect(mocks.error).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: 'Jane' } });
  fireEvent.change(screen.getByLabelText(/^Last Name/), { target: { value: 'Test' } });
  if (kind === 'User') {
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '9171234567' } });
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'Sales' } });
  }
  await act(async () => { fireEvent.submit(email.closest('form')!); }); expect(save).not.toHaveBeenCalled();
  change(kind === 'User' ? 'corrected@GMAIL.COM' : 'corrected@example.test'); expect(icon()).toBeNull();
  expect(screen.queryByText(EMAIL_AVAILABILITY_MESSAGES[reason])).toBeNull();
  await advance(); expect(icon()).not.toBeNull();
  change(''); expect(icon()).toBeNull(); expect(button.disabled).toBe(true);
});

it.each(['Lead', 'Contact', 'User'] as const)('%s ignores outdated success and rejection responses', async kind => {
  const old = deferred(), current = deferred(), newest = deferred();
  mocks.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockReturnValueOnce(newest.promise);
  const { change, icon, button } = setup(kind);
  change(kind === 'User' ? 'first@GMAIL.COM' : 'first@example.test'); await advance();
  const signal = mocks.get.mock.calls[0][1].signal as AbortSignal;
  change(kind === 'User' ? 'second@GMAIL.COM' : 'second@example.test'); expect(signal.aborted).toBe(true); await advance();
  await act(async () => { old.resolve(available); }); expect(icon()).toBeNull(); expect(button.disabled).toBe(true);
  change(kind === 'User' ? 'third@GMAIL.COM' : 'third@example.test'); await advance();
  await act(async () => { current.resolve({ success: true, data: { available: false, reason: 'STAFF_EMAIL_NOT_ALLOWED' } }); });
  expect(screen.queryByText(EMAIL_AVAILABILITY_MESSAGES.STAFF_EMAIL_NOT_ALLOWED)).toBeNull(); expect(icon()).toBeNull();
  await act(async () => { newest.resolve(available); }); expect(icon()).not.toBeNull();
  change(kind === 'User' ? 'second@GMAIL.COM' : 'second@example.test'); change(kind === 'User' ? 'third@GMAIL.COM' : 'third@example.test'); expect(icon()).toBeNull();
});

it.each(['Lead', 'Contact', 'User'] as const)('%s blocks failed checks and retries on blur without changing the value', async kind => {
  mocks.get.mockRejectedValueOnce(new Error('offline'));
  const { change, email, icon, button } = setup(kind);
  change(kind === 'User' ? 'customer@GMAIL.COM' : 'customer@example.test'); await advance();
  expect(screen.getByText('Unable to verify this email. Please try again.')).toBeTruthy();
  expect(icon()).toBeNull(); expect(button.disabled).toBe(true);
  await act(async () => { fireEvent.blur(email); });
  expect(mocks.get).toHaveBeenCalledTimes(2); expect(icon()).not.toBeNull();
});

it('skips unsupported staff domains and checks the normalized address only after correction', async () => {
  const { change, email, icon, button } = setup('User');
  change('staff@gmail.com.fake');
  expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent)
    .toBe('Only @gmail.com and @camxian.com email addresses are allowed.');
  await advance();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(icon()).toBeNull();
  expect(button.disabled).toBe(true);
  change('STAFF@GMAIL.COM');
  expect(email.getAttribute('aria-invalid')).toBe('false');
  expect(icon()).toBeNull();
  await advance();
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/administration/users/email-availability',
    expect.objectContaining({ params: { email: 'staff@gmail.com', purpose: 'staff-creation' } }));
  expect(icon()).not.toBeNull();
});

it.each(['Lead', 'Contact'] as const)('%s displays a submit-time staff race only below the email field', async kind => {
  const { change, email, save, icon } = setup(kind);
  save.mockRejectedValueOnce(Object.assign(new Error(EMAIL_AVAILABILITY_MESSAGES.STAFF_EMAIL_NOT_ALLOWED), { code: 'STAFF_EMAIL_NOT_ALLOWED' }));
  change('customer@example.test'); await advance();
  fireEvent.change(screen.getByLabelText(/^First Name/), { target: { value: 'Jane' } });
  fireEvent.change(screen.getByLabelText(/^Last Name/), { target: { value: 'Test' } });
  await act(async () => { fireEvent.submit(email.closest('form')!); });
  expect(screen.getAllByText(EMAIL_AVAILABILITY_MESSAGES.STAFF_EMAIL_NOT_ALLOWED)).toHaveLength(1);
  expect(icon()).toBeNull(); expect(mocks.error).not.toHaveBeenCalled();
  showCrmMutationError(Object.assign(new Error('staff'), { code: 'STAFF_EMAIL_NOT_ALLOWED' }), 'Unable to save');
  expect(mocks.error).not.toHaveBeenCalled();
  showCrmMutationError(new Error('Different failure'), 'Unable to save'); expect(mocks.error).toHaveBeenCalledTimes(1);
});

it('checks Create User email authorization before unrelated required fields are complete', () => {
  mocks.actor.role = 'Sales'; const { change, icon } = setup('User'); change('external@gmail.com');
  expect(screen.getByText(EMAIL_AVAILABILITY_MESSAGES.EXTERNAL_STAFF_EMAIL_NOT_ALLOWED)).toBeTruthy();
  expect(icon()).toBeNull(); expect(mocks.get).not.toHaveBeenCalled();
});

it('invalidates availability across tenant changes and aborts on unmount', async () => {
  const pending = deferred(); mocks.get.mockReturnValueOnce(pending.promise);
  const { result, rerender, unmount } = renderHook(() => useEmailAvailability('customer@example.test', 'leads'));
  await advance(); const signal = mocks.get.mock.calls[0][1].signal as AbortSignal;
  mocks.actor.tenantId = 'other'; rerender(); expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(available); }); expect(result.current.available).toBe(false);
  await advance(); expect(result.current.available).toBe(true);
  const lastSignal = mocks.get.mock.calls[1][1].signal as AbortSignal;
  unmount(); expect(lastSignal.aborted).toBe(true);
});

it('invalidates captured submit confirmations and ignores failures from an older submitted draft', async () => {
  const { result, rerender } = renderHook(({ email }) => useEmailAvailability(email, 'leads'), { initialProps: { email: 'first@example.test' } });
  await advance(); const first = result.current;
  expect(first.confirm('first@example.test')).toBe(true);
  rerender({ email: 'second@example.test' });
  expect(first.confirm('first@example.test')).toBe(false);
  expect(result.current.available).toBe(false);
  await advance(); expect(result.current.available).toBe(true);
  act(() => first.reject('STAFF_EMAIL_NOT_ALLOWED'));
  expect(result.current.available).toBe(true); expect(result.current.error).toBeUndefined();
});

it('binds public availability to the published version rather than an unrelated signed-in tenant', async () => {
  const { result, rerender } = renderHook(({ version }) => useEmailAvailability('customer@example.test', 'leads', true, { publicId: 'public', version }), { initialProps: { version: 1 } });
  await advance(); const first = result.current;
  expect(mocks.get.mock.calls[0][0]).toBe('/public/forms/public/email-availability');
  expect(mocks.get.mock.calls[0][1].params).toEqual({ email: 'customer@example.test' });
  mocks.actor.tenantId = 'unrelated'; rerender({ version: 1 });
  expect(result.current.available).toBe(true); expect(mocks.get).toHaveBeenCalledTimes(1);
  rerender({ version: 2 });
  expect(first.confirm('customer@example.test')).toBe(false); expect(result.current.available).toBe(false);
  act(() => first.reject('STAFF_EMAIL_NOT_ALLOWED'));
  expect(result.current.error).toBeUndefined();
  await advance(); expect(result.current.available).toBe(true); expect(mocks.get).toHaveBeenCalledTimes(2);
});

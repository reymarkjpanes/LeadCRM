import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultContactForm, EMAIL_AVAILABILITY_MESSAGES, type PublicFormDefinition } from '@leadcrm/shared';

const mocks = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: null, tenant: null }) }));
vi.mock('@/shared/utils/toast', () => ({ toast: { error: mocks.toast } }));
import PublicFormPage from './public-form-page';

const invalidName = 'must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().';
const firstNameError = `First name ${invalidName}`;
const lastNameError = `Last name ${invalidName}`;
const fullNameError = `Full name ${invalidName}`;

let definition: PublicFormDefinition;
const available = { success: true, data: { available: true } };
const staffMessage = EMAIL_AVAILABILITY_MESSAGES.STAFF_EMAIL_NOT_ALLOWED;
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(600); }); };
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
const email = () => screen.getByLabelText(/Email Address/);
const submit = async () => { await act(async () => { fireEvent.submit(email().closest('form')!); }); };
const posts = () => mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function mount() {
  let result!: ReturnType<typeof render>;
  await act(async () => { result = render(<PublicFormPage publicId="public" />); });
  return result;
}
function fill() { change('First Name', 'Anne'); change('Last Name', 'Visitor'); change('Email Address', 'anne@example.com'); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/forms/public');
  definition = { ...defaultContactForm(), version: 1, trackUrlParams: false };
  definition.fields = definition.fields.filter(field => field.mapToField !== 'productInterest').map(field => field.mapToField === 'email' ? { ...field, id: 'visitorEmail' } : field);
  mocks.get.mockReset().mockResolvedValue(available);
  mocks.fetch.mockReset().mockImplementation(async (_url, options) => ({ ok: true, json: async () => options?.method === 'POST' ? { success: true } : { data: definition } }));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('validates renamed CRM name fields immediately and blocks posting until both are corrected', async () => {
  definition.fields = definition.fields.map(field => field.mapToField === 'firstName'
    ? { ...field, id: 'given', label: 'Given Name' }
    : field.mapToField === 'lastName' ? { ...field, id: 'family', label: 'Family Name' } : field);
  await mount();
  change('Email Address', 'anne@example.com');
  change('Given Name', '123John');
  const firstError = screen.getByText(firstNameError);
  expect(screen.getByLabelText(/Given Name/).getAttribute('aria-describedby')).toBe(firstError.id);
  change('Family Name', 'Dela Cru2z');
  const lastError = screen.getByText(lastNameError);
  expect(screen.getByLabelText(/Family Name/).getAttribute('aria-describedby')).toBe(lastError.id);
  await advance();
  await submit();
  expect(posts()).toHaveLength(0);

  change('Given Name', 'Anne-Marie');
  expect(screen.queryByText(firstError.textContent!)).toBeNull();
  expect(lastError.isConnected).toBe(true);
  await submit();
  expect(posts()).toHaveLength(0);
  change('Family Name', 'O’Connor');
  expect(screen.queryByText(lastError.textContent!)).toBeNull();
  change('Given Name', 'Anne@'); change('Family Name', 'Smith_');
  expect(screen.getByText(firstNameError)).toBeTruthy();
  expect(screen.getByText(lastNameError)).toBeTruthy();
  await submit();
  expect(posts()).toHaveLength(0);
  change('Given Name', 'Anne-Marie'); change('Family Name', 'O’Connor');
  await submit();
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0][1].body).values).toMatchObject({ given: 'Anne-Marie', family: 'O’Connor' });
});

it('validates a legacy mapped Full Name immediately and accepts a corrected Unicode name', async () => {
  definition.fields = definition.fields.filter(field => !['firstName', 'lastName'].includes(field.mapToField ?? ''));
  definition.fields.unshift({ id: 'person', label: 'Your name', type: 'contact-name', mapToField: 'fullName', required: true });
  await mount();
  change('Email Address', 'full-name@example.com');
  change('Your name', 'John@ Smith123');
  const input = screen.getByLabelText(/Your name/);
  expect(screen.getByText(fullNameError).id).toBe(input.getAttribute('aria-describedby'));
  expect(input).toHaveProperty('value', 'John@ Smith123');
  await advance(); await submit();
  expect(posts()).toHaveLength(0);
  change('Your name', 'John@ Smith');
  expect(screen.getByText(fullNameError)).toBeTruthy();
  change('Your name', 'María O’Connor');
  expect(input.getAttribute('aria-invalid')).toBe('false');
  expect(screen.queryByText(fullNameError)).toBeNull();
  await submit();
  expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0][1].body).values.person).toBe('María O’Connor');
});

it('captures legacy tagged links without a remember checkbox and reuses the submission identity on retry', async () => {
  definition.trackUrlParams = true;
  window.history.replaceState({}, '', '/forms/public?utm_source=google&utm_medium=cpc&utm_campaign=shared_before_cleanup');
  await mount();
  expect(screen.queryByRole('checkbox', { name: /Remember how I found this form/ })).toBeNull();
  fill(); await advance();
  mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Please retry.' }) });
  await submit(); await submit();
  const [first, second] = posts().map(([, options]) => JSON.parse(options.body));
  expect(first.attribution).toMatchObject({ storage: 'session', last: { params: { utm_campaign: 'shared_before_cleanup' } } });
  expect(first.tracking).toMatchObject({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'shared_before_cleanup' });
  expect(second.requestId).toBe(first.requestId);
  expect(localStorage.length).toBe(0);
});

it.each([
  { id: 'firstName', label: 'First Name', type: 'single-line' as const },
  { id: 'address', label: 'Full Address', type: 'multi-line' as const },
  { id: 'customText', label: 'Custom text', type: 'single-line' as const, customFieldId: 'custom-text' },
  { id: 'customNotes', label: 'Custom notes', type: 'multi-line' as const, customFieldId: 'custom-notes' },
  { id: 'site', label: 'Website', type: 'url' as const },
])('validates required $label on interaction and clears whitespace errors while typing', async field => {
  definition.fields = [...definition.fields.filter(old => old.id !== field.id), { ...field, required: true }];
  await mount();
  const input = screen.getByLabelText(new RegExp(field.label));
  expect(screen.queryByText(/is required\./)).toBeNull();
  fireEvent.focus(input); fireEvent.blur(input);
  const message = `${field.label} is required.`;
  expect(screen.getAllByText(message)).toHaveLength(1);
  expect(input.getAttribute('aria-describedby')).toBe(screen.getByText(message).id);
  change(field.label, '   '); expect(screen.getByText(message)).toBeTruthy();
  change(field.label, field.type === 'url' ? 'https://example.com' : 'Valid answer');
  expect(screen.queryByText(message)).toBeNull();
  expect(input.getAttribute('aria-invalid')).toBe('false');
  change(field.label, ''); expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText('Last Name is required.')).toBeNull();
  expect(posts()).toHaveLength(0);
});

it('reveals untouched required fields on submit and clears their errors immediately on correction', async () => {
  await mount(); await submit();
  expect(screen.getAllByText('First Name is required.')).toHaveLength(1);
  expect(screen.getAllByText('Email Address is required.')).toHaveLength(1);
  change('First Name', 'Anne'); expect(screen.queryByText('First Name is required.')).toBeNull();
  expect(screen.getByText('Last Name is required.')).toBeTruthy(); expect(posts()).toHaveLength(0);
});

it('revalidates telephone and email rules while typing without checking invalid email syntax', async () => {
  definition.fields = definition.fields.map(field => field.mapToField === 'phone' ? { ...field, required: true } : field);
  await mount();
  fireEvent.blur(screen.getByLabelText(/Contact Number/));
  expect(screen.getByText('Contact Number is required.')).toBeTruthy();
  change('Contact Number', '8123'); expect(screen.getByText('Enter 10 digits starting with 9.')).toBeTruthy();
  change('Contact Number', '9123456789'); expect(screen.queryByText('Enter 10 digits starting with 9.')).toBeNull();
  change('Email Address', 'invalid'); expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  await advance(); expect(mocks.get).not.toHaveBeenCalled();
  change('Email Address', 'anne@example.com'); expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  await advance(); expect(mocks.get).toHaveBeenCalledTimes(1);
});

it('checks staff emails before Submit, blocks pending checks, and clears rejection on correction', async () => {
  mocks.get.mockResolvedValueOnce({ success: true, data: { available: false, reason: 'STAFF_EMAIL_NOT_ALLOWED' } });
  await mount(); fill(); change('Email Address', 'STAFF@camxian.com');
  expect(mocks.get).not.toHaveBeenCalled(); await submit(); expect(posts()).toHaveLength(0);
  await advance();
  expect(mocks.get.mock.calls[0][0]).toBe('/public/forms/public/email-availability');
  expect(mocks.get.mock.calls[0][1].params).toEqual({ email: 'STAFF@camxian.com' });
  expect(screen.getAllByText(staffMessage)).toHaveLength(1);
  expect(email().getAttribute('aria-describedby')).toBe(screen.getByText(staffMessage).id);
  expect(screen.queryByRole('alert')).toBeNull(); expect(mocks.toast).not.toHaveBeenCalled();
  expect(document.querySelector('svg.lucide-check')).toBeNull();
  await submit(); expect(posts()).toHaveLength(0);
  change('Email Address', 'customer@example.com'); expect(screen.queryByText(staffMessage)).toBeNull();
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty('disabled', true);
  await advance(); await submit(); expect(posts()).toHaveLength(1);
  expect(screen.getByText('Thank you!')).toBeTruthy();
});

it.each(['offline', 'malformed'] as const)('requires a successful retry after a %s verification failure', async failure => {
  if (failure === 'offline') mocks.get.mockRejectedValueOnce(new Error('offline'));
  else mocks.get.mockResolvedValueOnce({ success: true, data: {} });
  await mount(); fill(); await advance();
  expect(screen.getByText('Unable to verify this email. Please try again.')).toBeTruthy();
  await submit(); expect(posts()).toHaveLength(0);
  await act(async () => { fireEvent.blur(email()); });
  expect(mocks.get).toHaveBeenCalledTimes(2);
  await submit(); expect(posts()).toHaveLength(1);
});

it('ignores stale availability responses and aborts old checks', async () => {
  const old = deferred<typeof available>(), current = deferred<typeof available>();
  mocks.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const mounted = await mount(); fill(); await advance();
  const signal = mocks.get.mock.calls[0][1].signal as AbortSignal;
  change('Email Address', 'second@example.com'); expect(signal.aborted).toBe(true); await advance();
  await act(async () => { old.resolve(available); });
  await submit(); expect(posts()).toHaveLength(0);
  await act(async () => { current.resolve(available); });
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty('disabled', false);
  mounted.unmount(); expect((mocks.get.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
});

it('invalidates checks when the published form changes', async () => {
  const old = deferred<typeof available>(); mocks.get.mockReturnValueOnce(old.promise);
  const mounted = await mount(); fill(); await advance();
  await act(async () => { mounted.rerender(<PublicFormPage publicId="other" />); });
  expect((mocks.get.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  expect(email()).toHaveProperty('value', '');
  fill(); await act(async () => { old.resolve(available); });
  await submit(); expect(posts()).toHaveLength(0);
  await advance(); expect(mocks.get.mock.calls[1][0]).toBe('/public/forms/other/email-availability');
});

it('shows a submit-time staff rejection once below the mapped email without a form error', async () => {
  await mount(); fill(); await advance();
  mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Please check the highlighted fields.', fieldErrors: { visitorEmail: staffMessage } }) });
  await submit();
  expect(screen.getAllByText(staffMessage)).toHaveLength(1); expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Please check the highlighted fields.')).toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();
  change('Email Address', 'corrected@example.com'); expect(screen.queryByText(staffMessage)).toBeNull();
  await submit(); expect(posts()).toHaveLength(1);
  await advance(); await submit(); expect(posts()).toHaveLength(2);
});

it('ignores a staff rejection for an email edited while submission was pending', async () => {
  await mount(); fill(); await advance();
  const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
  mocks.fetch.mockReturnValueOnce(response.promise);
  await submit(); change('Email Address', 'corrected@example.com'); await advance();
  await act(async () => { response.resolve({ ok: false, json: async () => ({ fieldErrors: { visitorEmail: staffMessage } }) }); });
  expect(screen.queryByText(staffMessage)).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  await submit(); expect(posts()).toHaveLength(2); expect(screen.getByText('Thank you!')).toBeTruthy();
});

it.each([true, false])('preserves phone-only submissions with an optional or absent email (present=%s)', async present => {
  definition.fields = definition.fields.filter(field => present || field.mapToField !== 'email').map(field => field.mapToField === 'email' ? { ...field, required: false } : field);
  await mount(); change('First Name', 'Anne'); change('Last Name', 'Visitor'); change('Contact Number', '9123456789');
  await act(async () => { fireEvent.submit(screen.getByLabelText(/First Name/).closest('form')!); });
  expect(mocks.get).not.toHaveBeenCalled(); expect(posts()).toHaveLength(1); expect(screen.getByText('Thank you!')).toBeTruthy();
});

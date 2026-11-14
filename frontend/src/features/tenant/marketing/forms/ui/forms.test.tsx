import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ClosingFieldInputSchema, defaultContactForm, getCrmFieldCatalog, withProductOptions } from '@leadcrm/shared';
import { FormBuilderPage } from './form-builder-page';
import { FormInput } from './form-input';
import PublicFormPage from './public-form-page';
import FormsPage from './forms-page';
import * as service from '../services/forms.service';
import { FieldPalette, paletteFieldsFromCatalog } from './field-palette';
import { requestNavigation } from '@/shared/lib/navigation-intent';
import { useLayout } from '@/features/tenant/layout/use-layout';
import { INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR as employeeMessage } from '@leadcrm/shared';
import { toast } from '@/shared/utils/toast';

const invalidName = 'must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().';
const firstNameError = `First name ${invalidName}`;
const fullNameError = `Full name ${invalidName}`;
vi.mock('@/shared/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const routing = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/shared/hooks/use-email-availability', () => ({ useEmailAvailability: (email: string) => ({ available: true, blocked: false, confirm: () => true, email: email.trim(), retry: vi.fn(), reject: vi.fn() }) }));
vi.mock('../services/forms.service', () => ({ getLeadFormFieldCatalog: vi.fn(), updateForm: vi.fn(), publishForm: vi.fn(), getFormById: vi.fn(), getFormsByTenant: vi.fn(), createForm: vi.fn(), deleteForm: vi.fn(), unpublishForm: vi.fn(), duplicateForm: vi.fn(), getShareLink: () => 'https://example.com/forms/public', getEmbedCode: () => '<iframe />' }));
vi.mock('next/navigation', () => ({ useRouter: () => routing, useSearchParams: () => new URLSearchParams(), usePathname: () => '/settings' }));

it.each([true, false])('excludes native Lead Source from palette drag/tap controls (drag=%s) while retaining other fields', dragEnabled => {
  const catalog = getCrmFieldCatalog('leads');
  const source = catalog.find(field => field.technicalKey === 'source')!;
  render(<FieldPalette dragEnabled={dragEnabled} catalog={[...catalog, { ...source, kind: 'Custom', technicalKey: 'custom-source', customFieldId: 'custom-source', label: 'Lead Source' }]} onAddField={vi.fn()} />);
  expect(paletteFieldsFromCatalog(catalog).some(field => field.mapToField === 'source')).toBe(false);
  expect(screen.queryByTitle('Add Lead Source' + (dragEnabled ? ' — or drag onto canvas' : ''))).toHaveProperty('textContent', expect.stringContaining('Lead Source'));
  expect(screen.getAllByText('Lead Source')).toHaveLength(1);
  for (const label of ['First Name', 'Last Name', 'Email', 'Phone', 'Company Name', 'Product Interest', 'Lead Address', 'Header', 'Paragraph', 'Separator line']) expect(screen.getByText(label)).toBeTruthy();
  expect(paletteFieldsFromCatalog(catalog).some(field => field.mapToField === 'address')).toBe(true);
  expect(getCrmFieldCatalog('leads').find(field => field.technicalKey === 'source')).toEqual(source);
});
it.each(['draft', 'published'] as const)('removes Direct Mail from a saved native Lead Source in a %s Form', async status => {
  const source = { id: 'historical-source', type: 'dropdown' as const, label: 'Lead Source', mapToField: 'source' as const, options: ['Website', 'Direct Mail', 'Referral'], required: true };
  const saved = { ...form, status, fields: [...form.fields, source] };
  vi.mocked(service.updateForm).mockImplementation(async (_id, dto) => ({ ...saved, ...dto, revision: 1 }));
  render(<FormBuilderPage form={saved} onBack={() => {}} onFormUpdate={() => {}} />);
  expect(screen.getByLabelText('Edit Lead Source')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Preserved source' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(service.updateForm).toHaveBeenCalled());
  expect(vi.mocked(service.updateForm).mock.calls[0][1].fields?.find(field => field.id === source.id)).toEqual({ ...source, options: ['Website', 'Referral'] });
});
const permissions = vi.hoisted(() => ({ edit: true, publish: true }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { }, userCan: (_module: string, permission: string) => permission === 'canEdit' ? permissions.edit : permission === 'canPublish' ? permissions.publish : true }) }));
const products = [{ id: '0ff82f9c-48e9-4e1c-8c77-8a30755d704c', name: 'Smart Lock', dealValue: 5000, active: true, createdAt: '', updatedAt: '' }];
const productCatalog = vi.hoisted(() => ({ products: [] as import('@leadcrm/shared').ProductInterest[], categories: [] as string[] }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ ...productCatalog, loading: false, error: '' }) }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: getCrmFieldCatalog('leads', [{ ...ClosingFieldInputSchema.parse({ name: 'Age', type: 'Number', module: 'leads', group: 'Basic Information', required: false }), id: 'age', version: 1 }]), isInitialLoad: false, error: null, refetch: vi.fn() }) }));
const form = { ...defaultContactForm(), fields: withProductOptions(defaultContactForm().fields, products), id: 'form', tenantId: 'tenant', publicId: 'public', revision: 0, publishedRevision: null, publishedVersion: 0, status: 'draft' as const, createdAt: '', updatedAt: '' };
beforeEach(() => { vi.resetAllMocks(); productCatalog.products = []; productCatalog.categories = []; permissions.edit = true; permissions.publish = true; vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Forms UI', () => {
  it('validates a sample name in the builder without changing the form definition', () => {
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    const first = screen.getByRole('textbox', { name: 'First Name' });
    fireEvent.input(first, { target: { value: 'Mar1a' } });
    expect(first).toHaveProperty('value', 'Mar1a');
    expect(screen.getByText(firstNameError).id).toBe(first.getAttribute('aria-describedby'));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    fireEvent.input(first, { target: { value: 'María' } });
    expect(screen.queryByText(firstNameError)).toBeNull();
    fireEvent.input(first, { target: { value: 'María@' } });
    expect(screen.getByText(firstNameError)).toBeTruthy();
    fireEvent.input(first, { target: { value: 'María' } });
    expect(screen.queryByText(firstNameError)).toBeNull();
  });

  it('validates mapped Full Name samples without changing the saved definition', () => {
    const legacy = { ...form, fields: [{ id: 'person', label: 'Your name', type: 'contact-name' as const, mapToField: 'fullName' as const }] };
    render(<FormBuilderPage form={legacy} onBack={() => {}} onFormUpdate={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Your name' });
    fireEvent.input(input, { target: { value: 'John1@ Smith' } });
    expect(screen.getByText(fullNameError).id).toBe(input.getAttribute('aria-describedby'));
    fireEvent.input(input, { target: { value: 'John@ Smith' } });
    expect(screen.getByText(fullNameError)).toBeTruthy();
    fireEvent.input(input, { target: { value: 'Anne-Marie O’Connor' } });
    expect(screen.queryByText(fullNameError)).toBeNull();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('uses contextual fallbacks, preserves configured placeholders and retains public field design', () => {
    const text = `ñ é 中文 日本語 한글 مرحبا 😊 & ' " < > ∑ ₱ e\u0301`;
    const onChange = vi.fn();
    const design = { ...form.design, fieldBg: '#ffeeee', fieldText: '#123456', fieldBorder: '#654321', fieldSize: 'lg' as const, fieldRadius: 'lg' as const };
    const view = render(<FormInput field={{ id: 'unicode', type: 'multi-line', label: 'Notes' }} design={design} value={text} onChange={onChange} />);
    const notes = screen.getByPlaceholderText('Enter notes...');
    expect(notes).toHaveProperty('value', text);
    expect(notes.style.backgroundColor).toBe('rgb(255, 238, 238)');
    expect(notes.style.padding).toBe('12px');
    expect(notes.style.borderRadius).toBe('12px');
    fireEvent.change(notes, { target: { value: text + '\n<tag>literal</tag>' } });
    expect(onChange).toHaveBeenLastCalledWith(text + '\n<tag>literal</tag>');
    view.rerender(<FormInput field={{ id: 'unicode', type: 'single-line', label: text, placeholder: 'Your preferred name...' }} design={design} value={text} onChange={onChange} />);
    expect(screen.getByPlaceholderText('Your preferred name...')).toHaveProperty('value', text);
    expect(view.container.querySelector('tag')).toBeNull();
  });
  it('keeps a rejected employee email submission open with one inline error and corrected retry', async () => {
    const definition = defaultContactForm();
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...definition, fields: definition.fields.filter(field => field.mapToField !== 'productInterest'), version: 1, trackUrlParams: false } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: employeeMessage, fieldErrors: { email: employeeMessage } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicFormPage publicId="public" />);
    await screen.findByText('Contact Us');
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Anne' } });
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Visitor' } });
    const email = screen.getByLabelText(/Email Address/);
    fireEvent.change(email, { target: { value: 'employee@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findAllByText(employeeMessage);
    expect(email).toHaveProperty('value', 'employee@example.test');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Thank you!')).toBeNull();
    expect(screen.getAllByText(employeeMessage)).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: 'customer@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Thank you!');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).values.email).toBe('customer@example.test');
  });
  it('keeps the request ID for unchanged retries and changes it for a distinct inquiry', async () => {
    const definition = defaultContactForm();
    const payloads: Array<{ requestId: string; values: Record<string, unknown> }> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      if (!options?.body) return { ok: true, json: async () => ({ data: { ...definition, fields: definition.fields.filter(field => field.mapToField !== 'productInterest'), version: 1, trackUrlParams: false } }) };
      payloads.push(JSON.parse(options.body));
      return { ok: payloads.length === 3, json: async () => payloads.length === 3 ? { success: true } : { error: 'Please retry this inquiry.' } };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicFormPage publicId="public" />);
    await screen.findByText('Contact Us');
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Anne' } });
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Visitor' } });
    fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: 'anne@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Please retry this inquiry.');
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: ' Anne ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(payloads).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty('disabled', false));
    expect(payloads[0].requestId).toMatch(/^[\da-f-]{36}$/);
    expect(payloads[1].requestId).toBe(payloads[0].requestId);
    fireEvent.change(screen.getByLabelText(/Full Address/), { target: { value: 'Distinct inquiry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Thank you!');
    expect(payloads[2].requestId).not.toBe(payloads[0].requestId);
  });

  const unloadPrevented = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };

  it('filters builder preview selections without changing saved fields or dirty state', async () => {
    const network = { ...products[0], id: '87582f9c-48e9-4e1c-8c77-8a30755d704c', name: 'Network', category: 'Network' };
    productCatalog.products = [{ ...products[0], category: 'Security' }, network];
    productCatalog.categories = ['Security', 'Empty', 'Network'];
    const saved = { ...form, fields: withProductOptions(form.fields, productCatalog.products) };
    vi.mocked(service.updateForm).mockImplementation(async (_id, dto) => ({ ...saved, ...dto, revision: 1 }));
    render(<FormBuilderPage form={saved} onBack={vi.fn()} onFormUpdate={vi.fn()} />);
    const category = screen.getByLabelText('Product category');
    const list = screen.getByRole('button', { name: 'Product Interest' });
    fireEvent.click(list);
    expect(category.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(category).toHaveProperty('value', '');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Smart Lock' }));
    fireEvent.change(category, { target: { value: 'Network' } });
    expect(screen.getByRole('checkbox', { name: 'Smart Lock' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Network' }));
    fireEvent.change(category, { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'Smart Lock' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Network' })).toHaveProperty('checked', true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save draft' })).toHaveProperty('disabled', true);
    expect(unloadPrevented()).toBe(false);
    expect(screen.getByLabelText('Drag Product Interest')).toBeTruthy();
    expect(screen.getByLabelText('Edit Product Interest')).toBeTruthy();
    expect(screen.getByLabelText('Remove Product Interest')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Saved preview' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(service.updateForm).toHaveBeenCalled());
    expect(vi.mocked(service.updateForm).mock.calls[0][1].fields).toEqual(saved.fields);
    expect(vi.mocked(service.updateForm).mock.calls[0][1]).not.toHaveProperty('productCatalog');
  });

  it('validates all selected Product IDs and submits hidden selections without category data', async () => {
    const catalog = { products: [{ ...products[0], category: 'Security' }, { ...products[0], id: '87582f9c-48e9-4e1c-8c77-8a30755d704c', name: 'Network', category: 'Network' }], categories: ['Security', 'Network', 'Empty'] };
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...defaultContactForm(), fields: withProductOptions(defaultContactForm().fields, catalog.products), productCatalog: catalog, version: 1, trackUrlParams: false } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicFormPage publicId="public" />);
    await screen.findByText('Contact Us');
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Anne' } });
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Visitor' } });
    fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: 'anne@example.com' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByRole('button', { name: 'Product Interest' }).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement?.id).toBe('input-productInterest');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Smart Lock' }));
    const category = screen.getByLabelText('Product category');
    fireEvent.change(category, { target: { value: 'Network' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Network' }));
    fireEvent.change(category, { target: { value: 'Empty' } });
    expect(screen.getByRole('checkbox', { name: 'Smart Lock' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'Network' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Thank you!');
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload.values).toEqual({ firstName: 'Anne', lastName: 'Visitor', email: 'anne@example.com', productInterest: [products[0].id, catalog.products[1].id] });
    expect(payload).not.toHaveProperty('productCatalog');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('leaves immediately when clean without saving or opening a confirmation', () => {
    const back = vi.fn(); render(<FormBuilderPage form={form} onBack={back} onFormUpdate={vi.fn()} />);
    expect(unloadPrevented()).toBe(false);
    fireEvent.click(screen.getByLabelText('Back to Forms'));
    expect(back).toHaveBeenCalledTimes(1); expect(service.updateForm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each(['Keep editing', 'Close confirmation', 'Escape', 'backdrop'])('preserves edits and unload protection after dismissing with %s', method => {
    const back = vi.fn(); render(<FormBuilderPage form={form} onBack={back} onFormUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByLabelText('Back to Forms'));
    const dialog = screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(within(dialog).getByText('Your unsaved form changes will be lost.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Discard changes' }).className).toContain('bg-orange-700');
    expect(screen.queryByText('Save or discard your edits before leaving.')).toBeNull();
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(document.querySelector('[data-confirm-action-layer] > [aria-hidden]')!);
    else fireEvent.click(within(dialog).getByRole('button', { name: method }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Form name')).toHaveProperty('value', 'Unsaved title');
    expect(unloadPrevented()).toBe(true); expect(back).not.toHaveBeenCalled(); expect(service.updateForm).not.toHaveBeenCalled();
  });

  it('discards even invalid edits, clears unload protection and leaves without saving', async () => {
    const back = vi.fn(); render(<FormBuilderPage form={form} onBack={back} onFormUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: '' } });
    expect(unloadPrevented()).toBe(true); fireEvent.click(screen.getByLabelText('Back to Forms'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(back).toHaveBeenCalledTimes(1); expect(service.updateForm).not.toHaveBeenCalled(); expect(service.publishForm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Form name')).toHaveProperty('value', form.name); expect(unloadPrevented()).toBe(false);
  });

  it('blocks navigation during a normal draft save and clears unload protection after success', async () => {
    let resolve!: (saved: typeof form) => void;
    vi.mocked(service.updateForm).mockReturnValue(new Promise(done => { resolve = done; }));
    const back = vi.fn(), updated = vi.fn(); render(<FormBuilderPage form={form} onBack={back} onFormUpdate={updated} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Saved title' } });
    const destination = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.click(screen.getByLabelText('Back to Forms'));
    act(() => requestNavigation(destination));
    expect(back).not.toHaveBeenCalled(); expect(service.updateForm).toHaveBeenCalledTimes(1);
    expect(service.updateForm).toHaveBeenCalledWith(form.id, expect.objectContaining({ name: 'Saved title', revision: form.revision }));
    expect(destination).not.toHaveBeenCalled(); expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Back to Forms')).toHaveProperty('disabled', true); expect(unloadPrevented()).toBe(true);
    await act(async () => resolve({ ...form, name: 'Saved title', revision: 1 }));
    expect(back).not.toHaveBeenCalled(); expect(updated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Saved title', revision: 1 }));
    expect(service.publishForm).not.toHaveBeenCalled(); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(unloadPrevented()).toBe(false);
    act(() => requestNavigation(destination)); expect(destination).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Back to Forms')); expect(back).toHaveBeenCalledOnce();
  });

  it.each(['validation', 'request'])('returns to the builder after a %s failure, retaining edits and the inline error', async failure => {
    vi.mocked(service.updateForm).mockRejectedValue(new Error('Save failed'));
    const back = vi.fn(); render(<FormBuilderPage form={form} onBack={back} onFormUpdate={vi.fn()} />);
    const name = failure === 'validation' ? '   ' : 'Unsaved title';
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect((await screen.findByRole('alert')).textContent).toContain(failure === 'validation' ? 'Form name is required.' : 'Save failed');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Form name')).toHaveProperty('value', name); expect(back).not.toHaveBeenCalled();
    expect(service.updateForm).toHaveBeenCalledTimes(failure === 'validation' ? 0 : 1); expect(service.publishForm).not.toHaveBeenCalled(); expect(unloadPrevented()).toBe(true);
  });

  it('allows discarding after edit permission is lost without saving', async () => {
    const back = vi.fn(), updated = vi.fn();
    const { rerender } = render(<FormBuilderPage form={form} onBack={back} onFormUpdate={updated} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    permissions.edit = false; rerender(<FormBuilderPage form={form} onBack={back} onFormUpdate={updated} />);
    fireEvent.click(screen.getByLabelText('Back to Forms'));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(service.updateForm).not.toHaveBeenCalled();
  });

  it.each([['Dashboard', 'dashboard', '/dashboard'], ['Leads', 'leads', '/crm/leads'], ['Contacts', 'contacts', '/crm/contacts'], ['Accounts', 'accounts', '/crm/accounts'], ['Deals', 'pipeline', '/crm/pipeline'], ['Tasks', 'tasks', '/operations/taskboard'], ['Campaigns', 'campaigns', '/marketing/campaigns'], ['Workflows', 'workflows', '/automation/workflows'], ['Settings', 'settings', '/settings'], ['Inbox', 'inbox', '/inbox']])('guards %s navigation and resumes the exact original destination once', async (label, module, destination) => {
    function Navigation() { const { navigate } = useLayout(); return <nav aria-label="Modules"><button onClick={() => requestNavigation(() => navigate(module))}>{label}</button></nav>; }
    render(<><Navigation /><FormBuilderPage form={form} onBack={vi.fn()} onFormUpdate={vi.fn()} /></>);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('button', { name: label }));
    expect(routing.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Form name')).toHaveProperty('value', 'Unsaved title'); expect(routing.push).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('button', { name: label }));
    const discard = screen.getByRole('button', { name: 'Discard changes' }); fireEvent.click(discard); fireEvent.click(discard);
    await waitFor(() => expect(routing.push).toHaveBeenCalledOnce());
    expect(routing.push).toHaveBeenCalledWith(destination); expect(service.updateForm).not.toHaveBeenCalled();
  });

  it('captures internal links including their query/hash and clears the canceled destination', async () => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault()), back = vi.fn();
    render(<><a href="/crm/contacts?highlight=contact-1#details" onClick={clicked}>Contact destination</a><FormBuilderPage form={form} onBack={back} onFormUpdate={vi.fn()} /></>);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByText('Contact destination')); expect(clicked).not.toHaveBeenCalled(); expect(routing.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' })); fireEvent.click(screen.getByLabelText('Back to Forms'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })); await waitFor(() => expect(back).toHaveBeenCalledOnce());
    expect(routing.push).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Another edit' } });
    expect(unloadPrevented()).toBe(true);
    fireEvent.click(screen.getByText('Contact destination')); fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(routing.push).toHaveBeenCalledWith('/crm/contacts?highlight=contact-1#details'));
  });

  it.each(['new tab', 'download', 'same page', 'external', 'ctrl', 'meta', 'shift', 'alt', 'middle'])('does not intercept %s links while dirty', kind => {
    const clicked = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<><a href={kind === 'same page' ? '#section' : kind === 'external' ? 'https://example.com' : '/crm/contacts'} target={kind === 'new tab' ? '_blank' : undefined} download={kind === 'download' || undefined} onClick={clicked}>Destination</a><FormBuilderPage form={form} onBack={vi.fn()} onFormUpdate={vi.fn()} /></>);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByText('Destination'), { ctrlKey: kind === 'ctrl', metaKey: kind === 'meta', shiftKey: kind === 'shift', altKey: kind === 'alt', button: kind === 'middle' ? 1 : 0 });
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(clicked).toHaveBeenCalledOnce(); expect(unloadPrevented()).toBe(true);
  });

  it('allows builder tabs, menus, tools and design changes without requesting an exit', () => {
    render(<FormBuilderPage form={form} onBack={vi.fn()} onFormUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    for (const tab of ['Settings', 'Share', 'Builder']) { fireEvent.click(screen.getByRole('button', { name: tab })); expect(screen.queryByRole('alertdialog')).toBeNull(); }
    fireEvent.click(screen.getByLabelText('More actions')); fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByText('Add fields or change design')); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Design' }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('More actions')); fireEvent.click(screen.getByRole('menuitem', { name: 'Discard changes' }));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(unloadPrevented()).toBe(false);
  });

  it('removes navigation interception when the builder unmounts', () => {
    const view = render(<FormBuilderPage form={form} onBack={vi.fn()} onFormUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } }); view.unmount();
    const navigate = vi.fn(); requestNavigation(navigate); expect(navigate).toHaveBeenCalledOnce(); expect(unloadPrevented()).toBe(false);
  });

  it('keeps the confirmation locked until an asynchronous destination action finishes', async () => {
    let resolve!: () => void; const navigate = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    render(<FormBuilderPage form={form} onBack={vi.fn()} onFormUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    act(() => requestNavigation(navigate));
    const dialog = screen.getByRole('alertdialog'), discard = within(dialog).getByRole('button', { name: 'Discard changes' });
    fireEvent.click(discard); fireEvent.click(discard); fireEvent.keyDown(document, { key: 'Escape' });
    expect(navigate).toHaveBeenCalledOnce(); expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveProperty('disabled', true);
    await act(async () => resolve()); expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(unloadPrevented()).toBe(false);
  });

  it('keeps the shared menu and decorative action icons with existing disabled states', () => {
    permissions.publish = false;
    render(<FormBuilderPage form={{ ...form, status: 'published' }} onBack={vi.fn()} onFormUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    const menu = screen.getByRole('menu'), discard = within(menu).getByRole('menuitem', { name: 'Discard changes' }), unpublish = within(menu).getByRole('menuitem', { name: 'Unpublish' });
    expect(menu.closest('[data-theme-portal]')?.parentElement).toBe(document.body);
    expect(discard.querySelector('svg.lucide-rotate-ccw[aria-hidden="true"][width="14"]')).toBeTruthy();
    expect(unpublish.querySelector('svg.lucide-eye-off[aria-hidden="true"][width="14"]')).toBeTruthy();
    expect(discard).toHaveProperty('disabled', true); expect(unpublish).toHaveProperty('disabled', true);
  });

  it('shows the required name indicator and retains all fields after whitespace name validation', async () => {
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    const name = screen.getByLabelText('Form name') as HTMLInputElement;
    expect(name.required).toBe(true); expect(name.parentElement?.querySelector('.text-red-600')?.textContent).toContain('*');
    fireEvent.change(name, { target: { value: '   ' } }); fireEvent.click(screen.getByText('Publish')); if (screen.queryByRole('button', { name: 'Publish form' })) fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
    expect(screen.getByRole('alert').textContent).toContain('Form name is required.');
    expect(screen.getAllByLabelText(/^Drag /)).toHaveLength(form.fields.length);
    expect(service.updateForm).not.toHaveBeenCalled(); expect(service.publishForm).not.toHaveBeenCalled();
  });
  it('lets an edit-only employee save a draft while publishing stays disabled', async () => {
    permissions.publish = false;
    vi.mocked(service.updateForm).mockImplementation(async (_id, dto) => ({ ...form, ...dto, revision: 1 }));
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Edited draft' } });
    expect((screen.getByLabelText('Form name') as HTMLInputElement).value).toBe('Edited draft');
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(service.updateForm).toHaveBeenCalledWith('form', expect.objectContaining({ name: 'Edited draft' })));
    expect(service.publishForm).not.toHaveBeenCalled();
  });
  it('keeps draft changes locked for a publish-only employee but allows publishing the saved form', async () => {
    permissions.edit = false;
    vi.mocked(service.publishForm).mockResolvedValue({ ...form, status: 'published' });
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unauthorized edit' } });
    expect((screen.getByLabelText('Form name') as HTMLInputElement).value).toBe('Contact Us');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' })); if (screen.queryByRole('button', { name: 'Publish form' })) fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
    await waitFor(() => expect(service.publishForm).toHaveBeenCalledWith('form'));
    expect(service.updateForm).not.toHaveBeenCalled();
  });
  it('keeps legacy Company Website readable as a submission-only answer', async () => {
    vi.mocked(service.updateForm).mockImplementation(async (_id, dto) => ({ ...form, ...dto, revision: 1 }));
    render(<FormBuilderPage form={{ ...form, fields: [...form.fields, { id: 'website', type: 'company-website', label: 'Company Website' }] }} onBack={() => {}} onFormUpdate={() => {}} />);
    fireEvent.click(screen.getByLabelText('Edit Company Website'));
    expect(screen.getByText('Website answers are saved in submission history. They do not update the CRM record.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Legacy form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(service.updateForm).toHaveBeenCalled());
    const added = vi.mocked(service.updateForm).mock.calls[0][1].fields?.find(field => field.type === 'company-website');
    expect(added?.mapToField).toBeUndefined();
  });
  it('distinguishes loading, error and empty lists and retries', async () => {
    vi.mocked(service.getFormsByTenant).mockRejectedValueOnce(new Error('Network failed')).mockResolvedValue([]);
    render(<FormsPage />); expect(screen.getByLabelText('Loading forms')).toBeTruthy(); expect(screen.queryByText('No forms yet')).toBeNull();
    await screen.findByText('Network failed'); fireEvent.click(screen.getByText('Retry')); await screen.findByText('No forms yet');
  });
  it('uses the portal menu with exactly Edit, Duplicate, Delete', async () => {
    vi.mocked(service.getFormsByTenant).mockResolvedValue([form]); render(<FormsPage />); await screen.findByText('Contact Us');
    fireEvent.click(screen.getByLabelText('More actions')); const menu = screen.getByRole('menu'); expect(within(menu).getAllByRole('menuitem').map(e => e.textContent)).toEqual(['Edit','Duplicate','Delete']);
    expect(menu.closest('[data-theme-portal]')?.parentElement).toBe(document.body); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull();
  });
  it('blocks published deletion with an explanation and allows deletion after unpublishing', async () => {
    const published = { ...form, status: 'published' as const, publishedVersion: 2 };
    vi.mocked(service.getFormsByTenant).mockResolvedValue([published]);
    vi.mocked(service.unpublishForm).mockResolvedValue({ ...published, status: 'draft' });
    render(<FormsPage />); await screen.findByText('Contact Us');
    fireEvent.click(screen.getByLabelText('More actions'));
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Unpublish this form before deleting it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent?.split('Unpublish this')[0])).toEqual(['Edit', 'Duplicate', 'Unpublish', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpublish' })); fireEvent.click(screen.getByRole('button', { name: 'Unpublish form' })); await screen.findByText('Draft');
    expect(service.unpublishForm).toHaveBeenCalledWith('form');
    fireEvent.click(screen.getByLabelText('More actions'));
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('unpublishes from the builder menu, updates the list, and preserves unsaved edits', async () => {
    const published = { ...form, status: 'published' as const, publishedVersion: 2 };
    const updated = { ...published, status: 'draft' as const, revision: 3 };
    vi.mocked(service.getFormsByTenant).mockResolvedValue([published]);
    vi.mocked(service.unpublishForm).mockResolvedValue(updated);
    render(<FormsPage />); await screen.findByText('Contact Us');
    expect(screen.queryByText('Unpublish')).toBeNull();
    fireEvent.click(screen.getByLabelText('Edit Contact Us'));
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Discard changes', 'Unpublish']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpublish' })); fireEvent.click(screen.getByRole('button', { name: 'Unpublish form' }));
    await screen.findByText('Draft');
    expect(service.unpublishForm).toHaveBeenCalledWith('form');
    expect((screen.getByLabelText('Form name') as HTMLInputElement).value).toBe('Unsaved title');
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByRole('menuitem', { name: 'Unpublish' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard changes' }));
    fireEvent.click(screen.getByLabelText('Back to Forms'));
    fireEvent.click(screen.getByLabelText('More actions'));
    expect((screen.getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps a published builder published if the unpublish request fails', async () => {
    vi.mocked(service.unpublishForm).mockRejectedValue(new Error('Unpublish failed'));
    render(<FormBuilderPage form={{ ...form, status: 'published', publishedVersion: 1 }} onBack={() => {}} onFormUpdate={() => {}} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpublish' })); fireEvent.click(screen.getByRole('button', { name: 'Unpublish form' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Published')).toBeTruthy();
  });
  it('requires confirmation, cancels without deleting, and prevents duplicate requests until success', async () => {
    vi.mocked(service.getFormsByTenant).mockResolvedValue([form]);
    let resolve!: () => void;
    vi.mocked(service.deleteForm).mockReturnValue(new Promise(done => { resolve = done; }));
    render(<FormsPage />); await screen.findByText('Contact Us');
    const open = () => { fireEvent.click(screen.getByLabelText('More actions')); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })); };
    open(); expect(service.deleteForm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(service.deleteForm).not.toHaveBeenCalled();
    open(); const button = screen.getByRole('button', { name: 'Delete Form' });
    fireEvent.click(button); fireEvent.click(button);
    expect(service.deleteForm).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Contact Us')).toBeTruthy();
    resolve(); await screen.findByText('No forms yet');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('keeps the form and confirmation available after a server deletion failure', async () => {
    vi.mocked(service.getFormsByTenant).mockResolvedValue([form]);
    vi.mocked(service.deleteForm).mockRejectedValue(new Error('Published forms must be unpublished before they can be deleted.'));
    render(<FormsPage />); await screen.findByText('Contact Us');
    fireEvent.click(screen.getByLabelText('More actions')); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Form' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete Form' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('Contact Us')).toBeTruthy(); expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
  it('opens mobile tools, adds fields, closes with Escape and keeps edits', async () => {
    const originalOverflow = document.body.style.overflow;
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    const trigger = screen.getByText('Add fields or change design'); trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog'); expect(dialog.getAttribute('aria-label')).toBe('Form tools');
    expect(within(dialog).getByText('STANDARD FIELDS')).toBeTruthy(); expect(within(dialog).getByText('CUSTOM FIELDS')).toBeTruthy();
    expect(within(dialog).queryByText('Single Line')).toBeNull(); expect(within(dialog).queryByText('Number')).toBeNull();
    expect(dialog.querySelector('.lucide-grip-vertical')).toBeNull();
    const separator = within(dialog).getByRole('button', { name: /Separator line/ });
    expect(separator.getAttribute('title')).toBe('Add Separator line');
    expect(separator.getAttribute('aria-roledescription')).toBeNull();
    fireEvent.click(separator);
    fireEvent.click(within(dialog).getByText('Age')); fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByLabelText('Drag Separator line')).toBeTruthy();
    expect(screen.getByLabelText('Drag Age')).toBeTruthy(); expect(screen.queryByLabelText(/Move .* up/)).toBeNull(); expect(screen.getByText('Unsaved changes')).toBeTruthy(); expect(service.updateForm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(document.activeElement).toBe(trigger);
  });
  it('persists added canonical fields before publishing and passes the saved revision', async () => {
    vi.mocked(service.updateForm).mockImplementation(async (_id, dto) => ({ ...form, ...dto, revision: 1 }));
    vi.mocked(service.publishForm).mockResolvedValue({ ...form, revision: 1, publishedRevision: 1, publishedVersion: 1, status: 'published' });
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    fireEvent.click(screen.getByText('Add fields or change design'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Age'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Separator line'));
    fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.click(screen.getByText('Publish')); if (screen.queryByRole('button', { name: 'Publish form' })) fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
    await waitFor(() => expect(service.publishForm).toHaveBeenCalledWith('form'));
    expect(vi.mocked(service.updateForm).mock.calls[0][1].fields?.at(-2)).toMatchObject({ label: 'Age', type: 'number', customFieldId: 'age' });
    expect(vi.mocked(service.updateForm).mock.calls[0][1].fields?.at(-1)).toMatchObject({ label: 'Separator line', type: 'divider' });
    expect(service.updateForm).toHaveBeenCalledWith('form', expect.objectContaining({ revision: 0 }));
    expect(vi.mocked(service.updateForm).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(service.publishForm).mock.invocationCallOrder[0]);
  });
  it('keeps failed edits and prevents publishing after a failed save', async () => {
    vi.mocked(service.updateForm).mockRejectedValue(new Error('Save failed'));
    render(<FormBuilderPage form={form} onBack={() => {}} onFormUpdate={() => {}} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'New name' } }); fireEvent.click(screen.getByText('Publish')); if (screen.queryByRole('button', { name: 'Publish form' })) fireEvent.click(screen.getByRole('button', { name: 'Publish form' }));
    await screen.findByText('Save failed'); expect(service.publishForm).not.toHaveBeenCalled(); expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });
  it('shows one error per public field, limits phone digits, submits and thanks the visitor', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...defaultContactForm(), fields: [...withProductOptions(defaultContactForm().fields, products), { id: 'separator', type: 'divider', label: 'Separator line' }], version: 1, trackUrlParams: true } }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchMock); render(<PublicFormPage publicId="public" />); await screen.findByText('Contact Us');
    expect(screen.getByRole('separator')).toBeTruthy();
    fireEvent.click(screen.getByText('Submit')); expect(screen.getAllByText('First Name is required.')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Anne' } }); fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: "O'Connor" } });
    fireEvent.change(screen.getByLabelText(/Email Address/), { target: { value: 'anne@example.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Product Interest' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Smart Lock' }));
    const phone = screen.getByLabelText('Contact Number') as HTMLInputElement; fireEvent.change(phone, { target: { value: '9123456789123' } }); expect(phone.value).toBe('9123456789');
    fireEvent.click(screen.getByText('Submit')); await screen.findByText('Thank you!'); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).values).not.toHaveProperty('separator');
  });
});

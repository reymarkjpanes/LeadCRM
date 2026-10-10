import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// Apply the final tab visibility immediately; animation timing is covered in browser checks.
vi.mock('motion/react', async importOriginal => {
  const actual = await importOriginal<typeof import('motion/react')>();
  const { forwardRef, createElement } = await import('react');
  const StaticDiv = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {
    initial?: unknown; animate?: { display?: string }; exit?: unknown;
    transition?: unknown; variants?: unknown;
  }>(({ initial, animate, exit, transition, variants, style, ...props }, ref) =>
    createElement('div', { ...props, ref, style: { ...style, ...(animate?.display ? { display: animate.display } : {}) } }));
  return { ...actual, motion: new Proxy(actual.motion, {
    get: (target, property) => property === 'div' ? StaticDiv : Reflect.get(target, property),
  }), useReducedMotion: () => true };
});
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), permissions: ['*'], push: vi.fn(), move: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get, put: mocks.put } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'user', tenantId: 'tenant', role: 'Client Admin', } }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ contacts: [], organizations: [], activities: [], users: [], deals: [], moveDealStage: mocks.move, pipelines: [{ id: 'sales', stages: [{ id: 'lead', name: 'Lead' }, { id: 'won', name: 'Won', isWon: true }, { id: 'lost', name: 'Lost', isLost: true }] }] }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (permission: string) => mocks.permissions.includes('*') || mocks.permissions.includes(permission) }));
vi.mock('@/features/tenant/operations/tasks/ui/related-tasks', () => ({ RelatedTasks: ({ links }: { links: object }) => <div data-testid="related-tasks">{JSON.stringify(links)}</div> }));
vi.mock('@/features/tenant/crm/leads/ui/lead-form', () => ({ LeadFormSheet: () => null }));
vi.mock('@/features/tenant/crm/contacts/ui/contact-form', () => ({ ContactFormSheet: ({ onSave, statusOptions }: { onSave: (value: object) => void; statusOptions: string[] }) => <button onClick={() => onSave({ firstName: 'Nora', lastName: 'Lim', companyName: 'Updated Company', leadSource: 'Referral', productInterest: ['CCTV'], status: 'Warm' })}>Save contact {statusOptions.join(',')}</button> }));
vi.mock('@/features/tenant/crm/accounts/ui/account-form', () => ({ AccountFormSheet: () => null }));
vi.mock('@/features/tenant/crm/leads/ui/convert-lead-dialog', () => ({ ConvertLeadDialog: () => null }));
import { CrmRecordPanel, CrmRecordView, type CrmRecordModule } from '../crm-record-view';
import { clearPageCache } from '@/shared/cache/page-cache';
import { toast } from 'sonner';

const records = {
  deals: { id: 'one', title: 'Lina Reyes – Smart Lock', pipelineId: 'sales', stageId: 'lead', stage: { name: 'Lead' }, pipeline: { name: 'Sales Pipeline' }, value: 1250.75, priority: 'MEDIUM', productInterests: ['Smart Lock'], assignedUser: { firstName: 'Sam', lastName: 'Cruz' }, leadDeals: [{ lead: { id: 'lead-one', firstName: 'Lina', lastName: 'Reyes', email: 'lina@example.test' } }], contactDeals: [] },
  leads: { id: 'one', firstName: 'Lina', lastName: 'Reyes', email: 'lina@example.test', source: 'Referral', status: 'Warm', productInterest: ['CCTV'], assignedUser: { firstName: 'Sam', lastName: 'Cruz' } },
  contacts: { id: 'one', firstName: 'Nora', lastName: 'Lim', status: 'WARM', company: 'North Company' },
  accounts: { id: 'one', name: 'North Company', industry: 'Services', website: 'example.test' },
};

it.each(['Electric Fence', 'Laptop/Server/Data Cabinets'])('prefills Deal email from the Contact and canonical Product %s', async product => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/deals/one' ? { data: { ...records.deals,
    productInterestId: 'product', productInterestRecord: { id: 'product', name: product }, productInterests: ['Outdated legacy label'], title: 'Unrelated title',
    contactDeals: [{ contact: { id: 'contact', firstName: 'Contact', lastName: 'Customer', email: 'contact+sales@example.test' } }],
  } } : original(path));
  render(<CrmRecordPanel module="deals" id="one" open onOpenChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose email to contact+sales@example.test' }));
  const href = new URL(mocks.push.mock.calls[0][0], 'https://example.test');
  expect(href.pathname).toBe('/inbox'); expect(href.searchParams.get('to')).toBe('contact+sales@example.test');
  expect(href.searchParams.get('subject')).toBe(`${product} Inquiry`);
  expect(mocks.put).not.toHaveBeenCalled();
});

it('uses the Lead only when no Contact exists, with a safe missing-Product subject', async () => {
  render(<CrmRecordPanel module="deals" id="one" open onOpenChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose email to lina@example.test' }));
  const href = new URL(mocks.push.mock.calls[0][0], 'https://example.test');
  expect(href.searchParams.get('to')).toBe('lina@example.test'); expect(href.searchParams.get('subject')).toBe('Product Inquiry');
});

it.each(['', 'broken'])('disables an unusable canonical Contact email (%s) without falling back to the Lead or staff', async email => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/deals/one' ? { data: { ...records.deals, contactDeals: [{ contact: { id: 'contact', email } }] } } : original(path));
  render(<CrmRecordPanel module="deals" id="one" open onOpenChange={() => {}} />);
  const button = await screen.findByRole('button', { name: email ? `Compose email to ${email}` : 'No email address is available for this Deal.' });
  expect((button as HTMLButtonElement).disabled).toBe(true); fireEvent.click(button); expect(mocks.push).not.toHaveBeenCalled();
});
beforeEach(() => {
  clearPageCache(); vi.clearAllMocks(); mocks.permissions = ['*'];
  mocks.get.mockImplementation(async (path: string) => {
    if (path.includes('/custom-fields')) return { data: { fields: [], values: {}, files: [] } };
    if (path.includes('/closing-requirements')) return { data: { fields: [], values: {}, errors: {}, files: [], locked: false } };
    if (path.includes('/relationships')) return { data: { account: null, contact: null, sourceLead: null, deals: [], contacts: [], activities: [] } };
    if (path.includes('/activities')) return { data: [] };
    if (path.includes('/files')) return { data: [] };
    const module = path.split('/')[2] as CrmRecordModule;
    return { data: records[module] };
  });
});

it.each((['leads', 'contacts', 'accounts'] as const).flatMap(module =>
  (module === 'accounts' ? ['Account name'] : ['First name', 'Last name']).flatMap(label =>
    ['panel', 'page'].map(surface => ({ module, label, surface }))))
)('requires and trims $module $label in the $surface', async ({ module, label, surface }) => {
  mocks.put.mockResolvedValue({ success: true });
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.getByText(label).textContent).toContain('*');
  fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));
  const input = screen.getByRole('textbox', { name: label });
  expect(input.getAttribute('aria-required')).toBe('true');
  expect(input.getAttribute('maxlength')).toBe(module === 'accounts' ? '255' : '100');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
  expect(await screen.findByText(`${label} is required`)).toBeTruthy();
  expect(mocks.put).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '  Trimmed  ' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(`/crm/${module}/one`, { [module === 'accounts' ? 'name' : label === 'First name' ? 'firstName' : 'lastName']: 'Trimmed' }));
});

afterEach(cleanup);

it.each((['leads', 'contacts', 'accounts', 'deals'] as const).flatMap(module => ['panel', 'page'].map(surface => ({ module, surface }))))('uses the assigned record agent on $module $surface', async ({ module, surface }) => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one`
    ? { data: { ...records[module], assignedUser: { firstName: 'Actual', lastName: 'Agent' }, owner: { firstName: 'Other', lastName: 'Owner' } } }
    : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  await screen.findByText('Agent: Actual Agent');
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.getByText('Assigned Agent')).toBeTruthy();
  expect(screen.queryByText(/Owner \/ Representative|Assigned user|Rep:/)).toBeNull();
});

it.each(['leads', 'contacts'] as const)('%s drawer navigates to existing Inbox and copies exact phone/address with feedback', async module => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/' + module + '/one'
    ? { data: { ...records[module], email: 'Lina+sales@Example.test', phone: '+63 935 454 1321', address: '139-E 15th Avenue', city: 'Quezon City' } }
    : original(path));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const success = vi.spyOn(toast, 'success');
  const error = vi.spyOn(toast, 'error');
  render(<CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose email to Lina+sales@Example.test' }));
  expect(mocks.push).toHaveBeenCalledWith('/inbox?compose=record-email&to=Lina%2Bsales%40Example.test');
  mocks.push.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Copy phone number +63 935 454 1321' }));
  await waitFor(() => expect(success).toHaveBeenCalledWith('Phone number copied'));
  expect(writeText).toHaveBeenLastCalledWith('+63 935 454 1321');
  fireEvent.click(screen.getByRole('button', { name: 'Copy address 139-E 15th Avenue, Quezon City' }));
  await waitFor(() => expect(success).toHaveBeenCalledWith('Address copied'));
  expect(writeText).toHaveBeenLastCalledWith('139-E 15th Avenue, Quezon City');
  writeText.mockRejectedValueOnce(new Error('Permission denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy phone number +63 935 454 1321' }));
  await waitFor(() => expect(error).toHaveBeenCalledWith('Unable to copy phone number'));
  expect(mocks.push).not.toHaveBeenCalled();
});

it('disables invalid Lead email and omits missing phone/address actions', async () => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/leads/one' ? { data: { ...records.leads, email: 'invalid' } } : original(path));
  render(<CrmRecordPanel module="leads" id="one" open onOpenChange={() => {}} />);
  const email = await screen.findByRole('button', { name: 'Compose email to invalid' });
  expect((email as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(email);
  expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^Copy (phone|address)/ })).toBeNull();
});

it.each(['accounts', 'deals'] as const)('keeps phone and address chip behavior for %s', async module => {
  render(<CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} />);
  await screen.findByRole('heading', { level: 1 });
  expect(screen.queryByRole('button', { name: /^(Copy phone number|Copy address)/ })).toBeNull();
  if (module === 'accounts') expect(screen.queryByRole('button', { name: /^Compose email to/ })).toBeNull();
});

it.each(['leads', 'contacts', 'accounts', 'deals'] as const)('%s uses the same identity and three tabs on both surfaces', async module => {
  const title = module === 'deals' ? records.deals.title : module === 'accounts' ? records.accounts.name : module === 'leads' ? 'Lina Reyes' : 'Nora Lim';
  const panel = render(<CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} />);
  await screen.findByRole('heading', { name: title });
  expect(screen.getByRole('link', { name: /Open full page/ }).getAttribute('href')).toBe(`/crm/${module}/one?from=${module}`);
  const header = screen.getByRole('heading', { name: title }).closest('header')!;
  const headerButtons = Array.from(header.querySelectorAll('button')).map(button => button.getAttribute('aria-label') || button.textContent?.trim());
  expect(headerButtons.filter(label => label === 'Record actions')).toHaveLength(1);
  if (module !== 'accounts') expect(headerButtons.indexOf('Record actions')).toBeLessThan(headerButtons.indexOf(module === 'leads' || module === 'contacts' ? 'Warm' : 'Lead'));
  expect(screen.getAllByRole('tab').map(el => el.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Activity'), expect.stringContaining('Details'), 'Files']));
  fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
  if (module !== 'deals') {
    expect(screen.getAllByRole('button', { name: 'Tasks' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('related-tasks').textContent).toContain(module === 'leads' ? 'leadId' : module === 'contacts' ? 'contactId' : 'accountId');
  }
  expect(screen.getAllByTestId('related-tasks')).toHaveLength(1);
  expect(screen.getByTestId('related-tasks').closest('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('tab-activity');
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByRole('button', { name: module === 'deals' ? /^Associations/ : /^Deals/ });
  expect(screen.getAllByTestId('related-tasks')).toHaveLength(1);
  expect(screen.getByTestId('related-tasks').textContent).toContain(module === 'deals' ? 'dealId' : module === 'leads' ? 'leadId' : module === 'contacts' ? 'contactId' : 'accountId');
  expect(screen.getByTestId('related-tasks').closest('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('tab-activity');
  expect(screen.queryByText('Security, Cabling, CCTV')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
  if (module !== 'deals') {
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
    await screen.findByText('No files uploaded yet.');
  } else await screen.findByText('No files uploaded yet.');
  panel.unmount();
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { name: title });
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain(title);
  expect(screen.queryByRole('link', { name: /Open full page/ })).toBeNull();
  mocks.push.mockClear();
  fireEvent.click(screen.getByRole('button', { name: `Back to ${module[0].toUpperCase()}${module.slice(1)}` }));
  expect(mocks.push).toHaveBeenCalledWith(`/crm/${module}`);
});

it('does not refetch relationships when switching tabs and retains collapsible sections', async () => {
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByText('Lina Reyes', { selector: 'h1' });
  expect(mocks.get.mock.calls.filter(([path]) => path.includes('/relationships'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByRole('button', { name: /Converted contact/ });
  const about = screen.getByRole('button', { name: 'About' });
  fireEvent.click(about);
  expect(about.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await waitFor(() => expect(mocks.get.mock.calls.filter(([path]) => path.includes('/relationships'))).toHaveLength(1));
});

it('reuses contact relationship history instead of requesting it twice', async () => {
  render(<CrmRecordView module="contacts" id="one" />);
  await screen.findByText('No activity recorded for this record.');
  await waitFor(() => expect(mocks.get.mock.calls.filter(([path]) => path.includes('/relationships'))).toHaveLength(1));
});

it('hides mutation controls without permissions', async () => {
  mocks.permissions = ['contacts.view'];
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  expect(screen.queryByRole('button', { name: 'Record actions' })).toBeNull();
  expect(screen.getAllByText('Warm', { selector: 'span' }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Warm' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.queryByRole('button', { name: /Edit (First name|Email|Account name)/ })).toBeNull();
});

it('shows related request failures instead of empty relationship counts', async () => {
  const implementation = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation((path: string) => path.includes('/relationships') ? Promise.reject(new Error('Relationships unavailable')) : implementation(path));
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByText('Relationships unavailable');
  expect(screen.queryByRole('button', { name: /^Deals/ })).toBeNull();
});

it('clears the previous identity while a new record loads', async () => {
  const view = render(<CrmRecordPanel module="leads" id="one" open onOpenChange={() => {}} />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  mocks.get.mockImplementation(() => new Promise(() => {}));
  view.rerender(<CrmRecordPanel module="leads" id="two" open onOpenChange={() => {}} />);
  expect(screen.queryByRole('heading', { name: 'Lina Reyes' })).toBeNull();
  expect(screen.getByRole('status', { name: 'Loading lead' })).toBeTruthy();
});

it('shows record access errors with a retry action', async () => {
  mocks.get.mockRejectedValue(Object.assign(new Error('Access denied'), { status: 403 }));
  render(<CrmRecordView module="accounts" id="one" />);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('Access denied');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'North Company' })).toBeNull();
});

it('supports arrow-key tab navigation', async () => {
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  const activity = screen.getByRole('tab', { name: /Activity/ });
  activity.focus(); fireEvent.keyDown(activity, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('tab', { name: /Details/ }).getAttribute('aria-selected')).toBe('true'));
});

it('edits Contact details inline using canonical API fields', async () => {
  mocks.put.mockResolvedValue({ success: true });
  render(<CrmRecordView module="contacts" id="one" />);
  await screen.findByRole('heading', { name: 'Nora Lim' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Company' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Company' }), { target: { value: 'Updated Company' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/crm/contacts/one', { company: 'Updated Company' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('cancels inline Lead edits without submitting or changing the loaded value', async () => {
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Email' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'changed@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Edit Email' }).textContent).toContain('lina@example.test');
  expect(mocks.put).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});


it('Deal stage changes use the governed API without supplying a new owner', async () => {
  mocks.move.mockResolvedValue(undefined);
  render(<CrmRecordView module="deals" id="one" />);
  await screen.findByRole('heading', { name: records.deals.title });
  fireEvent.click(screen.getAllByRole('button', { name: 'Lead' })[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Won' }));
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith('one', 'won', undefined, undefined));
});

it('requires a lost reason before submitting the Deal transition', async () => {
  render(<CrmRecordView module="deals" id="one" />);
  await screen.findByRole('heading', { name: records.deals.title });
  fireEvent.click(screen.getAllByRole('button', { name: 'Lead' })[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Lost' }));
  expect(mocks.move).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Lost reason'), { target: { value: 'Project postponed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith('one', 'lost', undefined, 'Project postponed'));
});


it.each(['leads', 'contacts'] as const)('%s header and inline status editors send canonical values', async module => {
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { name: module === 'leads' ? 'Lina Reyes' : 'Nora Lim' });
  for (const status of ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled']) {
    fireEvent.click(screen.getByRole('button', { name: 'Warm' }));
    fireEvent.click(screen.getByRole('menuitem', { name: status }));
    await waitFor(() => expect(mocks.put).toHaveBeenLastCalledWith(`/crm/${module}/one`, { status }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Warm' }) as HTMLButtonElement).disabled).toBe(false));
  }
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  for (const status of ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled']) {
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Status' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: status } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.put).toHaveBeenLastCalledWith(`/crm/${module}/one`, { status }));
    await screen.findByRole('button', { name: 'Edit Status' });
  }
}, 15000);

it('Deal menu enters Details and saves or cancels inline without opening another drawer', async () => {
  const onEdit = vi.fn(); mocks.put.mockResolvedValue({ success: true });
  render(<CrmRecordView module="deals" id="one" onEdit={onEdit} />);
  await screen.findByRole('heading', { name: records.deals.title });
  fireEvent.click(screen.getByRole('button', { name: 'Record actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit deal' }));
  expect(screen.getByRole('tab', { name: /Details/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Deal title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Deal title' }), { target: { value: 'Cancelled' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Deal title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Deal title' }), { target: { value: 'Saved title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/crm/deals/one', { title: 'Saved title' }));
  expect(onEdit).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['leads', 'contacts'] as const)('%s inline email rejects blanks and trims valid saves', async module => {
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { name: module === 'leads' ? 'Lina Reyes' : 'Nora Lim' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Email' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Email is required')).toBeTruthy(); expect(mocks.put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: '  valid@example.test  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(`/crm/${module}/one`, { email: 'valid@example.test' }));
});

it('Deal header uses Messages between actions and status and the shared Activity filters', async () => {
  render(<CrmRecordView module="deals" id="one" onClose={() => {}} />);
  await screen.findByRole('heading', { name: records.deals.title });
  const buttons = Array.from(screen.getByRole('heading', { name: records.deals.title }).closest('header')!.querySelectorAll('button'));
  const names = buttons.map(b => b.getAttribute('aria-label') || b.textContent);
  expect(names.indexOf('Record actions')).toBeLessThan(names.indexOf('Open messages'));
  expect(names.indexOf('Open messages')).toBeLessThan(names.indexOf('Lead'));
  expect(names.indexOf('Lead')).toBeLessThan(names.indexOf('Close record'));
  fireEvent.click(screen.getByRole('button', { name: 'Open messages' })); expect(mocks.push).toHaveBeenCalledWith('/inbox');
  expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Calls & Emails' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Emails' })).toBeTruthy();
});

it('removes retired Lead Website and Notes editors while keeping Contact Notes and Account Website', async () => {
  const lead = render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.queryByRole('button', { name: 'Edit Website' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit Notes' })).toBeNull();
  lead.unmount();
  const contact = render(<CrmRecordView module="contacts" id="one" />);
  await screen.findByRole('heading', { name: 'Nora Lim' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.getByRole('button', { name: 'Edit Notes' })).toBeTruthy();
  contact.unmount();
  render(<CrmRecordView module="accounts" id="one" />);
  await screen.findByRole('heading', { name: 'North Company' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.getByRole('button', { name: 'Edit Website' })).toBeTruthy();
});

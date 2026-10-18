vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => mocks.canMutate, canReassign: true, policy: { userId: 'actor', tenantId: 'tenant', assignmentRestricted: false, clientAdmin: mocks.role === 'Client Admin' } }) }));
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), permissions: ['*'], push: vi.fn(), move: vi.fn(), userId: 'user', role: 'Client Admin', authenticated: true, canMutate: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get, put: mocks.put, post: mocks.post } }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: mocks.authenticated ? { id: mocks.userId, tenantId: 'tenant', role: mocks.role } : undefined }) }));
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
import { DEFAULT_CLOSING_FIELDS, defaultFieldLayout, getCrmFieldCatalog, type CustomFieldState } from '@leadcrm/shared';
vi.mock('../inline-deal-form', () => ({ InlineDealForm: ({ onSubmit, onCancel }: { onSubmit: (values: object) => Promise<void>; onCancel: () => void }) => <form aria-label="New related Deal" onSubmit={event => { event.preventDefault(); void onSubmit({ title: 'Created deal', productInterestIds: ['product'], pipelineId: 'sales', stageId: 'lead', priority: 'MEDIUM', expectedCloseDate: '2026-10-20', customFieldValues: { evidence: 'Kept' } }); }}><button>Create Deal</button><button type="button" onClick={onCancel}>Cancel Deal</button></form> }));
import { recordEmailComposeHref } from '@/features/tenant/inbox/services/compose-navigation';

const records = {
  deals: { id: 'one', title: 'Lina Reyes – Smart Lock', pipelineId: 'sales', stageId: 'lead', stage: { name: 'Lead' }, pipeline: { name: 'Sales Pipeline' }, value: 1250.75, priority: 'MEDIUM', productInterests: ['Smart Lock'], assignedUserId: 'user', assignedUser: { firstName: 'Sam', lastName: 'Cruz' }, leadDeals: [{ lead: { id: 'lead-one', firstName: 'Lina', lastName: 'Reyes', email: 'lina@example.test' } }], contactDeals: [] },
  leads: { id: 'one', firstName: 'Lina', lastName: 'Reyes', email: 'lina@example.test', source: 'Referral', status: 'Warm', productInterest: ['CCTV'], assignedUserId: 'user', assignedUser: { firstName: 'Sam', lastName: 'Cruz' } },
  contacts: { id: 'one', firstName: 'Nora', lastName: 'Lim', status: 'WARM', companyName: 'North Company', assignedUserId: 'user' },
  accounts: { id: 'one', name: 'North Company', industry: 'Services', website: 'example.test' },
};

const personSurfaces = (['leads', 'contacts'] as const).flatMap(module => ['panel', 'page'].map(surface => ({ module, surface })));

it.each(personSurfaces.flatMap(entry => ['Client Admin', 'Sales Agent'].map(role => ({ ...entry, role }))))('opens the owned $module recipient from both $surface actions as $role', async ({ module, surface, role }) => {
  mocks.role = role;
  const original = mocks.get.getMockImplementation()!;
  const email = `${module}+sales@Example.test`;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], email, assignedUser: { email: 'agent@example.test' }, account: { email: 'account@example.test' } } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  for (const name of [`Compose email to ${email}`, 'Open messages']) {
    mocks.push.mockClear();
    fireEvent.click(await screen.findByRole('button', { name }));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(recordEmailComposeHref(email));
    expect(toast.error).not.toHaveBeenCalled();
  }
  const url = new URL(mocks.push.mock.calls[0][0], 'https://example.test');
  expect(url.searchParams.get('to')).toBe(email);
  expect(url.searchParams.has('subject')).toBe(false);
  expect(url.searchParams.has('body')).toBe(false);
  expect(mocks.put).not.toHaveBeenCalled();
});
it.each(personSurfaces.flatMap(entry => ['', 'broken', null, undefined].map(email => ({ ...entry, email }))))('disables owned $module $surface email actions for unusable email $email', async ({ module, surface, email }) => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], email, assignedUser: { email: 'agent@example.test' } } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  const button = await screen.findByRole('button', { name: 'Open messages' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(button.title).toBe('No valid email address available.');
  expect(button.parentElement?.tabIndex).toBe(0);
  fireEvent.click(button);
  if (email) {
    const chip = screen.getByRole('button', { name: `Compose email to ${email}` }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
  } else expect(screen.queryByRole('button', { name: /^Compose email to/ })).toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each(personSurfaces.flatMap(entry => ['Client Admin', 'Sales Agent'].flatMap(role =>
  ['other-user', null, '', undefined].map(assignedUserId => ({ ...entry, role, assignedUserId })))))('blocks both $module $surface actions for $role with assignment $assignedUserId', async ({ module, surface, role, assignedUserId }) => {
  mocks.role = role;
  const original = mocks.get.getMockImplementation()!;
  const email = `${module}@example.test`;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], email, assignedUserId,
    assignedUser: { id: 'user', email: 'agent@example.test' } } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  for (const name of [`Compose email to ${email}`, 'Open messages']) {
    vi.mocked(toast.error).mockClear();
    const button = await screen.findByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(`You cannot email this ${module === 'leads' ? 'lead' : 'contact'} because it is not assigned to you.`);
    expect(mocks.push).not.toHaveBeenCalled();
  }
  expect(mocks.put).not.toHaveBeenCalled();
});

it.each(personSurfaces.flatMap(entry => ['', 'broken', null, undefined].map(email => ({ ...entry, email }))))('prioritizes assignment feedback for $module $surface with unusable email $email', async ({ module, surface, email }) => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], email, assignedUserId: null } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  const inbox = await screen.findByRole('button', { name: 'Open messages' }) as HTMLButtonElement;
  expect(inbox.disabled).toBe(false);
  expect(inbox.title).toBe('Open messages');
  expect(inbox.parentElement?.tabIndex).toBe(-1);
  for (const button of [inbox, ...(email ? [screen.getByRole('button', { name: `Compose email to ${email}` })] : [])]) {
    vi.mocked(toast.error).mockClear();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(`You cannot email this ${module === 'leads' ? 'lead' : 'contact'} because it is not assigned to you.`);
    expect(mocks.push).not.toHaveBeenCalled();
  }
  if (!email) expect(screen.queryByRole('button', { name: /^Compose email to/ })).toBeNull();
});

it.each(personSurfaces.flatMap(entry => ['missing user', 'empty user ID'].map(auth => ({ ...entry, auth }))))('does not expose $module $surface email actions with $auth', async ({ module, surface, auth }) => {
  mocks.authenticated = auth !== 'missing user';
  mocks.userId = '';
  const original = mocks.get.getMockImplementation()!;
  const email = `${module}@example.test`;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], email, assignedUserId: auth === 'missing user' ? undefined : '' } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: `Compose email to ${email}` })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open messages' })).toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it.each(personSurfaces)('does not require general mutation access to email an owned $module from the $surface', async ({ module, surface }) => {
  mocks.canMutate = false;
  const original = mocks.get.getMockImplementation()!;
  const email = `${module}@example.test`;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], email } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  for (const name of [`Compose email to ${email}`, 'Open messages']) {
    mocks.push.mockClear();
    fireEvent.click(await screen.findByRole('button', { name }));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(recordEmailComposeHref(email));
    expect(toast.error).not.toHaveBeenCalled();
  }
});


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

const dealEmailCases = (['panel', 'page'] as const).flatMap(surface =>
  (['chip', 'inbox'] as const).map(action => ({ surface, action })));
const dealEmailRoleCases = dealEmailCases.flatMap(testCase =>
  ['Sales Representative', 'Client Admin'].map(role => ({ ...testCase, role })));

async function renderDealEmailAction({ surface, action }: typeof dealEmailCases[number], record: Record<string, unknown> = records.deals, email = 'lina@example.test') {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/deals/one' ? { data: record } : original(path));
  const error = vi.spyOn(toast, 'error');
  const onOpenChange = vi.fn();
  render(surface === 'panel' ? <CrmRecordPanel module="deals" id="one" open onOpenChange={onOpenChange} /> : <CrmRecordView module="deals" id="one" />);
  const button = await screen.findByRole('button', { name: action === 'inbox' ? 'Open messages' : email ? `Compose email to ${email}` : 'No email address is available for this Deal.' });
  return { button, error, onOpenChange };
}

it.each(dealEmailRoleCases)('opens the assigned Deal from the $surface $action for $role without edit permission', async testCase => {
  mocks.role = testCase.role;
  mocks.permissions = ['deals.view'];
  const { button, error, onOpenChange } = await renderDealEmailAction(testCase);
  fireEvent.click(button);
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith(recordEmailComposeHref('lina@example.test', 'Product Inquiry'));
  expect(error).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(mocks.put).not.toHaveBeenCalled();
});

it.each(dealEmailRoleCases.flatMap(testCase => ['other-user', null, undefined].flatMap(assignedUserId =>
  ['customer@example.test', '', 'broken'].map(email => ({ ...testCase, assignedUserId, email }))))
)('blocks the Deal $surface $action for $role with assignment $assignedUserId and email $email', async testCase => {
  mocks.role = testCase.role;
  const { button, error, onOpenChange } = await renderDealEmailAction(testCase, {
    ...records.deals, assignedUserId: testCase.assignedUserId,
    contactDeals: [{ contact: { id: 'contact', email: testCase.email, assignedUserId: 'user' } }],
  }, testCase.email);
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  expect(error).toHaveBeenCalledExactlyOnceWith('You cannot email this deal because it is not assigned to you.');
  expect(mocks.push).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: records.deals.title })).toBeTruthy();
});

it.each(dealEmailCases.flatMap(testCase => ['', 'broken'].map(email => ({ ...testCase, email }))))('reports unusable Contact email $email from the assigned Deal $surface $action without falling back to the Lead or staff', async testCase => {
  const { button, error, onOpenChange } = await renderDealEmailAction(testCase, {
    ...records.deals, assignedUser: { email: 'staff@example.test' },
    contactDeals: [{ contact: { id: 'contact', email: testCase.email } }],
  }, testCase.email);
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  expect(error).toHaveBeenCalledExactlyOnceWith('No valid email address available.');
  expect(mocks.push).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});

beforeEach(() => {
  clearPageCache(); vi.clearAllMocks(); mocks.permissions = ['*'];
  mocks.userId = 'user'; mocks.role = 'Client Admin'; mocks.authenticated = true; mocks.canMutate = true;
  vi.spyOn(toast, 'error').mockReturnValue(0);
  mocks.post.mockResolvedValue({ data: { id: 'created' } });
  mocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/field-layout')) {
      const module = path.split('/')[2] as CrmRecordModule;
      const layout = defaultFieldLayout(module);
      return { data: { layout, fields: getCrmFieldCatalog(module, [], layout) } };
    }
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
  (module === 'accounts' ? ['Account Name'] : ['First Name', 'Last Name']).flatMap(label =>
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
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(`/crm/${module}/one`, { [module === 'accounts' ? 'name' : label === 'First Name' ? 'firstName' : 'lastName']: 'Trimmed' }));
});

afterEach(cleanup);

function dealDetailsOnlyField(visibleInDetails = true) {
  const layout = defaultFieldLayout('deals');
  layout.groups.push({ id: 'cancellation-details', label: 'Cancellation Details', order: layout.groups.length });
  const data: CustomFieldState = {
    fields: [{ id: 'reason-id', name: 'Cancellation Reason', module: 'deals', group: 'Cancellation Details', groupId: 'cancellation-details', type: 'Long Text', active: true, required: false, visibleInForm: false, visibleInDetails, options: [], description: '', order: 0, version: 1 }],
    values: {}, files: [], layout,
  };
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/deals/one/custom-fields' ? { data } : path === '/crm/deals/field-layout' ? { data: { layout, fields: getCrmFieldCatalog('deals', data.fields, layout) } } : original(path));
  mocks.put.mockImplementation(async (_path: string, patch: { customFieldValues: Record<string, string> }) => {
    data.values = { ...data.values, ...patch.customFieldValues };
    return { success: true };
  });
  return data;
}

it.each(['panel', 'page'] as const)('edits a Deal field visible only in Details in the %s without reloading', async surface => {
  const data = dealDetailsOnlyField();
  mocks.permissions = ['deals.view', 'deals.edit'];
  render(surface === 'panel' ? <CrmRecordPanel module="deals" id="one" open onOpenChange={() => {}} /> : <CrmRecordView module="deals" id="one" />);
  await screen.findByRole('heading', { level: 1 });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  const row = await screen.findByText('Cancellation Reason');
  expect(row.textContent).toBe('Cancellation Reason');
  expect(screen.queryByText(/Hidden in forms/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Cancellation Reason' }));
  const input = screen.getByRole('textbox', { name: 'Cancellation Reason' });
  expect(input.tagName).toBe('TEXTAREA');
  const saved = 'Customer changed plans\nRequested cancellation';
  fireEvent.change(input, { target: { value: saved } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Cancellation Reason' })).toBeNull());
  expect(mocks.put).toHaveBeenCalledExactlyOnceWith('/crm/deals/one', { customFieldValues: { 'reason-id': saved } });
  expect(screen.getByRole('button', { name: 'Edit Cancellation Reason' }).textContent).toBe(saved);
  expect(data.values['reason-id']).toBe(saved);
  fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.getByRole('button', { name: 'Edit Cancellation Reason' }).textContent).toBe(saved);
});

it.each((['panel', 'page'] as const).flatMap(surface => ['permission', 'record access'].map(denied => ({ surface, denied }))))('keeps a Details-only Deal field read only in the $surface without $denied', async ({ surface, denied }) => {
  const data = dealDetailsOnlyField(); data.values['reason-id'] = 'Saved history';
  mocks.permissions = denied === 'permission' ? ['deals.view'] : ['deals.view', 'deals.edit'];
  mocks.canMutate = denied !== 'record access';
  render(surface === 'panel' ? <CrmRecordPanel module="deals" id="one" open onOpenChange={() => {}} /> : <CrmRecordView module="deals" id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByText('Cancellation Reason');
  const value = screen.getByText('Saved history').closest('button') as HTMLButtonElement;
  expect(value.disabled).toBe(true); fireEvent.click(value);
  expect(screen.queryByRole('textbox', { name: 'Cancellation Reason' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit Cancellation Reason' })).toBeNull();
  expect(mocks.put).not.toHaveBeenCalled();
});

it.each(['panel', 'page'] as const)('hides a Deal custom field from the %s when Show in Details is off', async surface => {
  const data = dealDetailsOnlyField(false); data.values['reason-id'] = 'Saved history';
  render(surface === 'panel' ? <CrmRecordPanel module="deals" id="one" open onOpenChange={() => {}} /> : <CrmRecordView module="deals" id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/crm/deals/one/custom-fields', expect.anything()));
  expect(screen.queryByText('Cancellation Reason')).toBeNull(); expect(screen.queryByText('Saved history')).toBeNull();
  expect(data.values['reason-id']).toBe('Saved history');
});

it.each((['leads', 'contacts', 'accounts', 'deals'] as const).flatMap(module => ['panel', 'page'].map(surface => ({ module, surface }))))('uses the assigned record agent on $module $surface', async ({ module, surface }) => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one`
    ? { data: { ...records[module], assignedUser: { firstName: 'Actual', lastName: 'Agent' }, owner: { firstName: 'Other', lastName: 'Owner' } } }
    : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 });
  if (module === 'accounts') expect(screen.queryByText('Agent: Actual Agent')).toBeNull();
  else await screen.findByText('Agent: Actual Agent');
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  if (module === 'accounts') expect(screen.queryByText('Assigned Agent', { selector: 'dt' })).toBeNull();
  else expect(screen.getByText('Assigned Agent', { selector: 'dt' })).toBeTruthy();
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

it('shows a consolidated Account address once and omits legacy scalar Notes from Details', async () => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/accounts/accounts-1'
    ? { data: { ...records.accounts, address: '42 Main Street, Manila, Philippines', city: 'Manila', country: 'Philippines', notes: 'Retained Account notes' } }
    : original(path));
  render(<CrmRecordView module="accounts" id="accounts-1" onClose={vi.fn()} />);
  await screen.findAllByText('42 Main Street, Manila, Philippines');
  expect(screen.queryByText('42 Main Street, Manila, Philippines, Manila, Philippines')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.queryByText('Retained Account notes')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit Notes' })).toBeNull();
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
  if (module === 'leads' || module === 'contacts') await screen.findByRole('heading', { name: /^Deals/ });
  else await screen.findByRole('button', { name: module === 'deals' ? /^Relationships/ : /^Deals/ });
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
  await screen.findByRole('heading', { name: /^Deals/ });
  expect(screen.queryByRole('button', { name: /Converted contact/ })).toBeNull();
  const about = screen.getByRole('button', { name: defaultFieldLayout('leads').groups[0].label });
  fireEvent.click(about);
  expect(about.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('tab', { name: /Activity/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await waitFor(() => expect(mocks.get.mock.calls.filter(([path]) => path.includes('/relationships'))).toHaveLength(1));
});

it('reads Contact Notes and Timeline separately without downloading relationship history for Activity', async () => {
  render(<CrmRecordView module="contacts" id="one" />);
  await screen.findByText('No activity recorded for this record.');
  await waitFor(() => expect(mocks.get.mock.calls.filter(([path]) => path.includes('/activities'))).toHaveLength(2));
  const paths = mocks.get.mock.calls.filter(([path]) => path.includes('/activities')).map(([path]) => path);
  expect(new Set(paths).size).toBe(2);
  expect(paths.every(path => path.includes('contactId=one'))).toBe(true);
  expect(paths.some(path => path.includes('type=note'))).toBe(true);
  expect(mocks.get.mock.calls.filter(([path]) => path.includes('/relationships'))).toHaveLength(0);
});

it('hides mutation controls without permissions', async () => {
  mocks.permissions = ['contacts.view'];
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  expect(screen.queryByRole('button', { name: 'Record actions' })).toBeNull();
  expect(screen.getAllByText('Warm', { selector: 'span' }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Warm' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  expect(screen.queryByRole('button', { name: /Edit (First Name|Email|Account Name)/ })).toBeNull();
});

it('shows related request failures instead of empty relationship counts', async () => {
  const implementation = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation((path: string) => path.includes('/relationships') ? Promise.reject(new Error('Relationships unavailable')) : implementation(path));
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { name: 'Lina Reyes' });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByText('Relationships unavailable');
  expect(screen.queryByRole('button', { name: /^Deals/ })).toBeNull();
  expect(screen.queryByRole('heading', { name: /^Deals/ })).toBeNull();
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
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/crm/contacts/one', { companyName: 'Updated Company' }));
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
}, 30000);

it('Deal menu enters Details and saves or cancels inline without opening another drawer', async () => {
  const onEdit = vi.fn(); mocks.put.mockResolvedValue({ success: true });
  render(<CrmRecordView module="deals" id="one" onEdit={onEdit} />);
  await screen.findByRole('heading', { name: records.deals.title });
  fireEvent.click(screen.getByRole('button', { name: 'Record actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit deal' }));
  expect(screen.getByRole('tab', { name: /Details/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Cancelled' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Saved title' } });
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
  fireEvent.click(screen.getByRole('button', { name: 'Open messages' })); expect(mocks.push).toHaveBeenCalledExactlyOnceWith(recordEmailComposeHref('lina@example.test', 'Product Inquiry'));
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


it.each((['leads', 'contacts'] as const).flatMap(module => ['panel', 'page'].map(surface => ({ module, surface }))))('shows one company inside Organization on $module $surface', async ({ module, surface }) => {
  const original = mocks.get.getMockImplementation()!;
  const account = { id: 'company', name: 'Canonical company', industry: 'Technology', size: '11-50', website: 'https://company.test' };
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], accountId: account.id, account, companyName: 'Old company' } }
    : path.includes('/relationships') ? { data: { account, deals: [] } } : original(path));
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  const organization = await screen.findByRole('button', { name: 'Organization' });
  await waitFor(() => expect(organization.closest('section')?.querySelectorAll('a[href="/crm/accounts/company"]')).toHaveLength(1));
  expect(organization.closest('section')?.textContent).toContain('Technology');
  expect(organization.closest('section')?.textContent?.match(/Technology/g)).toHaveLength(1);
  expect(organization.closest('section')?.textContent).toContain('11-50');
  expect(screen.queryByRole('button', { name: /Company \/ Organization|Account \/ Company/ })).toBeNull();
  expect(within(organization.closest('section')!).getByRole('button', { name: module === 'contacts' ? 'Edit Company' : 'Edit Company Name' }).textContent).toContain('Old company');
});
it('groups Deal participants and Account under Relationships exactly once', async () => {
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === '/crm/deals/one' ? { data: { ...records.deals, organization: { id: 'company', name: 'Linked company' }, contactDeals: [{ contact: { id: 'contact', firstName: 'Linked', lastName: 'Contact' } }] } } : original(path));
  render(<CrmRecordView module="deals" id="one" />); await screen.findByRole('heading', { level: 1 });
  fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  const group = (await screen.findByRole('button', { name: 'Relationships' })).closest('section')!;
  for (const path of ['/crm/leads/lead-one', '/crm/contacts/contact', '/crm/accounts/company']) expect(group.querySelectorAll(`a[href="${path}"]`)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Lead/Contact' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
});

function organizationFixture(module: 'leads' | 'contacts', legacy = false) {
  const original = mocks.get.getMockImplementation()!;
  const layout = defaultFieldLayout(module);
  if (legacy) {
    layout.groups.reverse().forEach((group, order) => { group.order = order; });
    layout.groups.find(group => group.id === `${module}:section:1`)!.label = 'Status & Classification';
    layout.groups.find(group => group.id === `${module}:section:2`)!.label = 'Relationships';
    layout.fields['companyName'] = { label: 'Company Name', groupId: `${module}:section:0`, order: 1, visibleInForm: true, visibleInDetails: true };
    layout.fields.assignedUserId = { label: 'Assigned Agent', groupId: `${module}:section:2`, order: 0, visibleInForm: true, visibleInDetails: true };
  }
  layout.groups.push({ id: 'custom-relationships', label: 'Relationships', order: 0 });
  const fields = [{ ...DEFAULT_CLOSING_FIELDS[0], id: 'custom-note', module, name: 'Custom relationship note', type: 'Text' as const, group: 'Relationships', groupId: 'custom-relationships', required: false }];
  const account = { id: 'account', name: 'Linked Account', industry: 'Technology', size: '11-50', website: 'https://account.test' };
  const relationships = {
    account, deals: [{ ...records.deals, id: 'linked-deal', title: 'Linked deal' }, { ...records.deals, id: 'archived-deal', title: 'Archived deal', isArchived: true }],
    sourceLead: { id: 'source-lead', firstName: 'Source', lastName: 'Lead', email: 'source@example.test' }, hasMoreDeals: false,
  };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === `/crm/${module}/one`) return { data: { ...records[module], companyName: 'Stored company', accountId: account.id, account } };
    if (path === `/crm/${module}/field-layout`) return { data: { layout, fields: getCrmFieldCatalog(module, fields, layout) } };
    if (path === `/crm/${module}/one/custom-fields`) return { data: { fields, values: { 'custom-note': 'Preserved value' }, files: [], layout } };
    if (path.includes(`/crm/${module}/one/relationships`)) return { data: relationships };
    if (path === '/crm/deals/linked-deal') return { data: { ...records.deals, id: 'linked-deal', title: 'Linked deal' } };
    return original(path);
  });
  return { layout, relationships, fields };
}

it.each((['leads', 'contacts'] as const).flatMap(module => ['panel', 'page'].map(surface => ({ module, surface }))))('uses canonical groups and flat Organization relationships on $module $surface', async ({ module, surface }) => {
  const fixture = organizationFixture(module, true);
  const saved = structuredClone(fixture.layout);
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="one" open onOpenChange={() => {}} /> : <CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByRole('link', { name: /Linked deal/ });
  const details = screen.getByRole('tabpanel', { name: /Details/ });
  expect(Array.from(details.querySelectorAll('section > div > button[aria-expanded]')).map(button => button.textContent?.trim())).toEqual([
    'Basic Information', 'Status & Interest', 'Organization', 'Additional Information', 'Assigned Agent', 'Relationships',
  ]);
  const organization = within(screen.getByRole('button', { name: 'Organization' }).closest('section')!);
  expect(organization.getByRole('button', { name: 'Edit Company Name' }).textContent).toContain('Stored company');
  expect(organization.getByRole('link', { name: 'Linked Account' }).getAttribute('href')).toBe('/crm/accounts/account');
  for (const value of ['Technology', '11-50', 'https://account.test']) expect(organization.getByText(value)).toBeTruthy();
  expect(organization.getByRole('heading', { name: 'Deals1' })).toBeTruthy();
  const dealLink = organization.getByRole('link', { name: /Linked deal/ });
  expect(dealLink.getAttribute('href')).toBe('/crm/deals/linked-deal');
  expect(within(dealLink).getByText('Lead')).toBeTruthy();
  expect(organization.queryByText('Archived deal')).toBeNull();
  expect(organization.getByRole('button', { name: 'Create deal' })).toBeTruthy();
  expect(organization.getByRole('button', { name: 'Actions for Linked deal' })).toBeTruthy();
  const headings = organization.getAllByRole('heading').map(heading => heading.textContent);
  expect(headings).toEqual(module === 'contacts' ? ['Account', 'Deals1', 'Related Leads1'] : ['Account', 'Deals1']);
  if (module === 'contacts') {
    expect(organization.getByRole('link', { name: /Source Lead/ }).getAttribute('href')).toBe('/crm/leads/source-lead');
    expect(organization.getByText('source@example.test')).toBeTruthy();
  }
  expect(details.querySelectorAll('section section')).toHaveLength(0);
  expect(within(details).queryByRole('button', { name: /^Deals|^Related [Ll]eads/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Status & Classification' })).toBeNull();
  expect(within(screen.getByRole('button', { name: 'Relationships' }).closest('section')!).getByText('Preserved value')).toBeTruthy();
  expect(fixture.layout).toEqual(saved);
});

it.each(['leads', 'contacts'] as const)('%s keeps Create deal association payloads, cancellation, menus and pagination inside Organization', async module => {
  const fixture = organizationFixture(module);
  fixture.relationships.hasMoreDeals = true;
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByRole('link', { name: /Linked deal/ });
  const organization = within(screen.getByRole('button', { name: 'Organization' }).closest('section')!);
  const badge = screen.getByRole('tab', { name: /Details/ }).textContent;
  fireEvent.click(organization.getByRole('button', { name: 'Create deal' }));
  expect(organization.getByRole('form', { name: 'New related Deal' })).toBeTruthy();
  fireEvent.click(organization.getByRole('button', { name: 'Cancel Deal' }));
  expect(organization.queryByRole('form')).toBeNull(); expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.click(organization.getByRole('button', { name: 'Create deal' }));
  fireEvent.click(organization.getByRole('button', { name: 'Create Deal' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/crm/deals', {
    title: 'Created deal', productInterestIds: ['product'], pipelineId: 'sales', stageId: 'lead', priority: 'MEDIUM',
    expectedCloseDate: '2026-10-20T00:00:00.000Z', customFieldValues: { evidence: 'Kept' }, [module === 'leads' ? 'leadIds' : 'contactIds']: ['one'],
  }));
  await waitFor(() => expect(organization.queryByRole('form')).toBeNull());
  fireEvent.click(organization.getByRole('button', { name: 'Actions for Linked deal' }));
  await screen.findByRole('menuitem', { name: 'Edit deal' });
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit deal' }), { key: 'Escape' });
  fireEvent.click(organization.getByRole('button', { name: 'Load older deals' }));
  await waitFor(() => expect(mocks.get.mock.calls.some(([path]) => path.includes('relationships?limit=50&page=2'))).toBe(true));
  expect(organization.getAllByRole('link', { name: /Linked deal/ })).toHaveLength(1);
  expect(screen.getByRole('tab', { name: /Details/ }).textContent).toBe(badge);
});

it.each((['leads', 'contacts'] as const).flatMap(module => ['accounts.view', 'deals.view', ...(module === 'contacts' ? ['leads.view'] : [])].map(denied => ({ module, denied }))))('$module Organization hides only the relationship denied by $denied', async ({ module, denied }) => {
  organizationFixture(module);
  mocks.permissions = ['contacts.view', 'accounts.view', 'deals.view', 'leads.view', 'deals.create'].filter(permission => permission !== denied);
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await waitFor(() => expect(mocks.get.mock.calls.some(([path]) => path.includes('/relationships'))).toBe(true));
  const organization = within(screen.getByRole('button', { name: 'Organization' }).closest('section')!);
  await waitFor(() => expect(Boolean(organization.queryByRole('link', { name: 'Linked Account' }))).toBe(denied !== 'accounts.view'));
  expect(Boolean(organization.queryByRole('link', { name: /Linked deal/ }))).toBe(denied !== 'deals.view');
  expect(Boolean(organization.queryByRole('link', { name: /Source Lead/ }))).toBe(module === 'contacts' && denied !== 'leads.view');
  expect(Boolean(organization.queryByRole('button', { name: 'Create deal' }))).toBe(denied !== 'deals.view');
  if (denied === 'accounts.view') for (const value of ['Technology', '11-50', 'https://account.test']) expect(organization.queryByText(value)).toBeNull();
});

it.each(['leads', 'contacts'] as const)('%s retains Deals when Account is hidden and hides only the Create action without creation permission', async module => {
  const fixture = organizationFixture(module);
  fixture.layout.fields.accountId = { label: 'Account', groupId: `${module}:section:2`, order: 0, visibleInForm: true, visibleInDetails: false };
  mocks.permissions = [`${module}.view`, 'accounts.view', 'deals.view', 'leads.view'];
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByRole('link', { name: /Linked deal/ });
  const organization = within(screen.getByRole('button', { name: 'Organization' }).closest('section')!);
  expect(organization.queryByRole('heading', { name: 'Account' })).toBeNull();
  expect(organization.queryByRole('link', { name: 'Linked Account' })).toBeNull();
  expect(organization.queryByRole('button', { name: 'Create deal' })).toBeNull();
  if (module === 'contacts') expect(organization.getByRole('link', { name: /Source Lead/ })).toBeTruthy();
});

it('shows an empty Deals block with zero visible records when only archived deals are supplied', async () => {
  const fixture = organizationFixture('leads');
  fixture.relationships.deals = fixture.relationships.deals.filter(deal => 'isArchived' in deal && deal.isArchived);
  render(<CrmRecordView module="leads" id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByText('No deals attached to this lead.');
  expect(screen.getByRole('heading', { name: 'Deals0' })).toBeTruthy();
  expect(screen.queryByText('Archived deal')).toBeNull();
});

it.each(['leads', 'contacts'] as const)('%s retains Account/Deal empty states and does not add relationship records to the Details badge', async module => {
  const fixture = organizationFixture(module);
  fixture.relationships.deals = [];
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByText(`No deals attached to this ${module === 'leads' ? 'lead' : 'contact'}.`);
  const expectedCount = getCrmFieldCatalog(module, fixture.fields).filter(field => field.technicalKey !== 'accountId').length + 1;
  expect(screen.getByRole('tab', { name: /Details/ }).textContent).toBe(`Details${expectedCount}`);
  expect(screen.getAllByRole('link', { name: 'Linked Account' })).toHaveLength(1);
  const rawLayout = structuredClone(fixture.layout);
  rawLayout.fields.accountId = { label: 'Account', groupId: `${module}:section:2`, order: 0, visibleInForm: true, visibleInDetails: false };
  fixture.layout.fields = rawLayout.fields;
  // The shared cache invalidation follows the same reload path as a configuration edit.
  cleanup(); clearPageCache();
  const original = mocks.get.getMockImplementation()!;
  mocks.get.mockImplementation(async (path: string) => path === `/crm/${module}/one` ? { data: { ...records[module], companyName: 'Stored company' } } : original(path));
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  await screen.findByText(`No deals attached to this ${module === 'leads' ? 'lead' : 'contact'}.`);
  expect(screen.queryByRole('link', { name: 'Linked Account' })).toBeNull();
  expect(screen.getByRole('tab', { name: /Details/ }).textContent).toBe(`Details${expectedCount - 1}`);
});

it.each(['leads', 'contacts'] as const)('%s shows the existing unlinked Account empty state inside Organization', async module => {
  render(<CrmRecordView module={module} id="one" />);
  await screen.findByRole('heading', { level: 1 }); fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
  const organization = within(screen.getByRole('button', { name: 'Organization' }).closest('section')!);
  expect(organization.getByText('No Account linked yet.')).toBeTruthy();
  await organization.findByText(`No deals attached to this ${module === 'leads' ? 'lead' : 'contact'}.`);
});

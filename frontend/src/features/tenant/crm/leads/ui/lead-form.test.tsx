const access = vi.hoisted(() => ({ restricted: false, accountsAllowed: true, mockData: false, leads: [] as Lead[], getCompanyOptions: vi.fn() }));
vi.mock('@/shared/hooks/use-email-availability', () => ({ useEmailAvailability: (email: string) => ({ available: true, blocked: false, confirm: () => true, email: email.trim(), retry: vi.fn(), reject: vi.fn() }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'workspace' }, user: { id: 'agent', firstName: 'My', lastName: 'Agent', email: 'my@camxian.com' } }) }));
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AddLeadForm } from './lead-form';
import type { Lead } from '@/store/types';
vi.mock('@/lib/config', () => ({ get USE_MOCK_DATA() { return access.mockData; } }));
vi.mock('../services/leads.service', () => ({ leadsService: { getCompanyOptions: access.getCompanyOptions } }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (key: string) => key !== 'accounts.view' || access.accountsAllowed }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({
  canMutate: (record?: Lead) => !access.restricted || record?.assignedUserId === 'agent',
  policy: { clientAdmin: !access.restricted, assignmentRestricted: access.restricted, userId: 'agent' },
}) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [], organizations: [], contacts: access.leads }) }));
vi.mock('@/shared/hooks/use-cached-page', () => ({ useCachedPage: () => ({ data: undefined, isInitialLoad: false, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [], loading: false }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/hooks/use-duplicate-check', () => ({ useDuplicateCheck: () => ({ matches: [], hasDuplicates: false, isChecking: false, dismiss: vi.fn() }) }));
vi.mock('@/shared/components/crm/record-custom-fields', async () => {
  const { defaultFieldLayout } = await import('@leadcrm/shared');
  const layout = defaultFieldLayout('leads');
  layout.fields.address = { label: 'Full Address', groupId: 'leads:section:3', order: 0, visibleInForm: true, visibleInDetails: true };
  return { useRecordCustomFields: () => ({ layout, fields: [], blocked: false, validate: () => true, payload: () => ({}), query: {} }), CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null, CustomFieldInput: () => null };
});
afterEach(() => {
  cleanup();
  access.restricted = false;
  access.accountsAllowed = true;
  access.mockData = false;
  access.leads = [];
  access.getCompanyOptions.mockReset();
});
function fillRequiredLead() {
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Lina' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Reyes' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'lina@example.test' } });
}
it('shows Call and SMS detail only for Others', async () => {
  const save = vi.fn(); render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Lead Source'), { target: { value: 'Others' } });
  fireEvent.change(screen.getByLabelText('Source detail'), { target: { value: 'SMS' } });
  expect(screen.getByText('Calls and SMS are entered by staff after receiving the inquiry.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Lead Source'), { target: { value: 'Website' } });
  expect(screen.queryByLabelText('Source detail')).toBeNull();
});
it('preserves the embedded Lead form account draft flow outside the Leads module', async () => {
  const save = vi.fn(); render(<AddLeadForm useGroupedCompanyPicker={false} onSave={save} onCancel={vi.fn()} />);
  const organization = screen.getByRole('heading', { name: 'Organization' }).closest('section')!;
  for (const name of ['Company Name', 'Industry', 'Company Size', 'Website']) expect(within(organization).queryByLabelText(name)).toBeNull();
  expect(within(screen.getByRole('heading', { name: 'Basic Information' }).closest('section')!).queryByLabelText('Company Name')).toBeNull();
  fillRequiredLead();
  fireEvent.click(screen.getByRole('button', { name: 'Create new account' }));
  fireEvent.change(screen.getByLabelText('Company Name *'), { target: { value: 'New lead company' } });
  fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'Technology' } });
  fireEvent.change(screen.getByLabelText('Company Size'), { target: { value: '11-50' } });
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://new.test' } });
  fireEvent.change(within(organization).getByLabelText('Company Address'), { target: { value: 'Company street\nMakati' } });
  const additional = screen.getByRole('heading', { name: 'Additional Information' }).closest('section')!;
  fireEvent.change(within(additional).getByLabelText('Lead Address'), { target: { value: 'Personal street\nPasig' } });
  expect(screen.queryByLabelText('Full Address')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ firstName: 'Lina', address: 'Personal street\nPasig', newAccount: { name: 'New lead company', industry: 'Technology', size: '11-50', website: 'https://new.test', address: 'Company street\nMakati' } });
  expect(save.mock.calls[0][0]).not.toHaveProperty('accountId');
});

it('shows headings inside the open picker and saves a Lead suggestion as a name', async () => {
  access.getCompanyOptions.mockResolvedValue({ data: {
    accounts: [{ id: 'account-one', name: 'River Traders', industry: 'Retail', address: null }],
    leadCompanies: ['ABC Trading'],
  } });
  const save = vi.fn();
  render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  const organization = screen.getByRole('heading', { name: 'Organization' }).closest('section')!;
  const picker = within(organization).getByRole('combobox', { name: 'Company' });
  expect(screen.queryByText('Companies from Leads')).toBeNull();
  fireEvent.click(picker);
  const list = screen.getByRole('listbox', { name: 'Company options' });
  const accounts = await within(list).findByRole('group', { name: 'Existing Accounts' });
  const companies = within(list).getByRole('group', { name: 'Companies from Leads' });
  const search = within(organization).getByRole('combobox', { name: 'Company' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const account = within(accounts).getByRole('option', { name: /River Traders/ });
  expect(document.activeElement).toBe(account);
  fireEvent.keyDown(account, { key: 'ArrowDown' });
  const company = within(companies).getByRole('option', { name: 'ABC Trading' });
  expect(document.activeElement).toBe(company);
  fireEvent.click(company);
  expect(screen.queryByText('Companies from Leads')).toBeNull();
  expect(within(organization).getByRole('combobox', { name: 'Company' }).textContent).toContain('ABC Trading');
  fillRequiredLead();
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ companyName: 'ABC Trading', accountId: null });
  expect(save.mock.calls[0][0]).not.toHaveProperty('newAccount');
});

it('offers a peer’s company from the same workspace when editing a mock Lead', async () => {
  access.mockData = true;
  access.restricted = true;
  const own = { id: 'own', tenantId: 'workspace', assignedUserId: 'agent', firstName: 'Lina', lastName: 'Reyes', email: 'lina@example.test', status: 'Inquiry' } as Lead;
  access.leads = [
    own,
    { ...own, id: 'peer', assignedUserId: 'another-agent', companyName: 'ABC Trading' },
    { ...own, id: 'other-workspace', tenantId: 'foreign', companyName: 'ABC Trading Foreign' },
    { ...own, id: 'archived', isArchived: true, companyName: 'ABC Trading Archived' },
  ];
  const save = vi.fn();
  render(<AddLeadForm initialData={own} onSave={save} onCancel={vi.fn()} />);
  const picker = screen.getByRole('combobox', { name: 'Company' });
  fireEvent.click(picker);
  fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), { target: { value: 'abc   trading' } });
  const list = screen.getByRole('listbox', { name: 'Company options' });
  const company = await within(list).findByRole('option', { name: /^ABC Trading$/ });
  expect(within(list).getAllByRole('option')).toEqual([company]);
  fireEvent.click(company);
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ companyName: 'ABC Trading', accountId: null });
});

it('adds a company name after a failed lookup even without Account access', async () => {
  access.accountsAllowed = false;
  access.getCompanyOptions.mockRejectedValue(new Error('Company search unavailable'));
  const save = vi.fn();
  render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Company' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), { target: { value: ' New   Company ' } });
  fireEvent.click(await screen.findByRole('option', { name: /Use.*New Company.*for this Lead/ }));
  expect(access.getCompanyOptions).toHaveBeenCalledWith({ search: 'New   Company', source: 'leads' }, expect.any(AbortSignal));
  fillRequiredLead();
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ companyName: 'New Company', accountId: null });
});

it('keeps same-name Accounts selectable by ID', async () => {
  access.getCompanyOptions.mockResolvedValue({ data: {
    accounts: [
      { id: 'acct-a', name: 'ABC Trading', industry: 'Retail', address: 'Makati' },
      { id: 'acct-b', name: 'ABC Trading', industry: 'Retail', address: 'Pasig' },
    ],
    leadCompanies: [],
  } });
  const save = vi.fn();
  render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Company' }));
  fireEvent.click(await screen.findByRole('option', { name: /ABC Trading.*Pasig/ }));
  fillRequiredLead();
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ accountId: 'acct-b' });
  expect(save.mock.calls[0][0]).not.toHaveProperty('companyName');
});

it('preserves a linked Account on unrelated edits when the link is unavailable to the editor', async () => {
  access.accountsAllowed = false;
  const initialData = {
    id: 'lead', firstName: 'Lina', lastName: 'Reyes', email: 'lina@example.test',
    accountId: 'current-account', status: 'Inquiry',
  } as Lead;
  const save = vi.fn();
  render(<AddLeadForm initialData={initialData} onSave={save} onCancel={vi.fn()} />);
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Lina Marie' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ firstName: 'Lina Marie' });
  expect(save.mock.calls[0][0]).not.toHaveProperty('accountId');
  expect(save.mock.calls[0][0]).not.toHaveProperty('companyName');
});

it('keeps both company drafts and submits only the selected mode', async () => {
  access.getCompanyOptions.mockResolvedValue({ data: { accounts: [], leadCompanies: ['Lead Company'] } });
  const save = vi.fn();
  render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  fillRequiredLead();
  fireEvent.click(screen.getByRole('combobox', { name: 'Company' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Lead Company' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Account Name *'), { target: { value: 'Account Draft' } });
  fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://draft.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose company' }));
  expect(screen.getByRole('combobox', { name: 'Company' }).textContent).toContain('Lead Company');
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByLabelText('Account Name *')).toHaveProperty('value', 'Account Draft');
  expect(screen.getByLabelText('Website')).toHaveProperty('value', 'https://draft.test');
  fireEvent.click(screen.getByRole('button', { name: 'Choose company' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ companyName: 'Lead Company', accountId: null });
  expect(save.mock.calls[0][0]).not.toHaveProperty('newAccount');
});

it.each(['link', 'create'] as const)('reviews a Lead Account before the user chooses to %s', async action => {
  const token = 'a'.repeat(64);
  const save = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Possible duplicate'), {
    duplicateReview: { token, matches: [{ id: 'matching-account', name: 'PLDT INC', website: 'https://pldt.test', address: 'Makati' }] },
  })).mockResolvedValue(undefined);
  render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  fillRequiredLead();
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Account Name *'), { target: { value: 'PlDt-INC' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  const dialog = await screen.findByRole('dialog', { name: 'An Account with a similar name already exists.' });
  expect(within(dialog).getByText('PLDT INC')).toBeTruthy();
  expect(within(dialog).getByText('Makati')).toBeTruthy();
  expect(save.mock.calls[0][0]).toMatchObject({ newAccount: { name: 'PlDt-INC' } });
  if (action === 'link') {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use existing Account' }));
    expect(screen.getByRole('combobox', { name: 'Company' }).textContent).toContain('PLDT INC');
    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ accountId: 'matching-account' });
    expect(save.mock.calls[1][0]).not.toHaveProperty('newAccount');
  } else {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create anyway' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].newAccount).toEqual({ ...save.mock.calls[0][0].newAccount, duplicateReviewToken: token });
  }
});

it('shows the current Sales agent read-only during manual creation and submits their identity', async () => {
  access.restricted = true; const save = vi.fn(); render(<AddLeadForm onSave={save} onCancel={vi.fn()} />);
  const agent = screen.getByRole('textbox', { name: 'Assigned Agent' }) as HTMLInputElement;
  expect(agent.value).toBe('My Agent'); expect(agent.readOnly).toBe(true);
  expect(screen.queryByRole('combobox', { name: 'Assigned Agent' })).toBeNull();
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Sales' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Lead' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'self@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ assignedUserId: 'agent', status: 'Inquiry' });
});

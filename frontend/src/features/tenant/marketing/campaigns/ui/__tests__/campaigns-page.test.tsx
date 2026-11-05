import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CUSTOM_FIELD_MODULES, getCrmFieldCatalog, type ClosingField } from '@leadcrm/shared';
import { clearPageCache } from '@/shared/cache/page-cache';
import { matchesSearch } from '@/shared/utils/search';
const mocks = vi.hoisted(() => ({ get: vi.fn(), duplicate: vi.fn(), create: vi.fn(), templateCreate: vi.fn(), templateList: vi.fn(), archive: vi.fn(), refresh: vi.fn(), dataOptions: vi.fn(), builder: vi.fn(), variableFields: vi.fn(), emailSettings: vi.fn(), smsSettings: vi.fn(), templates: [] as Array<{ id: string; name: string; type: 'Email' | 'SMS'; content: string; subject?: string; category: string }>, permitted: true, initial: false, refreshing: false }));
const campaign = { id: 'campaign', name: 'Saved campaign', type: 'Email', status: 'sent', targetAudience: 'All Leads', sentCount: 4, openedCount: 2, clickedCount: 1, createdAt: '2026-09-30' };
const scenario = vi.hoisted(() => ({ sms: false, smsTrackingVersion: 1 as number | null | undefined, metricCount: 1 as number | undefined }));
beforeEach(() => { scenario.sms = false; scenario.smsTrackingVersion = 1; scenario.metricCount = 1; });
const templateDefinitions = CUSTOM_FIELD_MODULES.map((module, index): ClosingField => ({ id: `definition-${index}`, version: 1, module, name: `${module} Custom`, technicalAlias: `${module}Custom`, type: 'Text', active: true, required: false, description: '', visibleInForm: true, visibleInDetails: true, group: 'Basic Information', order: 0, options: [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user', tenantId: 'tenant', role: 'Client Admin' }, tenant: { id: 'tenant' }, isLoading: false }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => mocks.permitted }));
vi.mock('../../hooks/use-campaigns-data', () => ({ useCampaignsData: (options: unknown) => {
  mocks.dataOptions(options);
  return { campaigns: [scenario.sms ? { ...campaign, type: 'Sms', smsTrackingVersion: scenario.smsTrackingVersion, openedCount: scenario.metricCount, clickedCount: scenario.metricCount } : campaign], total: 1, templates: mocks.templates, isInitialLoad: mocks.initial, isRefreshing: mocks.refreshing, refetch: mocks.refresh };
} }));
vi.mock('@/shared/services/campaigns.api', () => ({ campaignsApi: { get: mocks.get, duplicate: mocks.duplicate, create: mocks.create, archive: mocks.archive, variableFields: mocks.variableFields, emailSettings: mocks.emailSettings, smsSettings: mocks.smsSettings } }));
vi.mock('@/shared/services/templates.api', () => ({ templatesApi: { create: mocks.templateCreate, list: mocks.templateList } }));
vi.mock('../campaign-builder', () => ({ CampaignBuilder: (props: unknown) => { mocks.builder(props); return <div>Campaign editor</div>; } }));
vi.mock('../campaign-report-view', () => ({ CampaignReportView: () => <div>Campaign report</div> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
import CampaignsPage from '../campaigns-page';
import { campaignVariableTriggerClassName } from '../campaign-variable-picker';
beforeEach(() => { clearPageCache(); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); vi.clearAllMocks(); mocks.templates = []; mocks.permitted = true; mocks.initial = false; mocks.refreshing = false; mocks.archive.mockResolvedValue({ success: true }); mocks.templateCreate.mockResolvedValue({ success: true }); mocks.refresh.mockResolvedValue(undefined); mocks.variableFields.mockResolvedValue({ success: true, data: CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module)) }); mocks.emailSettings.mockResolvedValue({ success: true, data: { senderName: 'Provider sender', senderEmail: 'provider@example.test' } }); mocks.smsSettings.mockResolvedValue({ success: true, data: { organizationName: 'SMS organization', organizationEmail: 'contact@example.test' } }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); clearPageCache(); });
beforeEach(() => {
  mocks.templateList.mockImplementation(async (query: Record<string, unknown>) => {
    const data = mocks.templates.filter(template => (!query.type || template.type === query.type) && (!query.category || template.category === query.category) && matchesSearch(String(query.search ?? ''), template.name, template.category));
    const page = Number(query.page ?? 1), limit = Number(query.limit ?? 10);
    return { success: true, data: data.slice((page - 1) * limit, page * limit), meta: { total: data.length, page, limit, hasMore: page * limit < data.length } };
  });
});
it('shows only supported Campaign views and switches between them', async () => {
  render(<CampaignsPage />);
  const navigation = screen.getByRole('group', { name: 'Campaign views' });
  expect(screen.queryByText('SMS replies requiring review')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh replies' })).toBeNull();
  expect(screen.queryByText('No replies require review.')).toBeNull();
  expect(within(navigation).getAllByRole('button').map(button => button.textContent)).toEqual(['All Campaigns', 'Email Templates', 'SMS Templates']);
  expect(within(navigation).getByRole('button', { name: 'All Campaigns' }).getAttribute('aria-pressed')).toBe('true');
  for (const type of ['Email', 'SMS']) {
    fireEvent.click(within(navigation).getByRole('button', { name: `${type} Templates` }));
    expect(await screen.findByRole('heading', { name: `${type} Templates` })).toBeTruthy();
    expect(within(navigation).getByRole('button', { name: `${type} Templates` }).getAttribute('aria-pressed')).toBe('true');
  }
  fireEvent.click(within(navigation).getByRole('button', { name: 'All Campaigns' }));
  expect(screen.getByRole('grid')).toBeTruthy();
  expect(mocks.templateList.mock.calls.every(([query]) => ['Email', 'SMS'].includes(query.type))).toBe(true);
});

it.each(['loaded', 'initial', 'refreshing'] as const)('omits summary KPIs from the %s campaign list', state => {
  if (state !== 'loaded') mocks[state] = true;
  render(<CampaignsPage />);
  for (const label of ['Active Campaigns', 'Total Submitted', 'Total Opened', 'Total Clicked', 'Avg Open Rate']) {
    expect(screen.queryByText(label, { exact: true })).toBeNull();
  }
  expect(screen.queryByRole('progressbar', { name: /Average open rate/ })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Campaigns' })).toBeTruthy();
  expect(screen.queryByText(/^(?:\d+|…) total$/)).toBeNull();
  expect(screen.getByRole('button', { name: 'All Campaigns' })).toBeTruthy();
  if (state !== 'initial') {
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('Saved campaign')).toBeTruthy();
    expect(screen.getByText('1 total records', { exact: true })).toBeTruthy();
    for (const label of ['Submitted', 'Opened', 'Clicked', 'Engagement']) {
      expect(within(grid).getByRole('columnheader', { name: label })).toBeTruthy();
    }
  }
});
it.each([undefined, null, 1].flatMap(smsTrackingVersion => [undefined, 0, 7].map(metricCount => ({ smsTrackingVersion, metricCount }))))('shows unavailable SMS engagement with tracking version $smsTrackingVersion and stored count $metricCount', ({ smsTrackingVersion, metricCount }) => {
  scenario.smsTrackingVersion = smsTrackingVersion; scenario.metricCount = metricCount;
  scenario.sms = true; render(<CampaignsPage />);
  for (const metric of ['opens', 'clicks', 'engagement']) {
    const cell = screen.getByTitle(`SMS ${metric} ${metric === 'engagement' ? 'is' : 'are'} unavailable`);
    expect(cell.textContent).toBe('—');
    expect(cell.className).toContain('dark:text-slate-400');
  }
});
it('retains Email opened and clicked counts and its existing engagement calculation', () => {
  render(<CampaignsPage />);
  expect(screen.getByTitle('Unique opened recipients').textContent).toBe('2');
  expect(screen.getByTitle('Unique clicking recipients').textContent).toBe('1');
  expect(screen.getByTitle('Unique opens / email submissions').textContent).toBe('50%');
});
it('passes campaign search and filters to the existing list query and refreshes', async () => {
  render(<CampaignsPage />);
  fireEvent.change(screen.getByLabelText('Search campaigns'), { target: { value: 'Saved' } });
  expect(mocks.dataOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ search: 'Saved', page: 1 }) }));
  fireEvent.click(screen.getByLabelText('Filter campaigns'));
  const filters = document.querySelector('aside.hidden') as HTMLElement;
  fireEvent.click(within(filters).getByRole('checkbox', { name: 'Filter by Sent' }));
  fireEvent.click(within(filters).getByRole('checkbox', { name: 'Filter by SMS' }));
  expect(mocks.dataOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ search: 'Saved', status: 'SENT', type: 'SMS', page: 1 }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith());
});
it('opens the existing Manage Columns drawer', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<CampaignsPage />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Table settings' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage Columns' }));
  });
  expect(await screen.findByRole('dialog', { name: 'Manage Columns - campaigns' })).toBeTruthy();
  scroll.mockRestore();
});
it('opens View and duplicates the complete saved campaign into a new draft', async () => {
  mocks.get.mockResolvedValue({ data: { ...campaign, subject: 'Saved subject', body: '<p>Saved body</p>', audienceSource: 'LEADS' } });
  mocks.create.mockResolvedValue({ data: { id: 'copy' } });
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View', 'Duplicate', 'Archive']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  await waitFor(() => expect(mocks.duplicate).toHaveBeenCalledWith('campaign'));
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(screen.getByText('Campaign report')).toBeTruthy();
});
it('archives only selected campaigns after confirmation and refreshes', async () => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Archive 1 campaign?' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('campaign'));
  await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  expect(mocks.refresh).toHaveBeenCalled();
});
it('retains View without exposing forbidden mutations', () => {
  mocks.permitted = false;
  render(<CampaignsPage />);
  expect(screen.queryByRole('checkbox', { name: 'Select all records' })).toBeNull();
  for (const name of ['Submitted', 'Opened', 'Clicked', 'Engagement']) expect(screen.queryByRole('columnheader', { name })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View']);
});

it('uses the Leads blue filter state and returns to inactive when closed', () => {
  render(<CampaignsPage />);
  const filter = screen.getByLabelText('Filter campaigns');
  fireEvent.click(filter); expect(filter.className).toContain('bg-primary'); expect(filter.className).toContain('text-white');
  fireEvent.click(filter); expect(filter.className).toContain('bg-white'); expect(filter.getAttribute('aria-expanded')).toBe('false');
});
it.each(['initial', 'refreshing'] as const)('keeps the campaign controls visible during %s table loading', state => {
  mocks[state] = true; render(<CampaignsPage />);
  if (state === 'initial') expect(screen.getByText('Loading campaigns...').parentElement?.querySelector('.animate-spin')).toBeTruthy();
  expect(screen.getByLabelText('Search campaigns')).toBeTruthy(); expect(screen.getByLabelText('Filter campaigns')).toBeTruthy();
  if (state === 'initial') expect(screen.queryByRole('grid')).toBeNull();
  else expect(screen.getByRole('grid')).toBeTruthy();
});
it('offers persisted outcome statuses including interrupted submissions and Email/SMS types', () => {
  render(<CampaignsPage />); fireEvent.click(screen.getByLabelText('Filter campaigns'));
  const filters = screen.getAllByRole('checkbox').filter(el => !el.getAttribute('aria-label')?.startsWith('Select'));
  expect([...new Set(filters.map(el => el.closest('label')?.textContent))]).toEqual(['Draft', 'Scheduled', 'Sending', 'Submitted', 'Interrupted', 'Sent', 'Partially Sent', 'Delivered', 'Failed', 'Email', 'SMS']);
});

it.each(['Email', 'SMS'].flatMap(type => ['Draft', 'Scheduled', 'Sending', 'Submitted', 'Interrupted', 'Sent', 'Partially Sent', 'Delivered', 'Failed'].map(status => ({ type, status }))))('queries the persisted $type $status outcome and preserves it across supported type changes', ({ type, status }) => {
  render(<CampaignsPage />); fireEvent.click(screen.getByLabelText('Filter campaigns'));
  const filters = document.querySelector('aside.hidden') as HTMLElement;
  fireEvent.click(within(filters).getByRole('checkbox', { name: `Filter by ${status}` }));
  fireEvent.click(within(filters).getByRole('checkbox', { name: `Filter by ${type}` }));
  const persistedStatus = status.toUpperCase().replaceAll(' ', '_');
  expect(mocks.dataOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ status: persistedStatus, type: type.toUpperCase(), page: 1 }) }));
  fireEvent.click(within(filters).getByRole('checkbox', { name: `Filter by ${type}` }));
  const other = type === 'Email' ? 'SMS' : 'Email';
  fireEvent.click(within(filters).getByRole('checkbox', { name: `Filter by ${other}` }));
  expect(mocks.dataOptions).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ status: persistedStatus, type: other.toUpperCase(), page: 1 }) }));
});

it('replaces the active template selection with the exact catalog token and restores focus', async () => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Email Templates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'New Email Template' }));
  const subject = screen.getByLabelText(/Subject Line/) as HTMLInputElement;
  const content = screen.getByLabelText(/Message Content/) as HTMLTextAreaElement;
  fireEvent.change(subject, { target: { value: 'Hello customer!' } });
  fireEvent.change(content, { target: { value: 'Keep this body.' } });
  fireEvent.focus(subject); subject.setSelectionRange(6, 14);
  fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
  const firstName = await screen.findByRole('button', { name: /First Name.*firstName/ });
  fireEvent.click(firstName);
  expect(subject.value).toBe('Hello {{firstName}}!');
  expect(content.value).toBe('Keep this body.');
  await waitFor(() => expect(document.activeElement).toBe(subject));
  expect(subject.selectionStart).toBe(19);
  fireEvent.focus(content); content.setSelectionRange(5, 9);
  fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
  fireEvent.click(screen.getByRole('button', { name: /Sender Email.*sender_email/ }));
  expect(content.value).toBe('Keep {{sender_email}} body.');
  expect(screen.queryByLabelText('Search variables')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(content));
});

it.each(['Email', 'SMS'] as const)('portals the %s picker outside the sheet scroller and preserves keyboard and dismissal behavior', async type => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: `New ${type} Template` }));
  const panel = screen.getByRole('dialog', { name: `Create ${type} Template` });
  const trigger = within(panel).getByRole('button', { name: 'Insert Variable' });
  expect(trigger.className).toBe(campaignVariableTriggerClassName);
  expect(trigger.querySelector('svg')?.getAttribute('width')).toBe('14');
  trigger.focus(); fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const picker = screen.getByRole('group', { name: 'Template variables' });
  const search = within(picker).getByLabelText('Search variables');
  expect(panel.contains(picker)).toBe(false);
  expect(picker.closest('[data-theme-portal]')?.getAttribute('data-overlay-owner')).toBe(panel.closest('[data-theme-portal]')?.getAttribute('data-overlay-owner'));
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.keyDown(search, { key: 'Tab' });
  expect(document.activeElement).toBe(within(picker).getAllByRole('button')[0]);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByLabelText('Search variables')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole('dialog', { name: `Create ${type} Template` })).toBe(panel);
  fireEvent.click(trigger); fireEvent.mouseDown(within(panel).getByLabelText(/Template Name/));
  expect(screen.queryByLabelText('Search variables')).toBeNull();
  fireEvent.click(trigger); fireEvent.click(within(panel).getByRole('button', { name: 'Close sheet' }));
  await waitFor(() => expect(screen.queryByLabelText('Search variables')).toBeNull());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: `Create ${type} Template` })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: `New ${type} Template` }));
  expect(screen.queryByLabelText('Search variables')).toBeNull();
});

it.each(['Email', 'SMS'] as const)('renders the %s template fields consecutively without a field filter', async type => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: `New ${type} Template` }));
  const panel = await screen.findByRole('dialog', { name: `Create ${type} Template` });
  expect(within(panel).queryByText('Field filter')).toBeNull();
  expect(within(panel).queryByLabelText('Template field source')).toBeNull();
  expect(within(panel).queryByRole('option', { name: /Lead fields|Contact fields/ })).toBeNull();
  expect(within(panel).getAllByRole('combobox')).toEqual([within(panel).getByLabelText('Category')]);
  const previousField = within(panel).getByLabelText(type === 'Email' ? /Subject Line/ : 'Category');
  expect(previousField.parentElement?.nextElementSibling?.querySelector('#template-content')).toBe(within(panel).getByLabelText(/Message Content/));
  expect(within(panel).getByRole('button', { name: 'Insert Variable' })).toBeTruthy();
  expect(within(panel).getByRole('button', { name: 'Save Template' })).toBeTruthy();
});

it.each(['Email', 'SMS'] as const)('searches and inserts approved Lead/Contact fields together in the %s template picker', async type => {
  const inactive = { ...templateDefinitions[0], id: 'inactive', technicalAlias: 'inactive', name: 'Inactive Custom', active: false };
  mocks.variableFields.mockResolvedValue({ success: true, data: CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module, [...templateDefinitions, inactive])) });
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: `New ${type} Template` }));
  fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
  await screen.findByRole('button', { name: /leads Custom.*customFieldValues.leadsCustom/ });
  const picker = screen.getByLabelText('Search variables').closest('.max-h-80')! as HTMLElement;
  expect(picker.textContent).not.toMatch(/Accounts|Deals|accounts Custom|deals Custom|Inactive Custom/);
  expect([...picker.querySelectorAll('p')].map(node => node.textContent)).toEqual(['Standard Fields', 'Custom Fields', 'Sender']);
  expect(within(picker).queryByRole('combobox')).toBeNull();
  for (const key of ['value', 'website', 'customFieldValues.accountsCustom', 'customFieldValues.dealsCustom', 'customFieldValues.inactive', 'first_name', 'company_name']) expect(within(picker).queryByText(`{{${key}}}`)).toBeNull();
  expect(within(picker).getByRole('button', { name: /leads Custom.*Leads/ }).hasAttribute('disabled')).toBe(false);
  expect(within(picker).getByRole('button', { name: /contacts Custom.*Contacts/ }).hasAttribute('disabled')).toBe(false);
  expect(within(picker).getAllByText('{{firstName}}')).toHaveLength(1);
  expect(within(picker).getByRole('button', { name: /First Name.*Leads, Contacts/ })).toBeTruthy();
  expect(within(picker).getAllByText('{{sender_name}}')).toHaveLength(1);
  expect(within(picker).getAllByText('{{sender_email}}')).toHaveLength(1);
  const search = within(picker).getByLabelText('Search variables');
  for (const [query, key] of [['leads Custom', 'customFieldValues.leadsCustom'], ['customFieldValues.contactsCustom', 'customFieldValues.contactsCustom'], ['Leads', 'companyName'], ['Contacts', 'companyName'], ['Standard Fields', 'firstName']]) {
    fireEvent.change(search, { target: { value: query } });
    expect(within(picker).getByText(`{{${key}}}`)).toBeTruthy();
  }
  fireEvent.change(search, { target: { value: 'no matching campaign variable' } });
  expect(within(picker).getByText('No matching variables.')).toBeTruthy();
  fireEvent.change(search, { target: { value: '' } });
  const content = screen.getByLabelText(/Message Content/) as HTMLTextAreaElement;
  for (const key of ['customFieldValues.leadsCustom', 'customFieldValues.contactsCustom']) {
    fireEvent.change(content, { target: { value: 'Hello recipient!' } });
    fireEvent.focus(content); content.setSelectionRange(6, 15);
    if (!screen.queryByLabelText('Search variables')) fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    fireEvent.click(screen.getByText(`{{${key}}}`).closest('button')!);
    expect(content.value).toBe(`Hello {{${key}}}!`);
    expect(screen.queryByLabelText('Search variables')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(content);
      expect(content.selectionStart).toBe(6 + `{{${key}}}`.length);
      expect(content.selectionEnd).toBe(content.selectionStart);
    });
  }
});

it.each(['Email', 'SMS'] as const)('keeps hidden and unsupported fields unavailable in the %s template picker', async type => {
  const definitions = templateDefinitions.filter(field => field.module === 'leads' || field.module === 'contacts').flatMap((field): ClosingField[] => [
    { ...field, id: `hidden-${field.module}`, name: `Hidden ${field.module}`, technicalAlias: `hidden${field.module}`, visibleInForm: false, visibleInDetails: false },
    { ...field, id: `file-${field.module}`, name: `Private ${field.module}`, technicalAlias: `file${field.module}`, type: 'File Upload' },
  ]);
  const catalog = CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module, definitions)).map(field => field.module === 'leads' && field.technicalKey === 'firstName' ? { ...field, visibleInForm: false, visibleInDetails: false } : field);
  mocks.variableFields.mockResolvedValue({ success: true, data: catalog });
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: `New ${type} Template` }));
  fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
  await screen.findByRole('button', { name: /Hidden leads/ });
  for (const module of ['leads', 'contacts']) {
    const hidden = screen.getByRole('button', { name: new RegExp(`Hidden ${module}`) });
    const file = screen.getByRole('button', { name: new RegExp(`Private ${module}`) });
    expect(hidden.hasAttribute('disabled')).toBe(true);
    expect(hidden.textContent).toContain('This field is hidden.');
    expect(file.hasAttribute('disabled')).toBe(true);
    expect(file.textContent).toContain('file links cannot be personalized.');
  }
  expect(screen.getByRole('button', { name: /First Name.*firstName/ }).hasAttribute('disabled')).toBe(false);
});

it.each(['Email', 'SMS'] as const)('previews %s templates with current configured sender identity and compatible tokens', async type => {
  mocks.templates = [{ id: 'template', name: 'Sender template', type, category: 'Marketing', subject: 'Hello {{firstName}}', content: '{{firstName}} {{first_name}} {{sender_name}} {{sender_email}}' }];
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: type === 'Email' ? 'Email Templates' : 'SMS Templates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  const text = type === 'Email' ? 'John John Provider sender provider@example.test' : 'John John SMS organization contact@example.test';
  await screen.findByText(text);
});

it.each(['Email', 'SMS'] as const)('previews canonical standard and custom fields from both modules in %s templates', async type => {
  mocks.variableFields.mockResolvedValue({ success: true, data: CUSTOM_FIELD_MODULES.flatMap(module => getCrmFieldCatalog(module, templateDefinitions)) });
  mocks.templates = [{ id: 'template', name: 'Combined variables', type, category: 'Marketing', subject: 'Hello {{firstName}} {{lastName}} at {{companyName}}', content: '{{firstName}} {{lastName}} | {{email}} | {{phone}} | {{companyName}} | {{companyName}} | {{customFieldValues.leadsCustom}} | {{customFieldValues.contactsCustom}} | {{customFieldValues.definition-0}} | {{customFieldValues.definition-1}} | {{sender_name}} {{sender_email}}' }];
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  const preview = screen.getByRole('dialog', { name: 'Template Preview' });
  const sender = type === 'Email' ? 'Provider sender provider@example.test' : 'SMS organization contact@example.test';
  await waitFor(() => expect(preview.textContent).toContain(`John Doe | Example Email | Example Phone | Example Company | Example Company | Example leads Custom | Example contacts Custom | Example leads Custom | Example contacts Custom | ${sender}`));
  if (type === 'Email') expect(preview.textContent).toContain('Hello John Doe at Example Company');
  expect(preview.textContent).not.toContain('{{');
});

it.each(['Email', 'SMS'] as const)('validates and saves a new %s template through the existing template API', async type => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: `New ${type} Template` }));
  const panel = screen.getByRole('dialog', { name: `Create ${type} Template` });
  fireEvent.click(within(panel).getByRole('button', { name: 'Save Template' }));
  expect(mocks.templateCreate).not.toHaveBeenCalled();
  expect(within(panel).getByText('Name is required.')).toBeTruthy();
  expect(within(panel).getByText('Message content is required.')).toBeTruthy();
  if (type === 'Email') expect(within(panel).getByText('Subject line is required.')).toBeTruthy();
  fireEvent.change(within(panel).getByLabelText(/Template Name/), { target: { value: `Saved ${type} template` } });
  fireEvent.change(within(panel).getByLabelText('Category'), { target: { value: 'Sales' } });
  if (type === 'Email') fireEvent.change(within(panel).getByLabelText(/Subject Line/), { target: { value: 'Hello {{firstName}}' } });
  const content = type === 'Email' ? '<p>Hello {{firstName}} at {{companyName}}</p><script>alert("ignored")</script>' : 'Hi {{firstName}}, {{phone}}\n{{companyName}} {{customFieldValues.contactsCustom}}';
  fireEvent.change(within(panel).getByLabelText(/Message Content/), { target: { value: content } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Save Template' }));
  await waitFor(() => expect(mocks.templateCreate).toHaveBeenCalledExactlyOnceWith({
    name: `Saved ${type} template`, type, category: 'Sales', subject: type === 'Email' ? 'Hello {{firstName}}' : '',
    content: type === 'Email' ? '<p>Hello {{firstName}} at {{companyName}}</p>' : content,
  }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: `Create ${type} Template` })).toBeNull());
  expect(mocks.refresh).toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

const persistedDefaults = [
  { name: 'Lead Inquiry Acknowledgment', type: 'Email' },
  { name: 'Proposal Follow-Up', type: 'Email' },
  { name: 'Thank You and Next Steps', type: 'Email' },
  { name: 'Inquiry Received', type: 'SMS' },
  { name: 'Inquiry Follow-Up', type: 'SMS' },
  { name: 'Proposal Ready', type: 'SMS' },
] as const;
it.each(persistedDefaults)('displays canonical persisted $name content in its card, preview and both Use Template flows', async ({ name, type }) => {
  const template = { id: name, name, type, category: 'Edited category',
    subject: type === 'Email' ? 'Thank you, {{firstName}} — next steps for {{companyName}}' : undefined,
    content: 'Hi {{firstName}}, please call us tomorrow for {{companyName}}. {{sender_name}} {{sender_email}}',
  };
  mocks.templates = [template];
  const page = render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  expect(await screen.findByText(template.content)).toBeTruthy();
  if (template.subject) expect(screen.getByText(template.subject)).toBeTruthy();
  expect(page.container.textContent).not.toMatch(/{{(?:first_name|company_name)}}/);
  fireEvent.click(screen.getByRole('button', { name: 'Use Template' }));
  expect(mocks.builder).toHaveBeenLastCalledWith(expect.objectContaining({ initialType: type, initialSubject: template.subject ?? '', initialContent: template.content }));

  page.unmount();
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  const preview = screen.getByRole('dialog', { name: 'Template Preview' });
  const sender = type === 'Email' ? 'Provider sender provider@example.test' : 'SMS organization contact@example.test';
  await waitFor(() => expect(preview.textContent).toContain(`Hi John, please call us tomorrow for Example Company. ${sender}`));
  if (template.subject) expect(preview.textContent).toContain('Thank you, John — next steps for Example Company');
  expect(preview.textContent).not.toContain('{{');
  fireEvent.click(within(preview).getByRole('button', { name: 'Use Template' }));
  expect(mocks.builder).toHaveBeenLastCalledWith(expect.objectContaining({ initialType: type, initialSubject: template.subject ?? '', initialContent: template.content }));
});
it('inserts a canonical variable in a new SMS template', async () => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'SMS Templates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'New SMS Template' }));
  const content = screen.getByLabelText(/Message Content/) as HTMLTextAreaElement;
  fireEvent.focus(content);
  fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
  fireEvent.click(await screen.findByRole('button', { name: /First Name.*firstName/ }));
  expect(content.value).toBe('{{firstName}}');
});

it.each(['Email', 'SMS'] as const)('inserts canonical first-name and source-specific company keys in new %s templates', async type => {
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  fireEvent.click(await screen.findByRole('button', { name: `New ${type} Template` }));
  const content = screen.getByLabelText(/Message Content/) as HTMLTextAreaElement;
  expect(content.placeholder).toContain('{{firstName}}');
  expect(content.placeholder).not.toContain('{{first_name}}');
  for (const key of ['firstName', 'lastName', 'email', 'phone', 'companyName', 'sender_name', 'sender_email']) {
    fireEvent.change(content, { target: { value: '' } });
    fireEvent.focus(content);
    fireEvent.click(screen.getByRole('button', { name: 'Insert Variable' }));
    const token = await screen.findByText(`{{${key}}}`);
    fireEvent.click(token.closest('button')!);
    expect(content.value).toBe(`{{${key}}}`);
    expect(content.value).not.toMatch(/{{(?:first_name|company_name)}}/);
  }
});

function messageTemplates(type: 'Email' | 'SMS', count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `${type}-${index}`, name: `${type} Follow ${index + 1}`, type, category: index % 2 ? 'Support' : 'Sales', subject: type === 'Email' ? 'Saved subject' : undefined, content: `Saved ${type} content ${index + 1}` }));
}

it.each(['Email', 'SMS'] as const)('uses the shared primary New %s Template button and existing creation panel', async type => {
  render(<CampaignsPage />);
  expect(mocks.templateList).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await screen.findByRole('heading', { name: `No ${type} Templates Found` });
  const button = screen.getByRole('button', { name: `New ${type} Template` });
  expect(button.classList.contains('bg-primary')).toBe(true);
  expect(button.className).toContain('text-white');
  expect(button.className).toContain('h-9');
  expect(button.className).toContain('rounded-xl');
  expect(screen.getByRole('toolbar', { name: 'templates controls' })).toBeTruthy();
  expect(screen.getByLabelText('Search templates')).toBeTruthy();
  expect(screen.getByLabelText(`Filter ${type.toLowerCase()} templates`)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('title')).toBe('Refresh');
  fireEvent.click(button);
  expect(screen.getByRole('dialog', { name: `Create ${type} Template` })).toBeTruthy();
  expect(!!screen.queryByLabelText(/Subject Line/)).toBe(type === 'Email');
});

it.each(['Email', 'SMS'] as const)('shows the %s section copy and one create action in empty and populated views', async type => {
  const view = render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await screen.findByRole('heading', { name: `No ${type} Templates Found` });
  expect(screen.getByRole('heading', { level: 2, name: `${type} Templates` })).toBeTruthy();
  expect(screen.getByText(`Create and reuse ${type === 'Email' ? 'email' : 'SMS'} templates for your campaigns.`)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: new RegExp(`(?:New|Create First) ${type} Template`) })).toHaveLength(1);
  expect(within(screen.getByRole('group', { name: 'templates actions' })).getByRole('button', { name: 'Refresh' })).toBeTruthy();
  view.unmount(); clearPageCache();
  mocks.templates = messageTemplates(type, 1);
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await screen.findByRole('heading', { name: `${type} Follow 1` });
  expect(screen.getAllByRole('button', { name: new RegExp(`(?:New|Create First) ${type} Template`) })).toHaveLength(1);
});

it.each(['Email', 'SMS'] as const)('searches %s names and categories with isolated typed requests and clears empty results', async type => {
  const otherType = type === 'Email' ? 'SMS' : 'Email';
  mocks.templates = [...messageTemplates(type, 2), ...messageTemplates(otherType, 2)];
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await screen.findByRole('heading', { name: `${type} Follow 1` });
  expect(screen.queryByRole('heading', { name: `${otherType} Follow 1` })).toBeNull();
  const search = screen.getByLabelText('Search templates');
  fireEvent.change(search, { target: { value: 'fOlLoW 2' } });
  await waitFor(() => expect(screen.queryByRole('heading', { name: `${type} Follow 1` })).toBeNull());
  await screen.findByRole('heading', { name: `${type} Follow 2` });
  expect(mocks.templateList).toHaveBeenCalledWith({ type, search: 'fOlLoW 2', category: '', page: 1, limit: 10 });
  fireEvent.change(search, { target: { value: 'sAlEs' } });
  await screen.findByRole('heading', { name: `${type} Follow 1` });
  expect(screen.queryByRole('heading', { name: `${type} Follow 2` })).toBeNull();
  fireEvent.change(search, { target: { value: 'no matching template' } });
  await screen.findByRole('heading', { name: 'No templates match your search or filters' });
  expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
  await screen.findByRole('heading', { name: `${type} Follow 2` });
  expect((search as HTMLInputElement).value).toBe('');
});

it.each(['Email', 'SMS'] as const)('paginates %s results and resets pages for search, category, and size changes', async type => {
  mocks.templates = messageTemplates(type, 25);
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await screen.findByText('Page 1 of 3');
  expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('heading', { name: `${type} Follow 11` });
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'Follow' } });
  await screen.findByRole('heading', { name: `${type} Follow 1` });
  expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('heading', { name: `${type} Follow 11` });
  fireEvent.click(screen.getByLabelText(`Filter ${type.toLowerCase()} templates`));
  const rail = document.querySelector('aside.hidden') as HTMLElement;
  fireEvent.click(within(rail).getByRole('checkbox', { name: 'Filter by Sales' }));
  await screen.findByText('Page 1 of 2');
  expect(screen.queryByRole('heading', { name: `${type} Follow 2` })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('heading', { name: `${type} Follow 21` });
  expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Records per page' }));
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['10', '20', '25', '50', '100']);
  fireEvent.click(screen.getByRole('option', { name: '20' }));
  await screen.findByText('Page 1 of 1');
  expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(13);
  fireEvent.click(within(rail).getByRole('button', { name: 'Clear filters' }));
  await screen.findByText('Page 1 of 2');
  expect((screen.getByLabelText('Search templates') as HTMLInputElement).value).toBe('Follow');
  expect(mocks.templateList).toHaveBeenCalledWith({ type, search: 'Follow', category: '', page: 1, limit: 20 });
});

it.each(['Email', 'SMS'] as const)('loads all %s categories across API pages and toggles a single category', async type => {
  mocks.templates = [...messageTemplates(type, 100), { ...messageTemplates(type, 1)[0], id: 'last', name: 'Last template', category: 'Rare category' },
    { ...messageTemplates(type === 'Email' ? 'SMS' : 'Email', 1)[0], category: 'Other type category' }];
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await waitFor(() => expect(mocks.templateList).toHaveBeenCalledWith({ type, page: 2, limit: 100 }));
  fireEvent.click(screen.getByLabelText(`Filter ${type.toLowerCase()} templates`));
  const rail = document.querySelector('aside.hidden') as HTMLElement;
  const rare = await within(rail).findByRole('checkbox', { name: 'Filter by Rare category' });
  expect(within(rail).queryByRole('checkbox', { name: 'Filter by Other type category' })).toBeNull();
  fireEvent.click(rare);
  await screen.findByRole('heading', { name: 'Last template' });
  expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  fireEvent.click(within(rail).getByRole('checkbox', { name: 'Filter by Sales' }));
  await screen.findByText('Page 1 of 5');
  expect((rare as HTMLInputElement).checked).toBe(false);
  fireEvent.click(within(rail).getByRole('checkbox', { name: 'Filter by Sales' }));
  await screen.findByText('Page 1 of 11');
});

it.each(['Email', 'SMS'] as const)('refreshes only %s templates, retains filters, and clamps a shrinking last page', async type => {
  mocks.templates = messageTemplates(type, 25);
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  await screen.findByText('Page 1 of 3');
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'Follow' } });
  await screen.findByText('Page 1 of 3');
  fireEvent.click(screen.getByLabelText(`Filter ${type.toLowerCase()} templates`));
  const rail = document.querySelector('aside.hidden') as HTMLElement;
  fireEvent.click(await within(rail).findByRole('checkbox', { name: 'Filter by Sales' }));
  await screen.findByText('Page 1 of 2');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('heading', { name: `${type} Follow 21` });
  mocks.templates = messageTemplates(type, 5);
  const requestsBeforeRefresh = mocks.templateList.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('heading', { name: `${type} Follow 1` });
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(3));
  expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  expect((screen.getByLabelText('Search templates') as HTMLInputElement).value).toBe('Follow');
  expect(mocks.templateList.mock.calls.slice(requestsBeforeRefresh).map(([query]) => query)).toEqual(expect.arrayContaining([
    { type, search: 'Follow', category: 'Sales', page: 2, limit: 10 }, { type, page: 1, limit: 100 }, { type, search: 'Follow', category: 'Sales', page: 1, limit: 10 },
  ]));
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('resets message list controls on tab switches and keeps template types separate', async () => {
  mocks.templates = [...messageTemplates('Email', 25), ...messageTemplates('SMS', 2)];
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Email Templates' }));
  await screen.findByText('Page 1 of 3');
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'Email' } });
  await screen.findByText('Page 1 of 3');
  fireEvent.click(screen.getByRole('button', { name: 'Records per page' }));
  fireEvent.click(screen.getByRole('option', { name: '20' }));
  await screen.findByText('Page 1 of 2');
  fireEvent.click(screen.getByLabelText('Filter email templates'));
  fireEvent.click(within(document.querySelector('aside.hidden') as HTMLElement).getByRole('checkbox', { name: 'Filter by Sales' }));
  await screen.findByText('Page 1 of 1');
  fireEvent.click(screen.getByRole('button', { name: 'SMS Templates' }));
  await screen.findByRole('heading', { name: 'SMS Follow 1' });
  expect((screen.getByLabelText('Search templates') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('Filter sms templates').getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: 'Records per page' }).textContent).toBe('10');
  expect(screen.queryByRole('heading', { name: 'Email Follow 1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Email Templates' }));
  await screen.findByText('Page 1 of 3');
  expect(screen.getAllByRole('button', { name: 'Preview' })).toHaveLength(10);
});

it.each(['Email', 'SMS'] as const)('preserves %s cards during refresh errors and exposes loading and retry states', async type => {
  mocks.templates = messageTemplates(type, 1);
  let resolve!: (value: unknown) => void;
  const normalList = mocks.templateList.getMockImplementation()!;
  mocks.templateList.mockImplementation((query: Record<string, unknown>) => query.limit === 100 ? normalList(query) : new Promise(done => { resolve = done; }));
  render(<CampaignsPage />);
  fireEvent.click(screen.getByRole('button', { name: `${type} Templates` }));
  expect(screen.getByText(`Loading ${type.toLowerCase()} templates…`)).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  await act(async () => resolve(await normalList({ type, page: 1, limit: 10 })));
  await screen.findByRole('heading', { name: `${type} Follow 1` });
  if (type === 'SMS') expect(screen.getByText(`${mocks.templates[0].content.length} characters`)).toBeTruthy();
  mocks.templateList.mockImplementation((query: Record<string, unknown>) => query.limit === 100 ? normalList(query) : Promise.reject(new Error('Template refresh failed')));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe('Template refresh failed');
  expect(screen.getByRole('heading', { name: `${type} Follow 1` })).toBeTruthy();
  mocks.templateList.mockImplementation(normalList);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

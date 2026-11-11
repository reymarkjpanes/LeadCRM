import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearPageCache } from '@/shared/cache/page-cache';
import { CrmRecordPanel, CrmRecordView } from './crm-record-view';
import type { TimelineActivity } from '@/shared/hooks/use-record-activities';

const mocks = vi.hoisted(() => ({ get: vi.fn(), getAll: vi.fn(), navigate: vi.fn(), close: vi.fn(), edit: false, role: 'Sales',
  files: [] as any[], emailFiles: [] as any[], emailDenied: false,
  status: { isConnected: true, syncError: null as string | null } }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'owner', role: mocks.role, tenantId: 'tenant' }, isLoading: false, authError: null }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ activities: [], users: [], pipelines: [], deals: [], contacts: [], organizations: [] }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: (key: string) => key.endsWith('.view') || mocks.edit }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => mocks.edit, canReassign: false, policy: { activityReadScope: 'mailbox' } }) }));
vi.mock('@/shared/hooks/use-record-relationships', () => ({ useRecordRelationships: () => ({ data: undefined }) }));
vi.mock('@/shared/hooks/use-field-layout', async () => {
  const { defaultFieldLayout } = await import('@leadcrm/shared');
  return { useFieldLayout: (module: Parameters<typeof defaultFieldLayout>[0]) => ({ layout: defaultFieldLayout(module) }) };
});
vi.mock('./record-custom-fields', () => ({ useRecordCustomFieldDetails: () => ({ fields: [], query: { error: null } }), RecordCustomFieldInlineRow: () => null }));
vi.mock('./deal-closing-requirements', () => ({ DealClosingRequirements: () => null }));
vi.mock('./inline-deal-form', () => ({ InlineDealForm: () => null }));
vi.mock('./deal-card-menu', () => ({ DealCardMenu: () => null }));
vi.mock('@/features/tenant/operations/tasks/ui/related-tasks', () => ({ RelatedTasks: ({ readOnly, allowCreate }: { readOnly: boolean; allowCreate: boolean }) => <div data-testid="related-tasks" data-readonly={String(readOnly)} data-create={String(allowCreate)} /> }));
vi.mock('@/features/tenant/crm/leads/ui/convert-lead-dialog', () => ({ ConvertLeadDialog: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.navigate, replace: mocks.navigate, back: mocks.navigate }) }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/features/tenant/crm/activities/services/activities.service', () => ({ activitiesService: { getAll: mocks.getAll } }));

const streams: FakeSource[] = [];
class FakeSource extends EventTarget { close = vi.fn(); constructor() { super(); streams.push(this); } }
const note: TimelineActivity = { id: 'note', type: 'note', title: 'Existing note', createdAt: '2026-10-01T01:00:00Z' };
const email = (direction: 'inbound' | 'outbound'): TimelineActivity => ({
  id: direction, type: 'email', title: `${direction === 'inbound' ? 'Received' : 'Sent'} email: Customer thread`, createdAt: '2026-10-02T01:00:00Z',
  metadata: { email: { id: direction, providerMessageId: direction, threadId: 'thread', accountId: 'mailbox', direction,
    from: direction === 'inbound' ? 'customer@example.test' : 'owner@camxian.com', to: [direction === 'inbound' ? 'owner@camxian.com' : 'customer@example.test'],
    subject: 'Customer thread', sentAt: '2026-10-02T01:00:00Z', body: `Persisted ${direction} body` } },
});
let rows: TimelineActivity[];
beforeEach(() => {
  clearPageCache(); vi.clearAllMocks(); mocks.edit = false; mocks.role = 'Sales'; streams.length = 0; rows = [note]; vi.stubGlobal('EventSource', FakeSource);
  mocks.status = { isConnected: true, syncError: null };
  mocks.files = []; mocks.emailFiles = []; mocks.emailDenied = false;
  mocks.get.mockImplementation(async (path: string) => path.endsWith('/email-attachments')
    ? mocks.emailDenied ? Promise.reject(Object.assign(new Error('Mailbox access revoked'), { status: 403 })) : { data: { attachments: mocks.emailFiles } }
    : path === '/integrations/gmail/status' ? mocks.status : path.endsWith('/files') ? { data: mocks.files } : { data: {
    id: 'record', name: 'Customer Account', firstName: 'Customer', lastName: 'Test', email: 'customer@example.test', title: 'Customer Deal', status: 'Warm', assignedUserId: 'owner',
    createdAt: note.createdAt, stage: { name: 'Lead' }, productInterests: [], leadDeals: [], contactDeals: [],
  } });
  mocks.getAll.mockImplementation(async ({ type }: { type?: string }) => {
    const data = rows.filter(row => !type || row.type === type);
    return { data, total: data.length, nextCursor: null };
  });
});

it.each((['Client Admin', 'Sales'] as const).flatMap(role => (['leads', 'contacts', 'accounts', 'deals'] as const).map(module => ({ role, module }))))('preserves $role Task panel access from $module', async ({ role, module }) => {
  mocks.role = role; mocks.edit = true;
  render(<CrmRecordView module={module} id="record" />);
  const tasks = await screen.findByTestId('related-tasks');
  expect(tasks.getAttribute('data-readonly')).toBe(String(role !== 'Client Admin' && module !== 'deals'));
  expect(tasks.getAttribute('data-create')).toBe(String(module === 'deals'));
});

it.each(['panel', 'page'] as const)('removes duplication while preserving Edit and Archive in the Deal %s menu', async surface => {
  mocks.edit = true;
  render(surface === 'panel' ? <CrmRecordPanel module="deals" id="record" open onOpenChange={mocks.close} /> : <CrmRecordView module="deals" id="record" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Edit deal', 'Archive deal']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit deal' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Details/ }).getAttribute('aria-selected')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: 'Record actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Archive deal' }));
  expect(await screen.findByRole('heading', { name: 'Archive Deal' })).toBeTruthy();
});

it.each(['leads', 'contacts', 'deals'] as const)('pauses a disconnected %s timeline stream and recovers through explicit retry', async module => {
  render(<CrmRecordView module={module} id="record" />);
  await screen.findByRole('heading', { name: module === 'deals' ? 'Customer Deal' : 'Customer Test' });
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity1'));
  await waitFor(() => expect(streams).toHaveLength(1));
  const timeline = screen.getByRole('region', { name: 'Activity Timeline' });
  fireEvent.click(screen.getByRole('button', { name: 'Emails' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity0'));
  const failures = ['Mailbox ownership does not match, or temporary test access expired.', 'Email updates paused after repeated failures.', 'Connect your work Gmail account first.'];
  for (const [index, failure] of failures.entries()) {
    mocks.status = { isConnected: false, syncError: failure };
    if (index === 0) act(() => streams[0].dispatchEvent(new Event('mailbox-change')));
    else fireEvent.click(within(timeline).getByRole('button', { name: 'Retry activities' }));
    await waitFor(() => expect(within(timeline).getByRole('alert').textContent).toBe(failure));
    await waitFor(() => expect(streams[0].close).toHaveBeenCalled());
    expect(streams).toHaveLength(1);
    expect(within(timeline).queryByText('No activities match your filter.')).toBeNull();
  }
  mocks.status = { isConnected: true, syncError: null }; rows.push(email('inbound'));
  const reads = mocks.getAll.mock.calls.length;
  act(() => streams[0].dispatchEvent(new Event('mailbox-change')));
  expect(mocks.getAll).toHaveBeenCalledTimes(reads);
  fireEvent.click(within(timeline).getByRole('button', { name: 'Retry activities' }));
  await waitFor(() => expect(within(timeline).getByText('Persisted inbound body')).toBeTruthy());
  await waitFor(() => expect(streams).toHaveLength(2));
  expect(within(timeline).queryByRole('alert')).toBeNull();
  rows.push(email('outbound'));
  act(() => streams[1].dispatchEvent(new Event('mailbox-change')));
  await waitFor(() => expect(within(timeline).getByText('Persisted outbound body')).toBeTruthy());
  expect(screen.getByRole('region', { name: 'Activity Timeline' })).toBe(timeline);
  expect(screen.getByRole('button', { name: 'Emails' }).getAttribute('aria-pressed')).toBe('true');
});
afterEach(() => { cleanup(); clearPageCache(); vi.unstubAllGlobals(); });

const cases = (['leads', 'contacts', 'deals'] as const).flatMap(module => (['panel', 'page'] as const).flatMap(surface => (['All', 'Emails'] as const).map(filter => ({ module, surface, filter }))));
it.each(cases)('keeps the $module $surface mounted on $filter while sent and received Activities update rows and badge', async ({ module, surface, filter }) => {
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="record" open onOpenChange={mocks.close} /> : <CrmRecordView module={module} id="record" />);
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity1'));
  if (filter === 'Emails') {
    fireEvent.click(screen.getByRole('button', { name: 'Emails' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity0'));
  }
  const timeline = screen.getByRole('region', { name: 'Activity Timeline' });
  const badge = screen.getByRole('tab', { name: /^Activity/ });
  // Activity rows and Gmail connection status load independently.
  await waitFor(() => expect(streams).toHaveLength(1));
  for (const [index, direction] of (['outbound', 'inbound'] as const).entries()) {
    rows = [...rows, email(direction)];
    act(() => streams[0].dispatchEvent(new Event('mailbox-change')));
    await waitFor(() => expect(within(timeline).getByText(`Persisted ${direction} body`)).toBeTruthy());
    await waitFor(() => expect(badge.textContent).toBe(`Activity${index + (filter === 'All' ? 2 : 1)}`));
    expect(within(timeline).getByText(`Persisted ${direction} body`).closest('[data-email-body]')?.classList.contains('inbox-message-typography')).toBe(true);
    expect(within(timeline).getByText(direction === 'inbound' ? 'Received' : 'Sent')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Activity Timeline' })).toBe(timeline);
    expect(screen.getByRole('tab', { name: /^Activity/ })).toBe(badge);
    expect(badge.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: filter }).getAttribute('aria-pressed')).toBe('true');
  }
  act(() => { streams[0].dispatchEvent(new Event('mailbox-change')); streams[0].dispatchEvent(new Event('mailbox-change')); });
  await waitFor(() => expect(within(timeline).getAllByText('Persisted inbound body')).toHaveLength(1));
  expect(mocks.get.mock.calls.filter(([path]) => path === `/crm/${module}/record`)).toHaveLength(1);
  expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
});

it('clears revoked email immediately while preserving the selected Emails filter and an unfinished note', async () => {
  mocks.edit = true; rows.push(email('outbound'));
  render(<CrmRecordView module="leads" id="record" />);
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity2'));
  await waitFor(() => expect(streams).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Emails' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity1'));
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Keep my unfinished note' } });
  let release!: () => void;
  const waiting = new Promise<void>(done => { release = done; });
  mocks.getAll.mockImplementation(async ({ type }: { type?: string }) => {
    await waiting;
    const data = [note].filter(row => !type || row.type === type);
    return { data, total: data.length, nextCursor: null };
  });
  act(() => streams[0].dispatchEvent(new Event('mailbox-access-changed')));
  expect(screen.queryByText('Persisted outbound body')).toBeNull();
  expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Keep my unfinished note');
  expect(screen.getByRole('button', { name: 'Emails' }).getAttribute('aria-pressed')).toBe('true');
  await act(async () => release());
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity0'));
  expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Keep my unfinished note');
});

const fileCases = (['leads', 'contacts', 'deals'] as const).flatMap(module => (['panel', 'page'] as const).map(surface => ({ module, surface })));
it('retains visible email files while older attachments load and reuses the cached first page', async () => {
  const originalGet = mocks.get.getMockImplementation()!;
  const file = { id: 'first', accountId: 'account', messageId: 'sent', attachmentId: 'part', name: 'first.pdf', type: 'application/pdf', sentAt: '2026-10-18T00:00:00Z' };
  const reads: (string | undefined)[] = [];
  let finish!: () => void;
  mocks.get.mockImplementation(async (path: string, options?: { params?: { cursor?: string } }) => {
    if (!path.endsWith('/email-attachments')) return originalGet(path);
    reads.push(options?.params?.cursor);
    if (!options?.params?.cursor) return { data: { attachments: [file], nextCursor: 'older-page' } };
    await new Promise<void>(resolve => { finish = resolve; });
    return { data: { attachments: [{ ...file, id: 'older', name: 'older.pdf', messageId: 'older' }] } };
  });
  render(<CrmRecordView module="contacts" id="record" />);
  await screen.findByRole('tab', { name: 'Files' });
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
  await screen.findByText('first.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Load older attachments' }));
  await waitFor(() => expect(reads).toEqual([undefined, 'older-page']));
  expect(screen.getByText('first.pdf')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Loading older attachments…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish());
  await screen.findByText('older.pdf'); expect(screen.getAllByText('first.pdf')).toHaveLength(1);
  expect(reads).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Load older attachments' })).toBeNull();
});

it.each(fileCases)('combines original file rows in the $module $surface, refreshes without duplicates and removes revoked Gmail entries', async ({ module, surface }) => {
  mocks.files = [{ id: 'manual', name: 'manual.pdf', size: 1024, type: 'application/pdf', uploadedAt: '2026-10-01T00:00:00Z', url: '/manual-download' }];
  const quotation = { id: 'same-original', accountId: 'account', messageId: 'sent-message', attachmentId: 'pdf-part', name: 'quotation.pdf', type: 'application/pdf', size: 20173, sentAt: '2026-10-18T00:00:00Z' };
  mocks.emailFiles = [quotation, quotation];
  render(surface === 'panel' ? <CrmRecordPanel module={module} id="record" open onOpenChange={mocks.close} /> : <CrmRecordView module={module} id="record" />);
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity1'));
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
  await screen.findByText('manual.pdf'); await screen.findByText('quotation.pdf');
  expect(screen.getAllByText('quotation.pdf')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Download manual.pdf' }).getAttribute('href')).toBe('/manual-download');
  expect(screen.getByRole('button', { name: 'Preview quotation.pdf' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Delete quotation.pdf' })).toBeNull();
  mocks.emailFiles = [quotation, { ...quotation, id: 'received', messageId: 'received-message', name: 'received.pdf' }];
  await waitFor(() => expect(streams).toHaveLength(1));
  act(() => streams[0].dispatchEvent(new Event('mailbox-change')));
  await screen.findByText('received.pdf');
  expect(screen.getAllByText('quotation.pdf')).toHaveLength(1);
  mocks.emailDenied = true;
  act(() => streams[0].dispatchEvent(new Event('mailbox-access-changed')));
  await waitFor(() => expect(screen.queryByText('quotation.pdf')).toBeNull());
  expect(screen.queryByText('received.pdf')).toBeNull();
  expect(screen.getByText('manual.pdf')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Mailbox access revoked');
  expect(screen.getByRole('tab', { name: /^Activity/ }).textContent).toBe('Activity1');
  expect(mocks.get.mock.calls.some(([path]) => path === `/crm/${module}/record/email-attachments`)).toBe(true);
});

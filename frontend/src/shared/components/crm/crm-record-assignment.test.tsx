import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmRecordView } from './crm-record-view';
import { clearPageCache } from '@/shared/cache/page-cache';
import { useCachedPage } from '@/shared/hooks/use-cached-page';

vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'admin', role: 'Client Admin' }, isLoading: false, authError: null }) }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ activities: [], users: [], pipelines: [], deals: [], contacts: [], organizations: [] }) }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true, canReassign: true }) }));
vi.mock('@/features/tenant/notifications/hooks/use-record-notifications', () => ({ useReadRecordNotifications: () => {} }));
vi.mock('@/shared/hooks/use-record-activities', () => ({ useRecordActivities: () => ({ activities: [], total: 0, refetch: vi.fn() }) }));
vi.mock('@/shared/hooks/use-field-layout', async () => {
  const { defaultFieldLayout } = await import('@leadcrm/shared');
  return { useFieldLayout: (module: Parameters<typeof defaultFieldLayout>[0]) => ({ layout: defaultFieldLayout(module) }) };
});
vi.mock('./record-custom-fields', () => ({ useRecordCustomFieldDetails: () => ({ fields: [], query: { error: null } }), RecordCustomFieldInlineRow: () => null }));
vi.mock('./deal-closing-requirements', () => ({ DealClosingRequirements: () => null }));
vi.mock('./inline-deal-form', () => ({ InlineDealForm: () => null }));
vi.mock('./deal-card-menu', () => ({ DealCardMenu: () => null }));
vi.mock('./record-timeline-tab', () => ({ RecordTimelineTab: () => null }));
vi.mock('@/features/tenant/crm/leads/ui/convert-lead-dialog', () => ({ ConvertLeadDialog: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/shared/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: ({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) =>
  <select aria-label="Choose agent" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="old">Previous Agent</option><option value="next">Next Agent</option></select> }));

let assignedUserId: string, reject: boolean;
const customer = () => ({ id: 'person', firstName: 'Customer', lastName: 'Example', assignedUserId,
  assignedUser: { id: assignedUserId, firstName: assignedUserId === 'old' ? 'Previous' : 'Next', lastName: 'Agent' },
  status: 'Warm', productInterest: [], productInterests: [], updatedAt: '2026-11-11T00:00:00Z' });
const deal = () => ({ ...customer(), id: 'deal', title: 'Associated Deal', pipelineId: 'pipeline', stage: { name: 'Lead' }, leadDeals: [], contactDeals: [] });
const requests: string[] = [];
beforeEach(() => {
  clearPageCache(); assignedUserId = 'old'; reject = false; requests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname.replace('/api/proxy', '');
    requests.push(`${options?.method} ${path}`);
    if (options?.method === 'PUT') {
      if (reject) return Response.json({ success: false, error: 'Cannot synchronize Assigned Agent: an associated Deal is shared or independently assigned.' }, { status: 409 });
      assignedUserId = JSON.parse(options.body as string).assignedUserId;
      return Response.json({ success: true, data: customer() });
    }
    if (path.endsWith('/relationships')) return Response.json({ data: { deals: [deal()], hasMoreDeals: false } });
    if (path === '/crm/deals/deal') return Response.json({ data: deal() });
    if (path === '/crm/deals' || path === '/crm/pipelines/fixture') return Response.json({ data: [deal()] });
    if (path === '/crm/leads/person' || path === '/crm/contacts/person') return Response.json({ data: customer() });
    throw new Error(`Unexpected request: ${path}`);
  }));
});
afterEach(() => { cleanup(); clearPageCache(); vi.unstubAllGlobals(); });

// Exercise mounted list/board readers through the real cache and API invalidation.
function AssignmentList({ module }: { module: 'deals' | 'pipeline' }) {
  const query = useCachedPage<{ assignedUserId: string }[]>({ module, params: {}, disabled: false, revalidateOnInvalidation: true,
    fetchFn: async () => (await (await fetch(`/api/proxy/crm/${module === 'deals' ? 'deals' : 'pipelines/fixture'}`)).json()).data });
  return <output data-testid={module}>{query.data?.[0]?.assignedUserId}</output>;
}
const cases = (['leads', 'contacts'] as const).flatMap(module => (['panel', 'page'] as const).map(surface => ({ module, surface })));

it.each(cases)('refreshes $module $surface, relationships, Deal details, lists and Pipeline after an inline assignment', async ({ module, surface }) => {
  render(<>
    <section data-testid="source"><CrmRecordView module={module} id="person" initialTab="details" onClose={surface === 'panel' ? vi.fn() : undefined} /></section>
    <section data-testid="deal-detail"><CrmRecordView module="deals" id="deal" initialTab="details" /></section>
    <AssignmentList module="deals" /><AssignmentList module="pipeline" />
  </>);
  const source = within(screen.getByTestId('source')), details = within(screen.getByTestId('deal-detail'));
  await source.findByRole('heading', { name: 'Customer Example' });
  await details.findByText('Agent: Previous Agent');
  await source.findByRole('link', { name: /Associated Deal/ });
  await waitFor(() => expect(screen.getByTestId('pipeline').textContent).toBe('old'));
  const relationships = requests.filter(path => path.endsWith('/relationships')).length;
  const tab = source.getByRole('tab', { name: /^Details/ });
  fireEvent.click(source.getByRole('button', { name: 'Edit Assigned Agent' }));
  fireEvent.change(source.getByRole('combobox', { name: 'Choose agent' }), { target: { value: 'next' } });
  fireEvent.click(source.getByRole('button', { name: 'Save' }));
  await source.findByText('Agent: Next Agent');
  await details.findByText('Agent: Next Agent');
  await waitFor(() => {
    expect(screen.getByTestId('deals').textContent).toBe('next');
    expect(screen.getByTestId('pipeline').textContent).toBe('next');
    expect(requests.filter(path => path.endsWith('/relationships')).length).toBeGreaterThan(relationships);
    expect(source.queryByRole('combobox', { name: 'Choose agent' })).toBeNull();
  });
  expect(source.getByRole('tab', { name: /^Details/ })).toBe(tab);
  expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(requests.filter(path => path.startsWith('PUT '))).toEqual([`PUT /crm/${module}/person`]);
});

it.each(cases)('retains the $module $surface editor and saved views when ownership synchronization is rejected', async ({ module, surface }) => {
  reject = true;
  render(<section data-testid="source"><CrmRecordView module={module} id="person" initialTab="details" onClose={surface === 'panel' ? vi.fn() : undefined} /><AssignmentList module="pipeline" /></section>);
  const source = within(screen.getByTestId('source'));
  await source.findByText('Agent: Previous Agent');
  await source.findByRole('link', { name: /Associated Deal/ });
  await waitFor(() => expect(screen.getByTestId('pipeline').textContent).toBe('old'));
  const reads = requests.filter(path => !path.startsWith('PUT ')).length;
  fireEvent.click(source.getByRole('button', { name: 'Edit Assigned Agent' }));
  fireEvent.change(source.getByRole('combobox', { name: 'Choose agent' }), { target: { value: 'next' } });
  fireEvent.click(source.getByRole('button', { name: 'Save' }));
  await source.findByText(/an associated Deal is shared or independently assigned/);
  expect((source.getByRole('combobox', { name: 'Choose agent' }) as HTMLSelectElement).value).toBe('next');
  expect(source.getByText('Agent: Previous Agent')).toBeTruthy();
  expect(screen.getByTestId('pipeline').textContent).toBe('old');
  expect(requests.filter(path => !path.startsWith('PUT '))).toHaveLength(reads);
});

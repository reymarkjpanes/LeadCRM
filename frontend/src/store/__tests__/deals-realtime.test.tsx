import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataProvider, useData } from '../DataContext';
import { clearPageCache, invalidatePageCache } from '@/shared/cache/page-cache';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { apiClient } from '@/lib/api/client';
import { toFrontendDeal } from '@/lib/api/adapters/deal.adapter';
import { PipelineKanbanBoard } from '@/features/tenant/crm/pipeline/ui/pipeline-kanban-board';
import type { Deal, Pipeline } from '../types';
import { useTasks } from '@/features/tenant/operations/tasks/use-tasks';
import { RelatedTasks } from '@/features/tenant/operations/tasks/ui/related-tasks';

const state = vi.hoisted(() => ({ id: 'actor', tenant: 'tenant', denied: false }));
vi.mock('../AuthContext', () => ({ useAuth: () => ({
  user: { id: state.id, role: 'Staff', status: 'ACTIVE' }, tenant: { id: state.tenant },
  permissions: { tasks: { canView: true, canEdit: true, canCreate: true } }, isPermissionsLoaded: true,
  userCan: (module: string) => !(state.denied && module === 'deals'), isLoading: false,
}) }));
vi.mock('@/lib/config', () => ({ USE_MOCK_DATA: false }));
vi.mock('@/shared/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/shared/hooks/use-crm-record-access', () => ({ useCrmRecordAccess: () => ({ canMutate: () => true }) }));
vi.mock('@/shared/components/crm/deal-card-menu', () => ({ DealCardMenu: () => null }));

class Events extends EventTarget {
  static sources: Events[] = [];
  closed = false;
  constructor(public url: string) { super(); Events.sources.push(this); }
  close() { this.closed = true; }
  emit(type: string, revision = '1') { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ content: revision }) })); }
}
const pipeline = { id: 'pipeline', name: 'Sales', stages: [
  { id: 'lead', name: 'Lead', order: 0, probability: 0, isDefault: true },
  { id: 'lost', name: 'Lost', order: 1, probability: 0, isLost: true },
  { id: 'qualified', name: 'Qualified', order: 2, probability: 50 },
] } as Pipeline;
const row = (stageId = 'lead') => ({ id: 'deal', title: 'Live opportunity', tenantId: state.tenant, pipelineId: pipeline.id, stageId, value: 1000, priority: 'HIGH' });
let rows = [row()];
let intercept: ((url: URL, init?: RequestInit) => Promise<Response> | undefined) | undefined;
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, meta: { hasMore: false } }), { status, headers: { 'Content-Type': 'application/json' } });
const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
  const url = new URL(path, 'http://localhost');
  const held = intercept?.(url, init); if (held) return held;
  if (url.pathname.endsWith('/crm/deals')) return response(rows);
  if (url.pathname.endsWith('/crm/pipelines')) return response([pipeline]);
  return response([]);
});
const sharedReads = () => fetcher.mock.calls.filter(([path]) => { const url = new URL(path, 'http://localhost'); return url.pathname.endsWith('/crm/deals') && !url.searchParams.has('pipelineId'); }).length;
const source = () => [...Events.sources].reverse().find(source => source.url.endsWith('/record-events') && !source.closed)!;

function View({ board = false }: { board?: boolean }) {
  const { deals, refreshDeals, updateDeal, moveDealStage, moveDealPipeline } = useData();
  const query = useCachedPage<Deal[]>({ module: 'deals', params: { pipelineId: pipeline.id }, disabled: !board,
    revalidateOnInvalidation: true, fetchFn: async signal => (await apiClient.get<{ data: object[] }>('/crm/deals', { params: { pipelineId: pipeline.id }, signal })).data.map(toFrontendDeal) });
  return <><output data-testid="shared">{deals.map(deal => `${deal.id}:${deal.stageId}`).join(',')}</output>
    <button onClick={() => { void refreshDeals(); void refreshDeals(); }}>Refresh shared</button>
    <button onClick={() => { void updateDeal('deal', { title: 'Updated Deal' }); }}>Update shared</button>
    <button onClick={() => { void moveDealStage('deal', 'qualified'); }}>Move shared stage</button>
    <button onClick={() => { void moveDealPipeline('deal', { pipelineId: pipeline.id, stageId: 'qualified' }); }}>Move shared pipeline</button>
    {board && <>
      <PipelineKanbanBoard pipeline={pipeline} deals={query.data ?? []} users={[]} canEdit={false} canDelete={false}
        onDealClick={vi.fn()} onDealDragEnd={vi.fn()} onAddDeal={vi.fn()} onLoadMore={vi.fn()} loadingStages={new Set()} hasMoreByStage={{}} /></>}</>;
}
function TaskView() {
  const tasks = useTasks();
  const detail = useCachedPage<{ id: string }>({ module: 'tasks', params: { recordId: 'task' }, disabled: false,
    revalidateOnInvalidation: true, fetchFn: async signal => (await apiClient.get<{ data: { id: string } }>('/operations/tasks/task', { signal })).data });
  return <><output data-testid="task-rows">{tasks.tasks.map(task => task.id).join(',')}</output>
    <output data-testid="task-total">{tasks.summary?.total}</output>
    <output data-testid="task-detail">{detail.data?.id}</output>
    <output data-testid="task-refresh">{tasks.refreshing || detail.isRefreshing ? 'refreshing' : 'settled'}</output></>;
}
beforeEach(() => {
  state.id = 'actor'; state.tenant = 'tenant'; state.denied = false; rows = [row()]; intercept = undefined;
  clearPageCache(); localStorage.clear(); Events.sources = []; fetcher.mockClear();
  vi.stubGlobal('EventSource', Events); vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); clearPageCache(); vi.unstubAllGlobals(); });

it('retains Task rows, summaries and details on a failed content refresh, then evicts on access denial', async () => {
  let revoked = false;
  let status = 503;
  intercept = url => {
    if (!url.pathname.includes('/operations/tasks')) return undefined;
    if (revoked) return Promise.resolve(response([], status));
    if (url.pathname.endsWith('/summary')) return Promise.resolve(response({ total: 1 }));
    if (url.pathname.endsWith('/task')) return Promise.resolve(response({ id: 'task' }));
    return Promise.resolve(response([{ id: 'task' }]));
  };
  render(<DataProvider><TaskView /></DataProvider>);
  await waitFor(() => {
    expect(screen.getByTestId('task-rows').textContent).toBe('task');
    expect(screen.getByTestId('task-total').textContent).toBe('1');
    expect(screen.getByTestId('task-detail').textContent).toBe('task');
  });
  revoked = true;
  act(() => source().emit('crm-change'));
  await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.includes('/operations/tasks/task'))).toHaveLength(2));
  await waitFor(() => expect(screen.getByTestId('task-refresh').textContent).toBe('settled'));
  expect(screen.getByTestId('task-rows').textContent).toBe('task');
  expect(screen.getByTestId('task-total').textContent).toBe('1');
  expect(screen.getByTestId('task-detail').textContent).toBe('task');
  status = 403;
  act(() => source().emit('crm-change', '2'));
  await waitFor(() => {
    expect(screen.getByTestId('task-rows').textContent).toBe('');
    expect(screen.getByTestId('task-total').textContent).toBe('');
    expect(screen.getByTestId('task-detail').textContent).toBe('');
  });
});

it('updates Qualified stage, High priority badge and counts through crm-change without a manual refresh', async () => {
  rows = [{ ...row(), priority: 'MEDIUM' }];
  render(<DataProvider><View board /></DataProvider>);
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lead'));
  await screen.findByText('Live opportunity');
  expect(screen.getByText('Medium')).toBeTruthy();
  const before = sharedReads();
  rows = [row('qualified')];
  act(() => { source().emit('crm-change'); source().emit('crm-change'); source().emit('crm-change'); });
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:qualified'));
  const qualifiedColumn = screen.getByRole('heading', { name: 'Qualified' }).closest('.p-4')!.parentElement!;
  const leadColumn = screen.getByRole('heading', { name: 'Lead' }).closest('.p-4')!.parentElement!;
  await waitFor(() => expect(within(qualifiedColumn).getByText('Live opportunity')).toBeTruthy());
  expect(within(qualifiedColumn).getByText('High')).toBeTruthy();
  expect(screen.queryByText('Medium')).toBeNull();
  expect(within(leadColumn).queryByText('Live opportunity')).toBeNull();
  expect(within(leadColumn).getByText('0', { exact: true })).toBeTruthy();
  expect(within(qualifiedColumn).getByText('1', { exact: true })).toBeTruthy();
  expect(sharedReads() - before).toBe(1);
  // Duplicate revisions must not refetch, including after reconciliation completed.
  act(() => source().emit('crm-change'));
  expect(sharedReads() - before).toBe(1);
  // The server sends its current snapshot on every SSE reconnect.
  act(() => { source().emit('open'); source().emit('crm-change'); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  expect(sharedReads() - before).toBe(1);
});

it.each(['edit', 'create'] as const)('keeps the real %s Task editor mounted through content events and recoverable read failures', async mode => {
  let failed = false, release: ((value: Response) => void) | undefined;
  let saved = {
    id: 'task', tenantId: 'tenant', title: 'Follow up', description: 'Saved notes', status: 'pending', priority: 'Medium',
    assignedUserId: 'actor', createdById: 'actor', dueDate: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', dealIds: ['deal'],
  };
  intercept = (url, init) => {
    if (!url.pathname.includes('/operations/tasks')) return undefined;
    if (url.pathname.endsWith('/options')) return Promise.resolve(response([{ id: 'deal', label: 'Linked Deal' }]));
    if (url.pathname.endsWith('/task') && init?.method === 'PUT') {
      const input = JSON.parse(String(init.body));
      saved = { ...saved, title: input.title, updatedAt: '2026-01-02T00:00:00.000Z' };
      return Promise.resolve(response(saved));
    }
    if (url.pathname.endsWith('/task') && failed) return new Promise(resolve => { release = resolve; });
    if (url.pathname.endsWith('/task')) return Promise.resolve(response(saved));
    if (url.pathname.endsWith('/summary')) return Promise.resolve(response({ total: 1, active: 1 }));
    return Promise.resolve(response([saved]));
  };
  render(<DataProvider><RelatedTasks links={{ dealId: 'deal' }} allowCreate readOnly={false} /></DataProvider>);
  await screen.findByRole('button', { name: /Follow up/ });
  if (mode === 'edit') {
    fireEvent.click(screen.getByRole('button', { name: /Follow up/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Task actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
  } else fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  const input = mode === 'edit' ? screen.getByRole('textbox', { name: 'Title' }) : screen.getByLabelText('Title *');
  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  failed = true;
  act(() => source().emit('crm-change'));
  if (mode === 'edit') {
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(input.isConnected).toBe(true);
    expect(input).toHaveProperty('value', 'Keep this draft');
    await act(async () => release!(response([], 503)));
    await screen.findByRole('button', { name: 'Retry loading task' });
  } else await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.includes('/operations/tasks/summary')).length).toBeGreaterThan(1));
  expect(input.isConnected).toBe(true);
  expect(input).toHaveProperty('value', 'Keep this draft');
  expect(screen.queryByRole('status', { name: /Refreshing/ })).toBeNull();
  if (mode === 'edit') {
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading task' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry loading task' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull());
    await screen.findByRole('heading', { name: 'Keep this draft' });
    expect(fetcher.mock.calls.filter(([path, init]) => path.endsWith('/operations/tasks/task') && init?.method === 'PUT')).toHaveLength(1);
    expect(saved.dealIds).toEqual(['deal']);
    await screen.findByRole('button', { name: /Keep this draft/ });
  }
});

it('coalesces bootstrap/manual reads and ignores an old bootstrap after a newer revision', async () => {
  let release!: (response: Response) => void; let held = false;
  intercept = url => {
    if (url.pathname.endsWith('/crm/deals') && !held) { held = true; return new Promise(resolve => { release = resolve; }); }
  };
  render(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.click(screen.getByText('Refresh shared')); expect(sharedReads()).toBe(1);
  rows = [row('lost')]; act(() => source().emit('crm-change'));
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lost'));
  await act(async () => { release(response([row('lead')])); });
  expect(screen.getByTestId('shared').textContent).toBe('deal:lost');
});

it('retains pipeline revisions across reconnects and removes its recovery listeners on unmount', async () => {
  const view = render(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lead'));
  const stream = Events.sources.find(entry => entry.url.endsWith('/pipelines/events'))!;
  const reads = () => fetcher.mock.calls.filter(([path]) => path.endsWith('/crm/pipelines')).length;
  const initial = reads();
  await act(async () => stream.emit('pipeline-change', '1'));
  expect(reads()).toBe(initial + 1);
  await act(async () => { stream.emit('open'); stream.emit('pipeline-change', '1'); });
  expect(reads()).toBe(initial + 1);
  await act(async () => stream.emit('pipeline-change', '2'));
  expect(reads()).toBe(initial + 2);
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(reads()).toBe(initial + 3);
  view.unmount();
  expect(Events.sources.every(entry => entry.closed)).toBe(true);
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
  expect(reads()).toBe(initial + 3);
});

it('rejects pre-mutation responses, retains data on transport errors, and clears it on access loss', async () => {
  render(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lead'));
  let release!: (response: Response) => void;
  intercept = url => url.pathname.endsWith('/crm/deals') ? new Promise(resolve => { release = resolve; }) : undefined;
  fireEvent.click(screen.getByText('Refresh shared')); await waitFor(() => expect(release).toBeTypeOf('function'));
  invalidatePageCache('deals', 'tenant');
  await act(async () => { release(response([row('lost')])); });
  expect(screen.getByTestId('shared').textContent).toBe('deal:lead');
  intercept = url => url.pathname.endsWith('/crm/deals') ? Promise.resolve(response([], 503)) : undefined;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  fireEvent.click(screen.getByText('Refresh shared'));
  await waitFor(() => expect(log).toHaveBeenCalled()); log.mockRestore();
  expect(screen.getByTestId('shared').textContent).toBe('deal:lead');
  act(() => source().emit('crm-access-changed'));
  expect(screen.getByTestId('shared').textContent).toBe('');
  expect(source()).toBeUndefined();
});

it('discards shared Deal rows on an authorization eviction and ignores the previous scope response', async () => {
  render(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lead'));
  let previous!: (response: Response) => void;
  let current!: (response: Response) => void;
  let requests = 0;
  intercept = url => {
    if (!url.pathname.endsWith('/crm/deals')) return undefined;
    requests++;
    return new Promise(resolve => { if (requests === 1) previous = resolve; else current = resolve; });
  };
  fireEvent.click(screen.getByText('Refresh shared'));
  await waitFor(() => expect(previous).toBeTypeOf('function'));
  act(() => clearPageCache(true));
  expect(screen.getByTestId('shared').textContent).toBe('');
  await waitFor(() => expect(current).toBeTypeOf('function'));
  await act(async () => previous(response([row('lost')])));
  expect(screen.getByTestId('shared').textContent).toBe('');
  await act(async () => current(response([row('qualified')])));
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:qualified'));
});

it.each([
  { button: 'Update shared', path: '/crm/deals/deal', nested: false },
  { button: 'Move shared stage', path: '/crm/deals/deal/stage', nested: true },
  { button: 'Move shared pipeline', path: '/crm/deals/deal/pipeline', nested: true },
])('ignores a delayed $button result after the authorized scope changed', async ({ button, path, nested }) => {
  render(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lead'));
  let release!: (response: Response) => void;
  intercept = (url, init) => url.pathname.endsWith(path) && init?.method !== 'GET'
    ? new Promise(resolve => { release = resolve; }) : undefined;
  fireEvent.click(screen.getByText(button));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  rows = [];
  act(() => clearPageCache(true));
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe(''));
  await act(async () => release(response(nested ? { deal: row('lost') } : row('lost'))));
  expect(screen.getByTestId('shared').textContent).toBe('');
});

it('discards responses from a previous identity and catches up after reconnect or focus', async () => {
  let release!: (response: Response) => void; let held = false;
  intercept = url => url.pathname.endsWith('/crm/deals') && !held ? (held = true, new Promise(resolve => { release = resolve; })) : undefined;
  const view = render(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  state.id = 'next-actor'; state.tenant = 'next-tenant'; rows = [row('lost')];
  view.rerender(<DataProvider><View /></DataProvider>);
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lost'));
  await act(async () => release(response([row('lead')])));
  expect(screen.getByTestId('shared').textContent).toBe('deal:lost');
  rows = [row('lead')]; act(() => { source().emit('open'); source().emit('crm-change'); });
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lead'));
  rows = [row('lost')]; act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(screen.getByTestId('shared').textContent).toBe('deal:lost'));
});

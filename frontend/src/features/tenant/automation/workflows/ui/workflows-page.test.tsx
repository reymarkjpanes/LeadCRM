import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import WorkflowsPage from './workflows-page';
import { getWorkflowMetadata, workflowsApi, type WorkflowsResponse } from '@/shared/services/workflows.api';
import { clearPageCache } from '@/shared/cache/page-cache';

const push = vi.fn();
const auth = vi.hoisted(() => ({ canCreate: true, canView: true }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'user', }, userCan: (_module: string, action: string) => action === 'canCreate' ? auth.canCreate : action === 'canView' ? auth.canView : true }) }));
vi.mock('./workflow-execution-log-modal', () => ({ WorkflowExecutionLogModal: () => <div>Run history</div> }));
vi.mock('@/shared/services/workflows.api', () => ({
  getWorkflowMetadata: vi.fn(),
  withWorkflowTimeout: <T,>(request: Promise<T>) => request,
  workflowsApi: { get: vi.fn(), list: vi.fn(), create: vi.fn(), duplicate: vi.fn(), toggle: vi.fn(), archive: vi.fn(), nameAvailability: vi.fn(), options: vi.fn() },
}));
const workflow = { id: 'wf', name: 'Follow up', trigger: 'lead.created', status: 'ACTIVE', isActive: true, conditions: null, actions: [] };
const emptyPage: WorkflowsResponse = { success: true, data: [], meta: { total: 0, page: 1, limit: 10, hasMore: false } };
beforeEach(() => {
  clearPageCache(); vi.clearAllMocks();
  auth.canCreate = true; auth.canView = true;
  vi.mocked(getWorkflowMetadata).mockResolvedValue({ triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions() });
  vi.mocked(workflowsApi.options).mockResolvedValue({ success: true, data: { users: [], pipelines: [], templates: [], campaigns: [] } });
  vi.mocked(workflowsApi.nameAvailability).mockResolvedValue({ success: true, data: { available: false, suggestedName: 'Follow up (Copy)' } });
  vi.mocked(workflowsApi.get).mockResolvedValue({ data: workflow } as never);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.mocked(workflowsApi.list).mockImplementation(async query => ({ success: true, data: [{ ...workflow, id: `wf${query?.page}` }], meta: { total: query?.status ? 1 : 31, page: query?.page ?? 1, limit: query?.limit ?? 10, hasMore: true } }) as never);
});
afterEach(() => { cleanup(); clearPageCache(); vi.unstubAllGlobals(); });

it('opens the chosen template at its original catalog index and supports starting from scratch', async () => {
  Element.prototype.scrollTo = vi.fn();
  render(<WorkflowsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: /Create workflow/i }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Deal Entered a Specific Stage' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview Deal Entered a Specific Stage' }));
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  expect(push).toHaveBeenCalledExactlyOnceWith('/automation/workflows/new?template=25');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Create workflow/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }));
  expect(push).toHaveBeenLastCalledWith('/automation/workflows/new');
});

it('requests server pages and sizes, uses real totals, and resets filtered pagination', async () => {
  render(<WorkflowsPage />);
  await screen.findByRole('grid');
  expect(screen.getByText('Page 1 of 4')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Next page'));
  await waitFor(() => expect(workflowsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 10 })));
  await screen.findByText('Page 2 of 4');
  fireEvent.click(screen.getByLabelText('Records per page'));
  fireEvent.click(screen.getByRole('option', { name: '20' }));
  await screen.findByText('Page 1 of 2');
  expect(workflowsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  fireEvent.click(screen.getByRole('button', { name: 'Filter Workflows' }));
  expect(screen.queryByText('Client Profile created')).toBeNull();
  fireEvent.click(screen.getAllByLabelText('Filter by Active')[0]);
  await screen.findByText('Page 1 of 1');
  expect(workflowsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'ACTIVE' }));
  expect((screen.getByLabelText('Next page') as HTMLButtonElement).disabled).toBe(true);
});

it('wires menus to view, edit, duplicate, pause, resume and confirmed archive', async () => {
  render(<WorkflowsPage />); await screen.findByRole('grid');
  const action = (name: string) => { fireEvent.click(screen.getByRole('button', { name: 'Row actions' })); fireEvent.click(screen.getByRole('menuitem', { name })); };
  action('View'); expect(screen.getByText('Run history')).toBeTruthy(); expect(push).not.toHaveBeenCalled();
  action('Edit'); expect(push).toHaveBeenCalledWith('/automation/workflows/wf1/edit');
  action('Duplicate');
  await waitFor(() => expect(workflowsApi.duplicate).toHaveBeenCalledWith('wf1'));
  await waitFor(() => expect(screen.queryByText('Refreshing data')).toBeNull());
  vi.mocked(workflowsApi.list).mockResolvedValue({ success: true, data: [{ ...workflow, id: 'wf1', isActive: false, status: 'PAUSED' }], meta: { total: 1, page: 1, limit: 10, hasMore: false } } as never);
  action('Pause');
  expect(workflowsApi.toggle).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('alertdialog', { name: 'Pause workflow?' }), { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(workflowsApi.toggle).not.toHaveBeenCalled();
  action('Pause');
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Pause workflow?' })).getByRole('button', { name: 'Pause workflow' }));
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledExactlyOnceWith('wf1', false));
  await screen.findByText('Paused');
  action('Resume');
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Activate workflow' }));
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledWith('wf1', true));
  await screen.findByRole('grid');
  await waitFor(() => expect((screen.getByLabelText('Resume workflow') as HTMLButtonElement).disabled).toBe(false));
  action('Archive');
  expect(workflowsApi.archive).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(workflowsApi.archive).toHaveBeenCalledWith('wf1'));
});
it('bulk Pause skips already-paused rows and processes active rows', async () => {
  vi.mocked(workflowsApi.list).mockResolvedValue({ success: true, data: [workflow, { ...workflow, id: 'paused', isActive: false }], meta: { total: 2, page: 1, limit: 10 } } as never);
  vi.mocked(workflowsApi.get).mockImplementation(async id => ({ data: { ...workflow, id, isActive: id !== 'paused' } }) as never);
  render(<WorkflowsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledTimes(1));
  expect(workflowsApi.toggle).toHaveBeenCalledWith('wf', false);
  await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());
});

it('disables refresh and spins its icon until the in-flight request finishes', async () => {
  render(<WorkflowsPage />); await screen.findByRole('grid');
  let resolve!: (response: any) => void;
  vi.mocked(workflowsApi.list).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const refresh = screen.getByLabelText('Refresh') as HTMLButtonElement;
  const calls = vi.mocked(workflowsApi.list).mock.calls.length;
  fireEvent.click(refresh); fireEvent.click(refresh);
  expect(refresh.disabled).toBe(true);
  expect(screen.getByRole('grid')).toBeTruthy();
  expect(screen.getByLabelText('Search workflows')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Workflows table' })).getByRole('status', { name: 'Refreshing data...' })).toBeTruthy();
  expect(refresh.querySelector('.animate-spin')).toBeTruthy();
  expect(workflowsApi.list).toHaveBeenCalledTimes(calls + 1);
  resolve({ success: true, data: [workflow], meta: { total: 1, page: 1, limit: 10, hasMore: false } });
  await waitFor(() => expect(refresh.disabled).toBe(false));
});

it('opens row details without opening them for selection or action controls', async () => {
  render(<WorkflowsPage />); await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all records' }));
  expect(screen.queryByText('Run history')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
  expect(screen.queryByText('Run history')).toBeNull();
  fireEvent.mouseDown(document.body);
  fireEvent.click(screen.getByText('Follow up'));
  expect(screen.getByText('Run history')).toBeTruthy();
});

it('quick icons duplicate and toggle the same workflow while showing only the supported state action', async () => {
  render(<WorkflowsPage />); await screen.findByRole('grid');
  expect(screen.queryByLabelText('Resume workflow')).toBeNull();
  fireEvent.click(screen.getByLabelText('Duplicate workflow'));
  await waitFor(() => expect(workflowsApi.duplicate).toHaveBeenCalledWith('wf1'));
  await waitFor(() => expect((screen.getByLabelText('Pause workflow') as HTMLButtonElement).disabled).toBe(false));
  vi.mocked(workflowsApi.list).mockResolvedValue({ data: [{ ...workflow, id: 'wf1', isActive: false, status: 'PAUSED' }], meta: { total: 1 } } as never);
  fireEvent.click(screen.getByLabelText('Pause workflow'));
  const pauseDialog = () => screen.getByRole('alertdialog', { name: 'Pause workflow?' });
  expect(workflowsApi.toggle).not.toHaveBeenCalled();
  expect(within(pauseDialog()).getByText('Already dispatched actions cannot be recalled.')).toBeTruthy();
  fireEvent.click(within(pauseDialog()).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(workflowsApi.toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Pause workflow'));
  fireEvent.click(within(pauseDialog()).getByRole('button', { name: 'Pause workflow' }));
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledExactlyOnceWith('wf1', false));
  await waitFor(() => expect((screen.getByLabelText('Resume workflow') as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByLabelText('Pause workflow')).toBeNull();
  fireEvent.click(screen.getByLabelText('Resume workflow'));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Activate workflow' }));
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledWith('wf1', true));
});

it('reuses the Leads card and existing creation dialog instead of an empty grid', async () => {
  vi.mocked(workflowsApi.list).mockResolvedValue(emptyPage);
  render(<WorkflowsPage />);
  const heading = await screen.findByRole('heading', { name: 'No workflows yet' });
  const card = heading.closest('.border-dashed') as HTMLElement;
  expect(card.querySelector('.lucide-workflow')).toBeTruthy();
  expect(within(card).getByText('Create your first workflow to automate CRM actions.')).toBeTruthy();
  expect(screen.queryByRole('grid')).toBeNull();
  expect(screen.queryByRole('columnheader')).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  expect(screen.getByLabelText('Search workflows')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Filter Workflows' })).toBeTruthy();
  expect(screen.getByLabelText('Refresh')).toBeTruthy();
  expect(workflowsApi.list).toHaveBeenCalledTimes(1);
  fireEvent.click(within(card).getByRole('button', { name: 'Create Workflow' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }));
  expect(push).toHaveBeenCalledWith('/automation/workflows/new');
});

it('hides both creation entry points without Create permission', async () => {
  auth.canCreate = false;
  vi.mocked(workflowsApi.list).mockResolvedValue(emptyPage);
  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: 'No workflows yet' });
  expect(screen.queryByRole('button', { name: 'Create Workflow' })).toBeNull();
});

it('does not load workflow data or metadata without View permission', () => {
  auth.canView = false;
  render(<WorkflowsPage />);
  expect(screen.getByText('You do not have permission to view workflows.')).toBeTruthy();
  expect(workflowsApi.list).not.toHaveBeenCalled();
  expect(getWorkflowMetadata).not.toHaveBeenCalled();
});

it('disables both creation buttons until the existing metadata request succeeds', async () => {
  let resolve!: (metadata: Awaited<ReturnType<typeof getWorkflowMetadata>>) => void;
  vi.mocked(getWorkflowMetadata).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  vi.mocked(workflowsApi.list).mockResolvedValue(emptyPage);
  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: 'No workflows yet' });
  for (const button of screen.getAllByRole('button', { name: 'Create Workflow' })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(screen.queryByRole('dialog')).toBeNull();
  resolve({ triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions() });
  await waitFor(() => {
    for (const button of screen.getAllByRole('button', { name: 'Create Workflow' })) expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

it.each(['search', 'status', 'trigger', 'combined'])('distinguishes %s matches from an empty module and preserves clearing filters', async criteria => {
  vi.mocked(workflowsApi.list).mockImplementation(async query => query?.search?.trim() || query?.status || query?.trigger
    ? emptyPage : { ...emptyPage, data: [workflow], meta: { ...emptyPage.meta, total: 1 } } as never);
  render(<WorkflowsPage />);
  await screen.findByRole('grid');
  fireEvent.click(screen.getByRole('button', { name: 'Filter Workflows' }));
  if (criteria === 'status' || criteria === 'combined') fireEvent.click(screen.getAllByLabelText('Filter by Active')[0]);
  if (criteria === 'trigger' || criteria === 'combined') fireEvent.click(screen.getAllByLabelText(/^Filter by Lead created$/i)[0]);
  if (criteria === 'search' || criteria === 'combined') fireEvent.change(screen.getByLabelText('Search workflows'), { target: { value: 'missing' } });
  const heading = await screen.findByRole('heading', { name: 'No workflows match' });
  expect(screen.getByText('Try adjusting your search or filters.')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'No workflows yet' })).toBeNull();
  expect(within(heading.closest('.border-dashed') as HTMLElement).queryByRole('button')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create Workflow' })).toBeTruthy();
  expect(workflowsApi.list).toHaveBeenCalledWith({ page: 1, limit: 1 });
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
  await screen.findByRole('grid');
  expect((screen.getByLabelText('Search workflows') as HTMLInputElement).value).toBe('');
  expect(workflowsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: '', status: '', trigger: '' }));
});

it('shows the module empty state even with active criteria when the unfiltered total is zero', async () => {
  vi.mocked(workflowsApi.list).mockResolvedValue(emptyPage);
  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: 'No workflows yet' });
  fireEvent.change(screen.getByLabelText('Search workflows'), { target: { value: 'missing' } });
  await waitFor(() => expect(workflowsApi.list).toHaveBeenLastCalledWith({ page: 1, limit: 1 }));
  await screen.findByRole('heading', { name: 'No workflows yet' });
  expect(screen.queryByRole('heading', { name: 'No workflows match' })).toBeNull();
});

it('ignores whitespace and filter-panel search when deciding whether criteria are active', async () => {
  vi.mocked(workflowsApi.list).mockResolvedValue(emptyPage);
  render(<WorkflowsPage />);
  await screen.findByRole('heading', { name: 'No workflows yet' });
  fireEvent.change(screen.getByLabelText('Search workflows'), { target: { value: '   ' } });
  await waitFor(() => expect(workflowsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '   ' })));
  await screen.findByRole('heading', { name: 'No workflows yet' });
  fireEvent.click(screen.getByRole('button', { name: 'Filter Workflows' }));
  fireEvent.change(screen.getAllByLabelText('Search filters')[0], { target: { value: 'active' } });
  expect(screen.getByRole('heading', { name: 'No workflows yet' })).toBeTruthy();
  expect(workflowsApi.list).not.toHaveBeenCalledWith({ page: 1, limit: 1 });
});

it('waits for the unfiltered total before choosing an empty state', async () => {
  let resolve!: (response: WorkflowsResponse) => void;
  vi.mocked(workflowsApi.list).mockImplementation(async query => query?.limit === 1
    ? new Promise(done => { resolve = done; }) : query?.search ? emptyPage
      : { ...emptyPage, data: [workflow], meta: { ...emptyPage.meta, total: 1 } } as never);
  render(<WorkflowsPage />);
  await screen.findByRole('grid');
  fireEvent.change(screen.getByLabelText('Search workflows'), { target: { value: 'missing' } });
  await waitFor(() => expect(workflowsApi.list).toHaveBeenLastCalledWith({ page: 1, limit: 1 }));
  expect(screen.getByText('Loading workflows...')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /No workflows/ })).toBeNull();
  resolve({ ...emptyPage, meta: { ...emptyPage.meta, total: 1, limit: 1 } });
  await screen.findByRole('heading', { name: 'No workflows match' });
});

it('keeps a failed total lookup in the retry flow rather than announcing an empty module', async () => {
  let failTotal = true;
  vi.mocked(workflowsApi.list).mockImplementation(async query => {
    if (query?.limit === 1 && failTotal) throw new Error('Unable to confirm workflow total.');
    return query?.search ? emptyPage : { ...emptyPage, data: [workflow], meta: { ...emptyPage.meta, total: 1 } } as never;
  });
  render(<WorkflowsPage />);
  await screen.findByRole('grid');
  fireEvent.change(screen.getByLabelText('Search workflows'), { target: { value: 'missing' } });
  await screen.findByText('Unable to confirm workflow total.');
  expect(screen.queryByRole('heading', { name: /No workflows/ })).toBeNull();
  failTotal = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry workflows' }));
  await screen.findByRole('heading', { name: 'No workflows match' });
});

it('preserves empty-card refresh feedback and transitions back to the populated table', async () => {
  vi.mocked(workflowsApi.list).mockRejectedValueOnce(new Error('Workflow request failed.')).mockResolvedValue(emptyPage);
  render(<WorkflowsPage />);
  await screen.findByText('Workflow request failed.');
  expect(screen.queryByRole('heading', { name: 'No workflows yet' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry workflows' }));
  const heading = await screen.findByRole('heading', { name: 'No workflows yet' });
  let resolve!: (response: WorkflowsResponse) => void;
  vi.mocked(workflowsApi.list).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByLabelText('Refresh'));
  expect(screen.getByRole('status', { name: 'Refreshing data...' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'No workflows yet' })).toBeNull();
  expect(document.contains(heading)).toBe(true);
  resolve({ ...emptyPage, data: [workflow], meta: { ...emptyPage.meta, total: 1 } } as never);
  await screen.findByRole('grid');
  expect(screen.getByText('Follow up')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
});

it('corrects an out-of-range page without mistaking its empty rows for an empty module', async () => {
  vi.mocked(workflowsApi.list).mockImplementation(async query => ({ ...emptyPage, data: [workflow], meta: { ...emptyPage.meta, total: 11, page: query?.page ?? 1 } }) as never);
  render(<WorkflowsPage />);
  await screen.findByText('Page 1 of 2');
  fireEvent.click(screen.getByLabelText('Next page'));
  await screen.findByText('Page 2 of 2');
  let resolve!: (response: WorkflowsResponse) => void;
  vi.mocked(workflowsApi.list).mockImplementation(async query => query?.page === 2
    ? { ...emptyPage, meta: { ...emptyPage.meta, total: 10, page: 2 } }
    : new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByLabelText('Refresh'));
  await waitFor(() => expect(workflowsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 10 })));
  expect(screen.getByRole('status', { name: 'Refreshing data...' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /No workflows/ })).toBeNull();
  resolve({ ...emptyPage, data: [workflow], meta: { ...emptyPage.meta, total: 10 } } as never);
  await screen.findByText('Page 1 of 1');
  expect(workflowsApi.list).not.toHaveBeenCalledWith({ page: 1, limit: 1 });
});

import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getAvailableActions, WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import WorkflowsPage from './workflows-page';
import { workflowsApi } from '@/shared/services/workflows.api';
import { clearPageCache } from '@/shared/cache/page-cache';

const push = vi.fn();
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 'tenant' }, user: { id: 'user', }, userCan: () => true }) }));
vi.mock('./workflow-execution-log-modal', () => ({ WorkflowExecutionLogModal: () => <div>Run history</div> }));
vi.mock('@/shared/services/workflows.api', () => ({
  getWorkflowMetadata: async () => ({ triggers: WORKFLOW_TRIGGERS, actions: getAvailableActions() }),
  workflowsApi: { get: vi.fn(), list: vi.fn(), create: vi.fn(), duplicate: vi.fn(), toggle: vi.fn(), archive: vi.fn(), nameAvailability: vi.fn() },
}));
const workflow = { id: 'wf', name: 'Follow up', trigger: 'lead.created', status: 'ACTIVE', isActive: true, conditions: null, actions: [] };
beforeEach(() => {
  clearPageCache(); vi.clearAllMocks();
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
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Qualified Deal Follow-up' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview Qualified Deal Follow-up' }));
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use this template' }));
  expect(push).toHaveBeenCalledExactlyOnceWith('/automation/workflows/new?template=22');
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
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledWith('wf1', false));
  await screen.findByText('Paused');
  action('Resume');
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
  expect(screen.getByText('Loading workflows...').parentElement?.querySelector('.animate-spin')).toBeTruthy();
  expect(screen.getByLabelText('Search workflows')).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
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
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledWith('wf1', false));
  await waitFor(() => expect((screen.getByLabelText('Resume workflow') as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByLabelText('Pause workflow')).toBeNull();
  fireEvent.click(screen.getByLabelText('Resume workflow'));
  await waitFor(() => expect(workflowsApi.toggle).toHaveBeenCalledWith('wf1', true));
});

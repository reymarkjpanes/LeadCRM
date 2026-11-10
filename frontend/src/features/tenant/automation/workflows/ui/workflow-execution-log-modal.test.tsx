import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { clearPageCache, invalidatePageCache } from '@/shared/cache/page-cache';
import { WorkflowExecutionLogModal } from './workflow-execution-log-modal';
import { workflowsApi } from '@/shared/services/workflows.api';
import { toast } from '@/shared/utils/toast';
vi.mock('@/shared/utils/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
const push = vi.fn();
const permissions = vi.hoisted(() => ({ denied: [] as string[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({ user: { id: 'viewer', role: 'Staff' }, tenant: { id: 'workspace' }, userCan: (module: string, action: string) => !permissions.denied.includes(module) && !permissions.denied.includes(`${module}.${action}`) }) }));
vi.mock('@/shared/services/workflows.api', () => ({ workflowsApi: { get: vi.fn(), getExecutions: vi.fn(), options: vi.fn(), toggle: vi.fn(), duplicate: vi.fn(), archive: vi.fn() } }));
const run = { id: 'run', status: 'completed', startedAt: '2026-10-01T12:00:00Z', completedAt: '2026-10-01T12:01:00Z', entityType: 'lead', trigger: { payload: { recordName: 'Ada Lovelace' }, triggerType: 'lead_created' }, steps: [{ id: 'step', stepIndex: 0, actionType: 'create_task', status: 'completed' }] };
const workflow = { id: 'wf', name: 'Follow up', isActive: true, status: 'ACTIVE' };
beforeEach(() => {
  clearPageCache();
  permissions.denied = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.mocked(workflowsApi.get).mockResolvedValue({ data: workflow } as never);
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: Array.from({ length: 25 }, (_, i) => ({ ...run, id: `run-${i}` })), meta: { total: 51, page: 1, limit: 25, hasMore: true } } as never);
});
it('links persisted Tasks and source records and explains skipped actions without claiming assignment', async () => {
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: [{ ...run, entityId: 'source/id',
    steps: [{ ...run.steps[0], status: 'success', output: { taskId: 'task/id', cleanupWarning: 'Assignment reservation will expire.' } },
      { ...run.steps[0], id: 'skip', stepIndex: 1, status: 'skipped', output: { resolvedUserId: 'user', resolvedUserName: 'Ana', reason: 'A newer stage entry superseded this event.' } }],
  }], meta: { total: 1, page: 1, limit: 25, hasMore: false } } as never);
  mount(); await settled();
  expect(screen.getByRole('link', { name: 'Open Task' }).getAttribute('href')).toBe('/operations/taskboard?taskId=task%2Fid');
  expect(screen.getByRole('link', { name: 'Open lead' }).getAttribute('href')).toBe('/crm/leads/source%2Fid');
  expect(screen.getByText('A newer stage entry superseded this event.')).toBeTruthy();
  expect(screen.getByText('Selected assignee: Ana')).toBeTruthy();
  expect(screen.queryByText(/Assigned to Ana/)).toBeNull();
  expect(screen.getByText('Assignment reservation will expire.')).toBeTruthy();
});
it('hides output destinations when the viewer lacks their module permissions', async () => {
  permissions.denied = ['tasks', 'leads'];
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: [{ ...run, entityId: 'source', steps: [{ ...run.steps[0], output: { taskId: 'task' } }] }], meta: { total: 1, page: 1, limit: 25, hasMore: false } } as never);
  mount(); await settled();
  expect(screen.queryByRole('link', { name: 'Open Task' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open lead' })).toBeNull();
});
afterEach(() => { cleanup(); clearPageCache(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mount = (close = vi.fn(), updated = vi.fn()) => render(<WorkflowExecutionLogModal workflowId="wf" name="Follow up" status="Active" onClose={close} onUpdated={updated} />);
const settled = () => waitFor(() => expect((screen.getByLabelText('Refresh workflow activity') as HTMLButtonElement).disabled).toBe(false));
it('offers the read-only definition without inheriting Pause from Activate', async () => {
  permissions.denied = ['workflows.canPause', 'workflows.canEdit', 'workflows.canDelete', 'workflows.canDuplicate'];
  mount(); await settled();
  fireEvent.click(screen.getByLabelText('Workflow actions'));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['View definition']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'View definition' }));
  expect(push).toHaveBeenCalledWith('/automation/workflows/wf/edit?view=true');
  expect(workflowsApi.toggle).not.toHaveBeenCalled();
});

it('reports one refresh warning after a successful mutation instead of a false failure', async () => {
  const updated = vi.fn().mockRejectedValue(new Error('List unavailable'));
  mount(vi.fn(), updated); await settled();
  fireEvent.click(screen.getByLabelText('Workflow actions'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
  await waitFor(() => expect(updated).toHaveBeenCalledOnce());
  await waitFor(() => expect(toast.warning).toHaveBeenCalledExactlyOnceWith('Workflow paused. Refresh the list to see the changes.'));
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(workflowsApi.toggle).toHaveBeenCalledExactlyOnceWith('wf', false);
  await waitFor(() => expect(workflowsApi.get).toHaveBeenCalledTimes(2));
});

it('shows one error for a rejected mutation and does not refresh or announce success', async () => {
  vi.mocked(workflowsApi.toggle).mockRejectedValue(new Error('Assignment target unavailable.'));
  const updated = vi.fn(); mount(vi.fn(), updated); await settled();
  fireEvent.click(screen.getByLabelText('Workflow actions'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith('Assignment target unavailable.'));
  expect(toast.warning).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  expect(updated).not.toHaveBeenCalled(); expect(workflowsApi.get).toHaveBeenCalledOnce();
});
it('shows the executed version, snapshot and resolved assignee independently of the current definition', async () => {
  vi.mocked(workflowsApi.get).mockResolvedValue({ data: { ...workflow, version: 4 } } as never);
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: [{ ...run, workflowVersion: 2,
    definitionSnapshot: { name: 'Original follow-up', trigger: 'lead.created', actions: [{ type: 'create_task', config: { title: 'Old title' } }] },
    steps: [{ ...run.steps[0], output: { resolvedUserId: 'user', resolvedUserName: 'Ana', assignmentTargetName: 'Sales team', strategy: 'round_robin' } }],
  }], meta: { total: 1, page: 1, limit: 25, hasMore: false } } as never);
  mount(); await settled();
  expect(screen.getByText(/Workflow details/).textContent).toBe('Workflow details · Active · v4');
  expect(screen.getByText('Definition used in this run · v2')).toBeTruthy();
  expect(screen.getByText(/Oct 1, 2026 08:00:00 PM/)).toBeTruthy();
  expect(screen.getByText(/Finished:/).textContent).toContain('Oct 1, 2026 08:01:00 PM');
  expect(screen.getByText(/Assigned to Ana · Sales team · Round-robin/)).toBeTruthy();
  expect(screen.getByText('Original follow-up')).toBeTruthy();
  expect(screen.getByText('Old title')).toBeTruthy();
});
it('does not claim a completed assignment when the action failed after resolving a user', async () => {
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: [{ ...run, status: 'failed',
    steps: [{ ...run.steps[0], status: 'failed', error: 'Unable to create task.', output: { resolvedUserId: 'user', resolvedUserName: 'Ana' } }],
  }], meta: { total: 1, page: 1, limit: 25, hasMore: false } } as never);
  mount(); await settled();
  expect(screen.getByText('Selected assignee: Ana')).toBeTruthy();
  expect(screen.queryByText(/Assigned to Ana/)).toBeNull();
  expect(screen.getByText('Unable to create task.')).toBeTruthy();
});
it('preserves retired assignment labels in historical runs', async () => {
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: [{ ...run,
    steps: [{ ...run.steps[0], output: { resolvedUserId: 'user', resolvedUserName: 'Ana', assignmentTargetName: 'Sales team', strategy: 'sticky' } }],
  }], meta: { total: 1, page: 1, limit: 25, hasMore: false } } as never);
  mount(); await settled();
  expect(screen.getByText(/Assigned to Ana · Sales team · Previous assignee \/ Sticky assignment/)).toBeTruthy();
});
it('uses shared pagination and retains loaded runs while refreshing definition plus current run page', async () => {
  const close = vi.fn(); mount(close);
  expect(screen.getByRole('status', { name: 'Loading workflow runs' })).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  const dialog = await screen.findByRole('dialog', { name: 'Workflow details — Follow up' });
  expect(dialog.className).toContain('md:max-w-xl');
  await screen.findByText('Page 1 of 3');
  expect(dialog.querySelectorAll('details')).toHaveLength(25);
  expect(dialog.querySelector('details')!.textContent).toContain('1. Create Task — completed');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await screen.findByText('Page 2 of 3'); await settled();
  expect(workflowsApi.getExecutions).toHaveBeenLastCalledWith('wf', 2, 25, 'outcomes', expect.any(AbortSignal));
  let finishRefresh!: (value: unknown) => void;
  vi.mocked(workflowsApi.getExecutions).mockReturnValueOnce(new Promise(resolve => { finishRefresh = resolve; }) as never);
  fireEvent.click(screen.getByLabelText('Refresh workflow activity')); fireEvent.click(screen.getByLabelText('Refresh workflow activity'));
  expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy();
  expect(await screen.findByRole('status', { name: 'Refreshing workflow runs...' })).toBeTruthy();
  expect(dialog.querySelectorAll('details')).toHaveLength(25);
  await act(async () => { finishRefresh({ data: Array.from({ length: 25 }, (_, i) => ({ ...run, id: `run-${i}` })), meta: { total: 51, page: 2, limit: 25, hasMore: true } }); });
  await settled();
  expect(workflowsApi.get).toHaveBeenCalledTimes(2); expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByLabelText('Records per page')); fireEvent.click(screen.getByRole('option', { name: '10' }));
  await screen.findByText('Page 1 of 6'); expect(workflowsApi.getExecutions).toHaveBeenLastCalledWith('wf', 1, 10, 'outcomes', expect.any(AbortSignal));
  fireEvent.click(screen.getByLabelText('Close workflow details')); expect(close).toHaveBeenCalledOnce();
});
it('orders header actions and toggles, dismisses and executes the existing workflow menu', async () => {
  const updated = vi.fn(), close = vi.fn(); mount(close, updated); await settled();
  expect(Array.from(screen.getByRole('dialog').querySelectorAll('header button')).map(b => b.getAttribute('aria-label'))).toEqual(['Refresh workflow activity', 'Workflow actions', 'Close workflow details']);
  const menu = () => fireEvent.click(screen.getByLabelText('Workflow actions'));
  menu(); expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View definition', 'Edit', 'Pause', 'Duplicate', 'Archive']);
  menu(); expect(screen.queryByRole('menu')).toBeNull();
  menu(); fireEvent.mouseDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  menu(); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull(); expect(close).not.toHaveBeenCalled();
  menu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' })); expect(push).toHaveBeenCalledWith('/automation/workflows/wf/edit');
  vi.mocked(workflowsApi.get).mockResolvedValue({ data: { ...workflow, isActive: false, status: 'PAUSED' } } as never);
  menu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' })); await settled();
  expect(workflowsApi.toggle).toHaveBeenCalledWith('wf', false); await waitFor(() => expect(screen.getByText(/Workflow details/).textContent).toBe('Workflow details · Paused'));
  menu(); expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull(); fireEvent.click(screen.getByRole('menuitem', { name: 'Resume' })); await settled();
  expect(workflowsApi.toggle).toHaveBeenCalledWith('wf', true);
  menu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' })); await settled(); expect(workflowsApi.duplicate).toHaveBeenCalledWith('wf');
  menu(); fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' })); expect(workflowsApi.archive).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
  await waitFor(() => expect(workflowsApi.archive).toHaveBeenCalledWith('wf')); await waitFor(() => expect(updated).toHaveBeenCalledTimes(4));
});

it('shows only finished outcome labels and retains uncertainty for interrupted submissions', async () => {
  vi.mocked(workflowsApi.getExecutions).mockResolvedValue({ data: [
    ...['completed', 'failed', 'skipped', 'interrupted', 'queued', 'running'].map(status => ({ ...run, id: status, status, steps: [] })),
  ], meta: { total: 4, page: 1, limit: 25, hasMore: false } } as never);
  mount(); await settled();
  const summaries = [...screen.getByRole('dialog').querySelectorAll('summary')].map(summary => summary.textContent);
  expect(summaries).toHaveLength(4);
  expect(summaries.filter(text => text?.startsWith('completed'))).toHaveLength(1);
  expect(summaries.filter(text => text?.startsWith('failed'))).toHaveLength(2);
  expect(summaries.filter(text => text?.startsWith('skipped'))).toHaveLength(1);
  expect(screen.getByText(/The action outcome is uncertain/).textContent).toContain('automatic replay is disabled');
  expect(screen.queryByText('queued')).toBeNull(); expect(screen.queryByText('running')).toBeNull();
});

it.each([401, 403, 404])('clears previously loaded history after an authoritative %s denial', async status => {
  mount(); await settled();
  expect(screen.getAllByText(/Ada Lovelace/).length).toBeGreaterThan(0);
  vi.mocked(workflowsApi.getExecutions).mockRejectedValue(Object.assign(new Error('History access unavailable.'), { status }));
  fireEvent.click(screen.getByLabelText('Refresh workflow activity'));
  await screen.findByText('History access unavailable.');
  expect(screen.queryByText(/Ada Lovelace/)).toBeNull();
});

it('rejects late history responses after group-scope eviction without changing permission flags', async () => {
  mount(); await settled();
  let finishOld!: (value: unknown) => void;
  vi.mocked(workflowsApi.getExecutions).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }) as never)
    .mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 25, hasMore: false } } as never);
  fireEvent.click(screen.getByLabelText('Refresh workflow activity'));
  await waitFor(() => expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(2));
  act(() => invalidatePageCache('workflows', 'workspace', true, true));
  await waitFor(() => expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(/Ada Lovelace/)).toBeNull();
  await act(async () => { finishOld({ data: [run], meta: { total: 1 } }); });
  await settled();
  expect(screen.queryByText(/Ada Lovelace/)).toBeNull();
});

it('refreshes finished outcomes while visible and stops polling when hidden or unmounted', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const view = mount(); await settled();
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await settled(); expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(3);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(workflowsApi.getExecutions).toHaveBeenCalledTimes(3);
  hidden.mockRestore();
});

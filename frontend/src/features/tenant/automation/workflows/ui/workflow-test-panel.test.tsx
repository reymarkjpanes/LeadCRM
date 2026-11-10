import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TriggerDefinition, WorkflowTestResult } from '@leadcrm/shared';
import { WorkflowTestPanel } from './workflow-test-panel';
import { dealsApi } from '@/shared/services/deals.api';
import { workflowsApi } from '@/shared/services/workflows.api';
import { invalidatePageCache } from '@/shared/cache/page-cache';

const auth = vi.hoisted(() => ({ id: 'agent', tenantId: 'tenant', canExecute: true }));
vi.mock('@/store/AuthContext', () => ({ useAuth: () => ({
  user: { id: auth.id, tenantId: auth.tenantId },
  permissions: { workflows: { canExecute: auth.canExecute } },
  userCan: (module: string, action: string) => module === 'workflows' && action === 'canExecute' && auth.canExecute,
}) }));
vi.mock('@/shared/services/deals.api', () => ({ dealsApi: { list: vi.fn(), get: vi.fn() } }));
vi.mock('@/shared/services/workflows.api', () => ({ workflowsApi: { test: vi.fn() }, withWorkflowTimeout: (request: Promise<unknown>) => request }));
const trigger = { type: 'deal.stage_changed', entity: 'deal', label: 'Stage entry', fields: [] } as TriggerDefinition;
const result: WorkflowTestResult = { valid: true, trigger: { matched: true, type: trigger.type, stageHistoryId: 'history' }, conditions: { matched: true, passed: 2, total: 2 }, actions: [{ type: 'create_task', valid: true, message: 'Ready. No changes made.', assignment: { resolvedUserId: 'agent', resolvedUserName: 'Ana', candidateCount: 1 }, taskPreview: { title: 'Follow up', description: 'Discuss proposal', priority: 'Medium', status: 'pending', dueDate: '2026-10-15T00:00:00Z', assignedUserId: 'agent', dealIds: ['deal'] } }] };
beforeEach(() => {
  auth.id = 'agent'; auth.tenantId = 'tenant'; auth.canExecute = true;
  vi.mocked(dealsApi.list).mockResolvedValue({ data: [{ id: 'deal', title: 'Example Deal' }], meta: { hasMore: false } } as never);
  vi.mocked(dealsApi.get).mockResolvedValue({ data: { id: 'deal', stageHistories: [{ id: 'history', movedAt: '2026-10-13T00:00:00Z', previousStage: { id: 'old', name: 'Lead' }, newStage: { id: 'new', name: 'Contacted' } }] } } as never);
  vi.mocked(workflowsApi.test).mockResolvedValue({ success: true, data: result });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
async function chooseDeal() {
  await screen.findByRole('option', { name: 'Example Deal' });
  fireEvent.change(screen.getByLabelText('Sample record'), { target: { value: 'deal' } });
  await waitFor(() => expect((screen.getByLabelText('Recorded stage transition') as HTMLSelectElement).disabled).toBe(false));
}
it('checks a persisted stage transition and displays the resolved Task without creating one', async () => {
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal();
  expect(screen.getByRole('option', { name: /Lead → Contacted/ }).textContent).toContain('08:00:00 AM');
  fireEvent.change(screen.getByLabelText('Recorded stage transition'), { target: { value: 'history' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  await screen.findByText('Follow up');
  expect(workflowsApi.test).toHaveBeenCalledWith('workflow', 'deal', 'history');
  expect(screen.getByText('Medium / pending')).toBeTruthy();
  expect(screen.getByText('Discuss proposal')).toBeTruthy();
  expect(screen.getByText('Ana')).toBeTruthy();
  expect(screen.getByText(/No execution or Task was created/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open Task' })).toBeNull();
});
it('explains superseded histories instead of calling them a record-type mismatch', async () => {
  vi.mocked(workflowsApi.test).mockResolvedValue({ success: true, data: { ...result, valid: false, trigger: { matched: false, type: trigger.type, stageHistoryId: 'history', reason: 'A newer stage entry superseded this event.' }, actions: [{ type: 'create_task', status: 'skipped', valid: false, message: 'Task creation skipped.' }] } });
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal();
  fireEvent.change(screen.getByLabelText('Recorded stage transition'), { target: { value: 'history' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  expect(await screen.findByText('A newer stage entry superseded this event.')).toBeTruthy();
  expect(screen.queryByText('Sample record does not match the trigger’s record type.')).toBeNull();
});
it('keeps the current-record check available when no persisted transition exists', async () => {
  vi.mocked(dealsApi.get).mockResolvedValue({ data: { id: 'deal', stageHistories: [] } } as never);
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal();
  expect(screen.getByText(/No recorded stage transitions are available/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  await waitFor(() => expect(workflowsApi.test).toHaveBeenCalledWith('workflow', 'deal', undefined));
});
it('discards an in-flight preview after a user change', async () => {
  let resolve: (value: { success: boolean; data: WorkflowTestResult }) => void = () => {};
  vi.mocked(workflowsApi.test).mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal();
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  await waitFor(() => expect(workflowsApi.test).toHaveBeenCalledOnce());
  auth.id = 'another-agent';
  view.rerender(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  resolve({ success: true, data: result });
  await screen.findByRole('option', { name: 'Example Deal' });
  expect(screen.queryByText('Follow up')).toBeNull();
  expect(screen.getByRole('button', { name: 'Run check' }).textContent).toBe('Run check');
});
it('shows rendered email and named multiple-Deal previews without execution controls', async () => {
  vi.mocked(workflowsApi.test).mockResolvedValue({ success: true, data: { ...result, actions: [
    { type: 'send_email', valid: true, message: 'No email sent.', emailPreview: { senderName: 'Ana', senderEmail: 'ana@example.test', recipient: 'lead@example.test', subject: 'Hello Ada', body: '<p>Hello Ada</p><script>bad()</script>', warnings: ['Phone has no value and will be blank.'] } },
    { ...result.actions[0], taskPreview: { ...result.actions[0].taskPreview!, dealIds: ['one', 'two', 'three'], deals: [{ id: 'one', title: 'First Deal' }, { id: 'two', title: 'Second Deal' }, { id: 'three', title: 'Third Deal' }], associationSummary: 'Creates 1 task linked to 3 deals.' } },
  ] } });
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal(); fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  expect(await screen.findByText('Creates 1 task linked to 3 deals.')).toBeTruthy();
  expect(screen.getByText('First Deal, Second Deal, Third Deal')).toBeTruthy();
  expect(screen.getByText('Phone has no value and will be blank.')).toBeTruthy();
  const frame = screen.getByTitle('Email message preview 1');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('srcdoc')).toContain('Hello Ada');
  expect(frame.getAttribute('srcdoc')).not.toContain('<script>');
  expect(screen.queryByRole('button', { name: /send|create task/i })).toBeNull();
});

it('does not load records or offer a check without Execute permission', () => {
  auth.canExecute = false;
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  expect(screen.getByText('You do not have permission to run workflow checks.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Run check' })).toBeNull();
  expect(dealsApi.list).not.toHaveBeenCalled();
  expect(workflowsApi.test).not.toHaveBeenCalled();
});

it('discards an in-flight check when Execute permission is revoked for the same user', async () => {
  let resolveCheck!: (value: { success: boolean; data: WorkflowTestResult }) => void;
  vi.mocked(workflowsApi.test).mockReturnValue(new Promise(done => { resolveCheck = done; }));
  const view = render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal();
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  await waitFor(() => expect(workflowsApi.test).toHaveBeenCalledOnce());
  auth.canExecute = false;
  view.rerender(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await act(async () => { resolveCheck({ success: true, data: result }); });
  expect(screen.getByText('You do not have permission to run workflow checks.')).toBeTruthy();
  expect(screen.queryByText('Follow up')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Run check' })).toBeNull();
  expect(workflowsApi.test).toHaveBeenCalledOnce();
});

it('clears samples and previews after membership changes with unchanged Execute permission', async () => {
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal();
  fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  await screen.findByText('Follow up');
  vi.mocked(dealsApi.list).mockResolvedValue({ data: [], meta: { hasMore: false } } as never);
  act(() => invalidatePageCache('groups', 'tenant'));
  expect(screen.queryByText('Follow up')).toBeNull();
  expect(screen.queryByRole('option', { name: 'Example Deal' })).toBeNull();
  await screen.findByText('No matching records are available.');
  expect(screen.queryByLabelText('Recorded stage transition')).toBeNull();
});

it('discards a late preview after membership invalidation for the same user', async () => {
  let finishCheck!: (value: { success: boolean; data: WorkflowTestResult }) => void;
  vi.mocked(workflowsApi.test).mockReturnValue(new Promise(resolve => { finishCheck = resolve; }));
  render(<WorkflowTestPanel workflowId="workflow" trigger={trigger} />);
  await chooseDeal(); fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
  await waitFor(() => expect(workflowsApi.test).toHaveBeenCalledOnce());
  act(() => invalidatePageCache('workflows', 'tenant', true, true));
  await act(async () => { finishCheck({ success: true, data: result }); });
  expect(screen.queryByText('Follow up')).toBeNull();
});

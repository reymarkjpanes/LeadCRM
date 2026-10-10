import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import { WorkflowTestPanel } from './workflow-test-panel';
import { WorkflowRuns } from './workflow-execution-log-modal';
import { workflowsApi } from '@/shared/services/workflows.api';
import { contactsApi } from '@/shared/services/contacts.api';
import { dealsApi } from '@/shared/services/deals.api';
vi.mock('@/shared/services/workflows.api', () => ({
  workflowsApi: { test: vi.fn(), getExecutions: vi.fn() },
  withWorkflowTimeout: <T,>(request: Promise<T>) => request,
}));
vi.mock('@/shared/services/contacts.api', () => ({
  contactsApi: { list: vi.fn() },
}));
vi.mock('@/shared/services/contacts-v2.api', () => ({
  contactsV2Api: { list: vi.fn() },
}));
vi.mock('@/shared/services/deals.api', () => ({ dealsApi: { list: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('workflow test and activity', () => {
  it('tests the selected real record against the saved definition without executing actions', async () => {
    vi.mocked(contactsApi.list).mockResolvedValue({
      success: true,
      data: [{ id: 'record', firstName: 'Ada', lastName: 'Example' }],
      meta: { page: 1, limit: 25, total: 1, hasMore: false },
    } as never);
    vi.mocked(workflowsApi.test).mockResolvedValue({
      success: true,
      data: {
        trigger: { matched: true, type: 'lead.created' },
        conditions: { matched: false, passed: 0, total: 1 },
        actions: [
          {
            type: 'send_email',
            valid: true,
            message: 'Disabled. This action will be skipped.',
          },
        ],
        valid: true,
      },
    });
    render(
      <WorkflowTestPanel
        workflowId="saved-workflow"
        trigger={WORKFLOW_TRIGGERS[0]}
      />,
    );
    await screen.findByRole('option', { name: 'Ada Example' });
    expect(workflowsApi.test).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Sample record'), {
      target: { value: 'record' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() =>
      expect(workflowsApi.test).toHaveBeenCalledWith(
        'saved-workflow',
        'record',
      ),
    );
    expect(await screen.findByText(/Conditions do not match/)).toBeTruthy();
    expect(
      screen.getByText(/Disabled. This action will be skipped/),
    ).toBeTruthy();
  });
  it('uses the Deal record source and recovers from loading failures', async () => {
    vi.mocked(dealsApi.list)
      .mockRejectedValueOnce(new Error('Unable to load records.'))
      .mockResolvedValue({
        success: true,
        data: [],
        meta: { page: 1, limit: 25, total: 0, hasMore: false },
      });
    render(
      <WorkflowTestPanel
        workflowId="deal-workflow"
        trigger={
          WORKFLOW_TRIGGERS.find((trigger) => trigger.entity === 'deal')!
        }
      />,
    );
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Reload records' }));
    await screen.findByText('No matching records are available.');
    expect(contactsApi.list).not.toHaveBeenCalled();
  });
  it('shows persisted skipped reasons and retries activity requests', async () => {
    vi.mocked(workflowsApi.getExecutions)
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValue({
        success: true,
        meta: { total: 1, page: 1, limit: 25, hasMore: false },
        data: [
          {
            id: 'run',
            status: 'completed',
            startedAt: '2026-09-27T00:00:00Z',
            completedAt: '2026-09-27T00:00:01Z',
            entityType: 'lead',
            trigger: {
              triggerType: 'lead.created',
              payload: { recordName: 'Ada Example' },
            },
            steps: [
              {
                id: 'step',
                stepIndex: 1,
                actionType: 'send_email',
                status: 'skipped',
                output: { reason: 'Action disabled' },
              },
            ],
          },
        ],
      } as never);
    render(<WorkflowRuns workflowId="saved-workflow" />);
    await screen.findByText('Temporary failure');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow activity' }));
    await screen.findByText('Action disabled');
    expect(workflowsApi.getExecutions).toHaveBeenLastCalledWith(
      'saved-workflow',
      1,
      25,
    );
  });
});

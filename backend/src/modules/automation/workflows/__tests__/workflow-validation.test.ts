import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDraft } from '@leadcrm/shared';
import { NotFoundError } from '../../../../shared/errors/http-error';
import { validateAction } from '../../actions/action-validation';
import { validateWorkflow } from '../workflow-validation';

vi.mock('../../actions/action-validation', () => ({ validateAction: vi.fn() }));

const draft: WorkflowDraft = {
  name: 'Follow up',
  trigger: 'lead.created',
  isActive: true,
  actions: [{ type: 'create_task', config: { title: 'Call lead' } }],
};

describe('workflow activation errors', () => {
  beforeEach(() => vi.resetAllMocks());

  it('identifies the action when a configuration reference is invalid', async () => {
    vi.mocked(validateAction).mockRejectedValue(new NotFoundError('Active workspace user'));
    await expect(validateWorkflow(draft, 'tenant')).rejects.toThrow('Action 1: Active workspace user not found');
  });

  it('preserves unexpected failures for generic server error handling', async () => {
    const databaseFailure = new Error('Internal database connection details');
    vi.mocked(validateAction).mockRejectedValue(databaseFailure);
    await expect(validateWorkflow(draft, 'tenant')).rejects.toBe(databaseFailure);
  });
  it('requires at least one enabled action while preserving legacy enabled defaults', async () => {
    await expect(validateWorkflow({ ...draft, actions: [{ ...draft.actions[0], enabled: false }] }, 'tenant')).rejects.toThrow('Enable at least one action');
    await expect(validateWorkflow(draft, 'tenant')).resolves.toBeUndefined();
  });
  it('blocks blank text activation, preserving empty operators and saved literal comparisons', async () => {
    const conditions = { operator: 'AND' as const, conditions: [{ field: 'lead.firstName', operator: 'equals' as const, value: '' }] };
    await expect(validateWorkflow({ ...draft, conditions }, 'tenant')).rejects.toThrow('Condition 1: Enter a value');
    await expect(validateWorkflow({ ...draft, conditions }, 'tenant', conditions)).resolves.toBeUndefined();
    await expect(validateWorkflow({ ...draft, conditions }, 'tenant', { ...conditions, conditions: [{ ...conditions.conditions[0], incompleteValue: true }] })).rejects.toThrow('Condition 1: Enter a value');
    await expect(validateWorkflow({ ...draft, conditions: { operator: 'AND', conditions: [{ field: 'lead.firstName', operator: 'is_empty', value: null }] } }, 'tenant')).resolves.toBeUndefined();
  });
});

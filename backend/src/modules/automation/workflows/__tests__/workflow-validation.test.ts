import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDraft } from '@leadcrm/shared';
import { NotFoundError } from '../../../../shared/errors/http-error';
import { validateAction } from '../../actions/action-validation';
import { validateWorkflow } from '../workflow-validation';

vi.mock('../../actions/action-validation', () => ({ validateAction: vi.fn() }));
vi.mock('../../actions/actions.repository', () => ({ findStage: vi.fn() }));

import * as actionRefs from '../../actions/actions.repository';

const draft: WorkflowDraft = {
  name: 'Follow up',
  trigger: 'lead.created',
  isActive: true,
  actions: [{ type: 'assign_owner', config: { userId: 'agent' } }],
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
  it('rejects Deal Updated stage moves without a source-stage condition at backend activation', async () => {
    const dealWorkflow: WorkflowDraft = { name: 'Quotation to Qualified', trigger: 'deal.updated', isActive: true,
      conditions: { operator: 'AND', conditions: [{ field: 'deal.title', operator: 'equals', value: 'Proposal sent' }] },
      actions: [{ type: 'move_deal_stage', config: { stageId: 'target-stage' } }] };
    await expect(validateWorkflow(dealWorkflow, 'tenant')).rejects.toThrow('explicit Deal Stage Equals condition');
  });
  it('rejects Deal Updated stage moves when a source stage belongs to another pipeline', async () => {
    const source = '11111111-1111-4111-8111-111111111111';
    const target = '22222222-2222-4222-8222-222222222222';
    vi.mocked(validateAction).mockResolvedValue(undefined);
    vi.mocked(actionRefs.findStage).mockImplementation(async id => ({ id, pipelineId: id === source ? 'pipeline-a' : 'pipeline-b' } as never));
    const dealWorkflow: WorkflowDraft = { name: 'Move only from Contacted', trigger: 'deal.updated', isActive: true,
      conditions: { operator: 'AND', conditions: [{ field: 'deal.stageId', operator: 'equals', value: source }] },
      actions: [{ type: 'move_deal_stage', config: { stageId: target } }] };
    await expect(validateWorkflow(dealWorkflow, 'tenant')).rejects.toThrow('Every source Deal stage must belong to the same pipeline');
  });
  it('accepts a Deal Updated stage move when source and target belong to the same pipeline', async () => {
    const source = '11111111-1111-4111-8111-111111111111';
    const target = '22222222-2222-4222-8222-222222222222';
    vi.mocked(validateAction).mockResolvedValue(undefined);
    vi.mocked(actionRefs.findStage).mockResolvedValue({ id: source, pipelineId: 'pipeline-a' } as never);
    const dealWorkflow: WorkflowDraft = { name: 'Move only from Contacted', trigger: 'deal.updated', isActive: true,
      conditions: { operator: 'AND', conditions: [{ field: 'deal.stageId', operator: 'equals', value: source }] },
      actions: [{ type: 'move_deal_stage', config: { stageId: target } }] };
    await expect(validateWorkflow(dealWorkflow, 'tenant')).resolves.toBeUndefined();
  });
});

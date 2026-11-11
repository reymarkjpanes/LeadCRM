import { describe, expect, it } from 'vitest';
import { WORKFLOW_TRIGGERS, getAvailableActions, getWorkflowConditionFields, getWorkflowUpdateFields, workflowActionAllowed, workflowActionPolicyIssues, workflowDefinitionIssues, type WorkflowDraft } from '@leadcrm/shared';

describe('Workflow trigger action policy', () => {
  for (const trigger of WORKFLOW_TRIGGERS) it(`enforces the action matrix for ${trigger.type}`, () => {
    expect(workflowActionAllowed(trigger.type, 'create_task')).toBe(trigger.entity === 'deal');
    expect(workflowActionAllowed(trigger.type, 'send_email')).toBe(trigger.entity !== 'account');
    expect(workflowActionAllowed(trigger.type, 'send_sms')).toBe(trigger.entity !== 'account');
    expect(workflowActionAllowed(trigger.type, 'assign_owner')).toBe(trigger.entity !== 'account' && !trigger.type.endsWith('.updated') && !trigger.type.startsWith('deal.closed_'));
    if (trigger.entity === 'account') expect(getAvailableActions().filter(action => workflowActionAllowed(trigger.type, action.type)).map(action => action.type)).toEqual(['update_field']);
  });
  it('requires a mandatory status or stage gate for every handoff', () => {
    const draft: WorkflowDraft = { name: 'Handoff', trigger: 'lead.status_changed', isActive: false, actions: [{ type: 'assign_owner', config: {} }] };
    expect(workflowActionPolicyIssues(draft)[0]).toContain('explicit target');
    const route = { field: 'event.newStatus', operator: 'equals' as const, value: 'Hot' };
    const other = { field: 'lead.firstName', operator: 'equals' as const, value: 'Ada' };
    expect(workflowActionPolicyIssues({ ...draft, conditions: { operator: 'AND', conditions: [route, other] } })).toEqual([]);
    expect(workflowActionPolicyIssues({ ...draft, conditions: { operator: 'OR', conditions: [route, other] } })[0]).toContain('every matching record');
    expect(workflowActionPolicyIssues({ ...draft, conditions: { operator: 'OR', conditions: [route, { ...route, value: 'Cold' }] } })).toEqual([]);
    expect(workflowActionPolicyIssues({ ...draft, trigger: 'deal.stage_changed', conditions: { operator: 'AND', conditions: [{ field: 'event.newStageId', operator: 'equals', value: 'stage' }] } })).toEqual([]);
  });
  it('keeps assignment readable in conditions and requires the dedicated action for writes', () => {
    for (const entity of ['lead', 'contact', 'deal'] as const) {
      expect(getWorkflowUpdateFields(entity).some(field => field.field === 'assignedUserId')).toBe(false);
      expect(getWorkflowConditionFields(entity).some(field => field.field === `${entity}.assignedUserId`)).toBe(true);
    }
    const draft: WorkflowDraft = { name: 'Bypass', trigger: 'lead.updated', isActive: false, actions: [{ type: 'update_field', config: { field: 'assignedUserId', value: 'agent' } }] };
    expect(workflowActionPolicyIssues(draft)[0]).toContain('Use Assign Agent');
    expect(workflowActionPolicyIssues({ ...draft, actions: [{ ...draft.actions[0], enabled: false }] })).toEqual([]);
  });
  it.each(['lead', 'contact'] as const)('requires Deal-based stage rules instead of feedback from %s aggregate status', entity => {
    const draft: WorkflowDraft = { name: 'Legacy stage rule', trigger: `${entity}.status_changed`, isActive: false,
      actions: [{ type: 'move_deal_stage', config: { stageId: 'stage' } }] };
    expect(workflowActionAllowed(draft.trigger, 'move_deal_stage')).toBe(false);
    expect(workflowActionPolicyIssues(draft)[0]).toContain('Use a Deal-based stage rule');
    expect(workflowActionAllowed(`${entity}.updated`, 'move_deal_stage')).toBe(true);
    expect(workflowActionAllowed(draft.trigger, 'send_email')).toBe(true);
    expect(workflowActionPolicyIssues({ ...draft, actions: [{ ...draft.actions[0], enabled: false }] })).toEqual([]);
  });
  it('requires Deal Updated stage moves to declare their source stage', () => {
    const draft: WorkflowDraft = { name: 'Quotation to Qualified', trigger: 'deal.updated', isActive: true,
      conditions: { operator: 'AND', conditions: [{ field: 'deal.quotationSent', operator: 'is_not_empty', value: null }] },
      actions: [{ type: 'move_deal_stage', config: { stageId: 'target-stage' } }] };
    expect(workflowDefinitionIssues(draft)[0]).toContain('explicit Deal Stage Equals condition');
    expect(workflowDefinitionIssues({ ...draft, conditions: { operator: 'AND', conditions: [
      { field: 'deal.stageId', operator: 'equals', value: 'source-stage' }, ...draft.conditions!.conditions,
    ] } })).toEqual([]);
    expect(workflowDefinitionIssues({ ...draft, conditions: { operator: 'OR', conditions: [
      { field: 'deal.stageId', operator: 'equals', value: 'source-stage' },
      { field: 'deal.quotationSent', operator: 'is_not_empty', value: null },
    ] } })[0]).toContain('For OR conditions, every option');
    expect(workflowDefinitionIssues({ ...draft, conditions: { operator: 'OR', conditions: [
      { field: 'deal.stageId', operator: 'equals', value: 'source-a' },
      { field: 'deal.stageId', operator: 'equals', value: 'source-b' },
    ] } })).toEqual([]);
  });
  it('does not constrain stage moves on other supported trigger types or disabled actions', () => {
    const draft: WorkflowDraft = { name: 'Initial stage route', trigger: 'deal.created', isActive: true,
      actions: [{ type: 'move_deal_stage', config: { stageId: 'target-stage' } }] };
    expect(workflowDefinitionIssues(draft)).toEqual([]);
    expect(workflowDefinitionIssues({ ...draft, trigger: 'deal.updated', actions: [{ ...draft.actions[0], enabled: false }] })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { WORKFLOW_TRIGGERS, getAvailableActions, getWorkflowConditionFields, getWorkflowUpdateFields, workflowActionAllowed, workflowActionPolicyIssues, type WorkflowDraft } from '@leadcrm/shared';

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
});

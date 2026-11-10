import { describe, expect, it } from 'vitest';
import { CRM_STATUSES, getAvailableActions, WORKFLOW_TRIGGERS, WorkflowDraftSchema } from '@leadcrm/shared';
import { editorDocument, editorIssues } from './workflow-editor';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES, WORKFLOW_STARTER_TEMPLATES } from './workflow-recipes';
import { templateAvailability, templateBehaviorLabel, templateConditionLabel, templateSetup } from './workflow-template-catalog';
import { bindWorkflowTemplate, workflowTemplateDescriptor, workflowTemplateSetupIssues } from './workflow-template-bindings';
const userId = '30000000-0000-4000-8000-000000000001';
const stageId = '30000000-0000-4000-8000-000000000002';
const sourceStageId = '30000000-0000-4000-8000-000000000004';
const options = { senders: [{ id: userId, name: "Sender" }], users: [{ id: userId, name: 'Agent' }], pipelines: [{ id: '30000000-0000-4000-8000-000000000003', name: 'Sales', stages: [{ id: sourceStageId, name: 'Lead', isWon: false, isLost: false }, { id: stageId, name: 'Qualified', isWon: false, isLost: false }] }], templates: [], campaigns: [] };
describe('complete workflow recipe catalog', () => {
  it('retains the approved starters in display order with stable template URL indexes', () => {
    expect(WORKFLOW_STARTER_TEMPLATES.map(({ index, recipe }) => [index, recipe.name])).toEqual([
      [27, 'New Deal Created'], [16, 'Deal Stage Changed'], [25, 'Deal Entered a Specific Stage'],
      [34, 'Automatic Deal Stage Update'], [17, 'Move New Deal Stage'], [18, 'Deal Marked as Won'],
      [31, 'Deal Marked as Lost'], [28, 'Deal Assigned'],
      [0, 'New Lead Follow-up'], [1, 'Hot Lead Urgent Response'], [7, 'New Lead Email Welcome'],
      [8, 'Contact Onboarding Handoff'], [33, 'Contact Welcome Email Template'], [26, 'Account Field Maintenance'],
    ]);
  });
  it.each(WORKFLOW_RECIPES)('$name matches supported metadata and validates after configuring references', recipe => {
    const original = structuredClone(recipe);
    const actions = getAvailableActions();
    expect(WorkflowDraftSchema.safeParse(recipe).success).toBe(true);
    if (/^(lead|contact)\.status_changed$/.test(recipe.trigger) && recipe.actions.some(action => action.type === 'move_deal_stage')) {
      expect(templateAvailability(recipe, WORKFLOW_TRIGGERS, actions).join(' ')).toContain('unavailable');
      expect(recipe.description).toContain('Use Automatic Deal Stage Update');
      expect(WORKFLOW_STARTER_TEMPLATES.some(entry => entry.recipe === recipe)).toBe(false);
      expect(recipe).toEqual(original);
      return;
    }
    expect(templateAvailability(recipe, WORKFLOW_TRIGGERS, actions)).toEqual([]);
    for (const condition of recipe.conditions?.conditions ?? []) {
      if (condition.field === 'lead.status' || condition.field === 'contact.status') {
        expect(CRM_STATUSES.map(status => status.toLowerCase())).toContain(String(condition.value).toLowerCase());
      }
    }
    const index = WORKFLOW_RECIPES.indexOf(recipe);
    let draft = prepareWorkflowRecipe(recipe, options, index);
    if (['pipeline-routing', 'related-deal-routing', 'stage-entry'].includes(workflowTemplateDescriptor(index)?.setup ?? '')) {
      draft = bindWorkflowTemplate(draft, index, options, { pipelineId: options.pipelines[0].id, sourceStageId, targetStageId: stageId });
    }
    draft.actions.forEach(action => {
      if (action.type === 'assign_owner') action.config.userId = userId;
      if (action.type === 'create_task' && draft.trigger.startsWith('account.')) action.config.assignmentTarget = { type: 'user', id: userId };
      if (action.type === 'send_email') { action.config.subject = 'Hello'; action.config.body = 'Follow-up message'; }
      if (action.type === 'move_deal_stage') action.config.stageId = stageId;
      if (action.type === 'update_field') action.config.value = 'https://example.test';
    });
    expect(editorIssues(editorDocument(draft), WORKFLOW_TRIGGERS, actions, options)).toEqual([]);
    expect(workflowTemplateSetupIssues(draft, index, options)).toEqual([]);
    expect(recipe).toEqual(original);
    expect(draft.isActive).toBe(false);
  });
  it('makes missing references and field replacement visible without claiming readiness', () => {
    const recipe = WORKFLOW_RECIPES.find(recipe => recipe.name === 'Contact Onboarding Handoff')!;
    const trigger = WORKFLOW_TRIGGERS.find(trigger => trigger.type === recipe.trigger)!;
    expect(templateSetup({ ...recipe, actions: [{ type: 'update_field', config: { field: 'address', value: 'New address' } }] }, trigger, getAvailableActions()).join(' ')).toContain('field will be replaced');
    expect(templateSetup(WORKFLOW_RECIPES[0], WORKFLOW_TRIGGERS[0], getAvailableActions()).join(' ')).toContain('Choose agent');
    expect(templateConditionLabel({ field: 'deal.hasEverBeenWon', operator: 'equals', value: false }, WORKFLOW_TRIGGERS.find(trigger => trigger.type === 'deal.stage_changed'))).toBe('Has ever reached Won is No');
  });
  it('describes SMS and field updates with the actions they actually perform', () => {
    expect(templateBehaviorLabel(WORKFLOW_RECIPES[32])).toBe('Send SMS');
    expect(templateBehaviorLabel(WORKFLOW_RECIPES[26])).toBe('Update fields');
    expect(WORKFLOW_RECIPES[28].conditions?.conditions).toContainEqual({ field: 'event.changedFields', operator: 'contains', value: 'assignedUserId' });
  });
  it('labels actual movement separately from stage-entry tasks and explains related targeting', () => {
    expect(templateBehaviorLabel(WORKFLOW_RECIPES[17])).toBe('Move Deal + create task');
    expect(templateBehaviorLabel(WORKFLOW_RECIPES[22])).toBe('Task on stage entry');
    expect(templateBehaviorLabel(WORKFLOW_RECIPES[23])).toBe('Move related Deal');
    expect(templateBehaviorLabel(WORKFLOW_RECIPES[34])).toBe('Move Deal stage');
    const notes = templateSetup(WORKFLOW_RECIPES[23], WORKFLOW_TRIGGERS.find(trigger => trigger.type === 'lead.status_changed'), getAvailableActions(), 23).join(' ');
    expect(notes).toContain('No matches produce no movement or task');
    expect(notes).toContain('multiple matches require review');
    expect(notes).toContain('different open source and target stages');
  });
  it('keeps new related moves task-free and Account routing event-driven', () => {
    for (const index of [23, 24]) {
      expect(WORKFLOW_RECIPES[index].conditions?.conditions).toEqual([{ field: 'event.newStatus', operator: 'equals', value: 'Hot' }]);
      expect(WORKFLOW_RECIPES[index].actions.map(action => action.type)).toEqual(['move_deal_stage']);
      expect(WORKFLOW_RECIPES[index].actions[0].config.targetMode).toBe('single_match');
    }
    expect(WORKFLOW_RECIPES[26].trigger).toBe('account.updated');
    expect(WORKFLOW_RECIPES[26].conditions).toBeUndefined();
    expect(WORKFLOW_RECIPES[26].actions.map(action => action.type)).toEqual(['update_field']);
  });
});

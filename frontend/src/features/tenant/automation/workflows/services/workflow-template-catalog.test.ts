import { describe, expect, it } from 'vitest';
import { CRM_STATUSES, getAvailableActions, WORKFLOW_TRIGGERS, WorkflowDraftSchema } from '@leadcrm/shared';
import { editorDocument, editorIssues } from './workflow-editor';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES } from './workflow-recipes';
import { templateAvailability, templateConditionLabel, templateSetup } from './workflow-template-catalog';
const userId = '30000000-0000-4000-8000-000000000001';
const stageId = '30000000-0000-4000-8000-000000000002';
const options = { users: [{ id: userId, name: 'Agent' }], pipelines: [{ id: '30000000-0000-4000-8000-000000000003', name: 'Sales', stages: [{ id: stageId, name: 'Qualified' }] }], templates: [], campaigns: [] };
describe('complete workflow recipe catalog', () => {
  it.each(WORKFLOW_RECIPES)('$name matches supported metadata and validates after configuring references', recipe => {
    const original = structuredClone(recipe);
    const actions = getAvailableActions();
    expect(WorkflowDraftSchema.safeParse(recipe).success).toBe(true);
    expect(templateAvailability(recipe, WORKFLOW_TRIGGERS, actions)).toEqual([]);
    for (const condition of recipe.conditions?.conditions ?? []) {
      if (condition.field === 'lead.status' || condition.field === 'contact.status') {
        expect(CRM_STATUSES.map(status => status.toLowerCase())).toContain(String(condition.value).toLowerCase());
      }
    }
    const draft = prepareWorkflowRecipe(recipe, options);
    draft.actions.forEach(action => {
      if (action.type === 'assign_owner') action.config.userId = userId;
      if (action.type === 'send_email') action.config.senderUserId = userId;
      if (action.type === 'move_deal_stage') action.config.stageId = stageId;
    });
    expect(editorIssues(editorDocument(draft), WORKFLOW_TRIGGERS, actions, options)).toEqual([]);
    expect(recipe).toEqual(original);
    expect(draft.isActive).toBe(false);
  });
  it('makes missing references and field replacement visible without claiming readiness', () => {
    const recipe = WORKFLOW_RECIPES.find(recipe => recipe.name === 'Contact Onboarding Handoff')!;
    const trigger = WORKFLOW_TRIGGERS.find(trigger => trigger.type === recipe.trigger)!;
    expect(templateSetup(recipe, trigger, getAvailableActions()).join(' ')).toContain('field will be replaced');
    expect(templateSetup(WORKFLOW_RECIPES[0], WORKFLOW_TRIGGERS[0], getAvailableActions()).join(' ')).toContain('Choose agent');
    expect(templateConditionLabel({ field: 'deal.hasEverBeenWon', operator: 'equals', value: false }, WORKFLOW_TRIGGERS.find(trigger => trigger.type === 'deal.stage_changed'))).toBe('Has ever reached Won is No');
  });
});

import { describe, expect, it } from 'vitest';
import type { WorkflowOptions } from '@leadcrm/shared';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES } from './workflow-recipes';
import { bindWorkflowTemplate, workflowTemplateBinding, workflowTemplateDescriptor, workflowTemplateSetupIssues, workflowTemplateStageChoices } from './workflow-template-bindings';

const options: WorkflowOptions = {
  users: [], templates: [], campaigns: [], pipelines: [
    { id: 'p1', name: 'First', stages: [
      { id: 'lead1', name: 'Lead', isWon: false, isLost: false },
      { id: 'qualified1', name: 'Qualified', isWon: false, isLost: false, requiredFields: ['email'] },
      { id: 'won1', name: 'Success', isWon: true, isLost: false },
      { id: 'lost1', name: 'Stopped', isWon: false, isLost: true },
    ] },
    { id: 'p2', name: 'Second', stages: [
      { id: 'lead2', name: 'Lead', isWon: false, isLost: false },
      { id: 'qualified2', name: 'Qualified', isWon: false, isLost: false },
    ] },
  ],
};

describe('linked workflow template setup', () => {
  it.each([18, 19, 20, 21, 30, 31])('binds outcome template %s to a stage change with the correct terminal stage', index => {
    const won = [18, 19, 30].includes(index);
    const draft = bindWorkflowTemplate(WORKFLOW_RECIPES[index], index, options, { pipelineId: 'p1', targetStageId: won ? 'won1' : 'lost1' });
    expect(draft.trigger).toBe('deal.stage_changed');
    expect(draft.conditions?.conditions).toContainEqual({ field: 'event.newStageId', operator: 'equals', value: won ? 'won1' : 'lost1' });
    expect(workflowTemplateSetupIssues(draft, index, options)).toEqual([]);
    const wrong = bindWorkflowTemplate(draft, index, options, { targetStageId: won ? 'lost1' : 'won1' });
    expect(workflowTemplateSetupIssues(wrong, index, options).join(' ')).toContain(won ? 'only as Won' : 'only as Lost');
  });
  it('resolves stable ids and numeric URLs independently of editable display names', () => {
    expect(workflowTemplateDescriptor('17')).toEqual(workflowTemplateDescriptor('pipeline-stage-routing'));
    expect(workflowTemplateDescriptor('017')).toBeUndefined();
    expect(workflowTemplateDescriptor('-1')).toBeUndefined();
    const recipe = { ...structuredClone(WORKFLOW_RECIPES[22]), name: 'My renamed follow-up' };
    const prepared = prepareWorkflowRecipe(recipe, { ...options, pipelines: [options.pipelines[0]] }, 'qualified-deal-follow-up');
    expect(prepared.name).toBe('My renamed follow-up');
    expect(workflowTemplateBinding(prepared, 22, options)).toEqual({ pipelineId: 'p1', sourceStageId: '', targetStageId: 'qualified1' });
    expect(recipe.conditions?.conditions[0].value).toBe('');
  });

  it('leaves ambiguous names and missing selections explicit and returns independent inactive copies', () => {
    const prepared = prepareWorkflowRecipe(WORKFLOW_RECIPES[22], options, 22);
    expect(prepared.conditions?.conditions[0].value).toBe('');
    expect(workflowTemplateSetupIssues(prepared, 22, options).join(' ')).toContain('Choose');
    const copy = prepareWorkflowRecipe({ ...WORKFLOW_RECIPES[17], isActive: true }, options, 17);
    expect(copy.isActive).toBe(false);
    copy.actions[0].config.stageId = 'qualified1';
    expect(WORKFLOW_RECIPES[17].actions[0].config.stageId).toBe('');
  });

  it('binds Deal routing conditions and action together without unsupported config properties', () => {
    const original = structuredClone(WORKFLOW_RECIPES[17]);
    const draft = bindWorkflowTemplate(original, 17, options, { pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'qualified1' });
    expect(workflowTemplateBinding(draft, 17, options)).toEqual({ pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'qualified1' });
    expect(draft.conditions?.conditions).toEqual([
      { field: 'deal.pipelineId', operator: 'equals', value: 'p1' },
      { field: 'deal.stageId', operator: 'equals', value: 'lead1' },
    ]);
    expect(draft.actions[0].config).toEqual({ stageId: 'qualified1' });
    expect(workflowTemplateSetupIssues(draft, 17, options)).toEqual([]);
    expect(original).toEqual(WORKFLOW_RECIPES[17]);
    const changed = bindWorkflowTemplate(draft, 17, options, { pipelineId: 'p2' });
    expect(workflowTemplateBinding(changed, 17, options)).toEqual({ pipelineId: 'p2', sourceStageId: '', targetStageId: '' });
    expect(changed.actions[1]).toEqual(draft.actions[1]);
  });

  it.each([23, 24])('links related routing %s through canonical stage ids and preserves targeting', index => {
    const draft = bindWorkflowTemplate(WORKFLOW_RECIPES[index], index, options, { pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'qualified1' });
    expect(workflowTemplateBinding(draft, index, options)).toEqual({ pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'qualified1' });
    expect(draft.actions[0].config).toEqual({ currentStageId: 'lead1', stageId: 'qualified1', targetMode: 'single_match' });
    expect(draft.conditions).toEqual(WORKFLOW_RECIPES[index].conditions);
    expect(workflowTemplateSetupIssues(draft, index, options)).toEqual([]);
    expect(workflowTemplateBinding(WORKFLOW_RECIPES[index], index, options, 'p2').pipelineId).toBe('p2');
    const changed = bindWorkflowTemplate(draft, index, options, { pipelineId: 'p2' });
    expect(changed.actions[0].config).toEqual({ currentStageId: '', stageId: '', targetMode: 'single_match' });
  });

  it('rejects same-stage, mismatched, unavailable and terminal movement without guessing from names', () => {
    const same = bindWorkflowTemplate(WORKFLOW_RECIPES[17], 17, options, { pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'lead1' });
    expect(workflowTemplateSetupIssues(same, 17, options)).toContain('Choose different source and target stages.');
    const terminal = bindWorkflowTemplate(WORKFLOW_RECIPES[17], 17, options, { pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'won1' });
    expect(workflowTemplateSetupIssues(terminal, 17, options).join(' ')).toContain('open target stage');
    const mismatched = structuredClone(same);
    mismatched.actions[0].config.stageId = 'qualified2';
    expect(workflowTemplateSetupIssues(mismatched, 17, options)).toContain('The target stage must belong to the selected pipeline.');
    mismatched.actions[0].config.stageId = 'unavailable';
    expect(workflowTemplateSetupIssues(mismatched, 17, options).join(' ')).toContain('unavailable');
    expect(workflowTemplateStageChoices(options, 'p1').map(stage => stage.id)).toEqual(['lead1', 'qualified1']);
    expect(workflowTemplateStageChoices(options, 'p1')[1].requiredFields).toEqual(['email']);
    const renamed = { ...options, pipelines: [{ ...options.pipelines[0], stages: options.pipelines[0].stages.map(stage => ({ ...stage, name: 'Renamed' })) }] };
    expect(workflowTemplateSetupIssues(same, 17, renamed)).toContain('Choose different source and target stages.');
    expect(workflowTemplateStageChoices(renamed, 'p1').map(stage => stage.id)).toEqual(['lead1', 'qualified1']);
  });

  it('binds stage-entry tasks to a pipeline and allows deliberate terminal entries', () => {
    const draft = bindWorkflowTemplate(WORKFLOW_RECIPES[25], 25, options, { targetStageId: 'won1' });
    expect(workflowTemplateBinding(draft, 25, options)).toEqual({ pipelineId: 'p1', sourceStageId: '', targetStageId: 'won1' });
    expect(workflowTemplateSetupIssues(draft, 25, options)).toEqual([]);
    expect(draft.actions.map(action => action.type)).toEqual(['create_task']);
  });

  it('preserves customized drafts and detects incoherent linked conditions', () => {
    const changedTrigger = { ...WORKFLOW_RECIPES[17], trigger: 'deal.updated' };
    expect(bindWorkflowTemplate(changedTrigger, 17, options, { pipelineId: 'p1' })).toEqual(changedTrigger);
    expect(workflowTemplateSetupIssues(changedTrigger, 17, options)).toEqual([]);
    const draft = bindWorkflowTemplate(WORKFLOW_RECIPES[17], 17, options, { pipelineId: 'p1', sourceStageId: 'lead1', targetStageId: 'qualified1' });
    draft.conditions!.operator = 'OR';
    expect(workflowTemplateSetupIssues(draft, 17, options).join(' ')).toContain('AND');
    draft.conditions!.conditions.push({ field: 'deal.pipelineId', operator: 'not_equals', value: 'p2' });
    expect(workflowTemplateSetupIssues(draft, 17, options).join(' ')).toContain('Repair');
  });
});

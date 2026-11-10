import { describe, expect, it } from 'vitest';
import { getAvailableActions, WORKFLOW_TRIGGERS, WorkflowDraftSchema, type WorkflowOptions } from '@leadcrm/shared';
import { bindWorkflowTemplate, workflowTemplateBinding, workflowTemplateDescriptor, workflowTemplateSetupIssues } from './workflow-template-bindings';
import { editorDocument, editorIssues } from './workflow-editor';
import { templateAvailability } from './workflow-template-catalog';
import { WORKFLOW_RECIPES } from './workflow-recipes';
import { resolveWorkflowTemplate, workflowTemplateCatalog, workflowTemplateConfigurationNotes, WORKFLOW_UNSUPPORTED_SCENARIOS } from './workflow-stage-templates';

const uid = (number: number) => `40000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const pipelineId = uid(1), otherPipelineId = uid(2), ownerId = uid(3);
const options: WorkflowOptions = { users: [{ id: ownerId, name: 'Sales agent' }], taskAssignees: [{ id: ownerId, name: 'Sales agent' }], templates: [], campaigns: [], pipelines: [
  { id: pipelineId, name: 'Sales', stages: [
    { id: uid(10), name: 'Lead', order: 0, isDefault: true, isWon: false, isLost: false },
    { id: uid(11), name: 'Contacted', order: 1, isWon: false, isLost: false },
    { id: uid(12), name: 'Qualified', order: 2, requiredFields: ['accountId'], isWon: false, isLost: false },
    { id: uid(13), name: 'Implementation approved', order: 3, isWon: true, isLost: false },
    { id: uid(14), name: 'Declined', order: 4, isWon: false, isLost: true },
    { id: uid(15), name: 'Commercial review', order: 5, isWon: false, isLost: false },
  ] },
  { id: otherPipelineId, name: 'Other', stages: [{ id: uid(20), name: 'Lead', order: 0, isDefault: true }, { id: uid(21), name: 'Qualified', order: 1 }] },
] };

describe('configured stage workflow catalog', () => {
  it('keeps the chooser small regardless of pipelines or stages', () => {
    const entries = workflowTemplateCatalog(options);
    expect(entries).toHaveLength(14);
    expect(entries.some(entry => entry.id.startsWith('stage:'))).toBe(false);
    expect(workflowTemplateCatalog({ ...options, pipelines: [] }).map(entry => entry.id)).toEqual(entries.map(entry => entry.id));
    expect(entries.filter(entry => entry.recipe.trigger.startsWith('deal.')).map(entry => entry.recipe.name)).toEqual([
      'New Deal Created', 'Deal Stage Changed', 'Deal Entered a Specific Stage', 'Automatic Deal Stage Update',
      'Move New Deal Stage', 'Deal Marked as Won', 'Deal Marked as Lost', 'Deal Assigned',
    ]);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.recipe.isActive).toBe(false);
      expect(WorkflowDraftSchema.safeParse(entry.recipe).success).toBe(true);
      expect(templateAvailability(entry.recipe, WORKFLOW_TRIGGERS, getAvailableActions())).toEqual([]);
      expect(entry.prerequisites.length).toBeGreaterThan(0);
      expect(entry.repeatPolicy).toBeTruthy(); expect(entry.expectedResult).toBeTruthy();
    }
  });

  it('retains generated stage links for every current stage without offering duplicate cards', () => {
    for (const pipeline of options.pipelines) for (const stage of pipeline.stages) {
      const identity = `stage:${stage.isWon ? 'won' : stage.isLost ? 'lost' : 'entry'}:${pipeline.id}:${stage.id}`;
      const entry = resolveWorkflowTemplate(identity, options)!;
      expect(entry).toBeDefined();
      expect(workflowTemplateBinding(entry.recipe, identity, options)).toMatchObject({ pipelineId: pipeline.id, targetStageId: stage.id });
      expect(workflowTemplateSetupIssues(entry.recipe, identity, options)).toEqual([]);
      expect(editorIssues(editorDocument(entry.recipe), WORKFLOW_TRIGGERS, getAvailableActions(), options)).toEqual([]);
    }
    for (const identity of [`stage:created:${pipelineId}:${uid(10)}`, `stage:assign:${pipelineId}:${uid(11)}`, `stage:reopen:${pipelineId}:${uid(12)}:${uid(14)}`]) {
      expect(resolveWorkflowTemplate(identity, options)).toBeDefined();
    }
  });

  it('keeps numeric and stable starter URLs compatible and refuses removed or invented dynamic identities', () => {
    for (const [index, recipe] of WORKFLOW_RECIPES.entries()) expect(resolveWorkflowTemplate(String(index), options)?.recipe.name).toBe(recipe.name);
    expect(resolveWorkflowTemplate('won-deal-handoff', options)?.recipe.name).toBe(WORKFLOW_RECIPES[18].name);
    const identity = `stage:entry:${pipelineId}:${uid(11)}`;
    const before = resolveWorkflowTemplate(identity, options)!;
    const renamed = structuredClone(options); renamed.pipelines[0].name = 'Renamed pipeline'; renamed.pipelines[0].stages[1].name = 'Renamed contacted';
    expect(resolveWorkflowTemplate(identity, renamed)?.recipe.name).toContain('Renamed contacted');
    before.recipe.name = 'My custom workflow'; before.recipe.actions[0].config.title = 'My task';
    expect(resolveWorkflowTemplate(identity, options)?.recipe.name).not.toBe('My custom workflow');
    const removed = structuredClone(options); removed.pipelines[0].stages.splice(1, 1);
    expect(resolveWorkflowTemplate(identity, removed)).toBeUndefined();
    expect(resolveWorkflowTemplate(`stage:entry:${otherPipelineId}:${uid(11)}`, options)).toBeUndefined();
    expect(workflowTemplateDescriptor('stage:__proto__:p:s')).toBeUndefined();
    for (const unavailable of ['', '-1', '01', '999', 'stage:timer:p:s']) expect(resolveWorkflowTemplate(unavailable, options)).toBeUndefined();
  });

  it('preserves explicit edits while setup detects unavailable, terminal and incompatible reopen selections', () => {
    const identity = `stage:entry:${pipelineId}:${uid(11)}`;
    const draft = resolveWorkflowTemplate(identity, options)!.recipe;
    draft.name = 'Administrator customization'; draft.actions[0].config.title = 'Preserve title'; draft.actions[0].config.dueDaysFromNow = 4;
    const changed = bindWorkflowTemplate(draft, identity, options, { pipelineId: otherPipelineId, targetStageId: uid(21) });
    expect(changed.name).toBe(draft.name); expect(changed.actions).toEqual(draft.actions);
    const missing = structuredClone(options); missing.pipelines = [];
    expect(workflowTemplateSetupIssues(draft, identity, missing).join(' ')).toContain('unavailable');
    const terminal = bindWorkflowTemplate(draft, identity, options, { targetStageId: uid(13) });
    expect(workflowTemplateSetupIssues(terminal, identity, options).join(' ')).toContain('open');
    const reopenId = `stage:reopen:${pipelineId}:${uid(12)}:${uid(14)}`;
    const invalid = bindWorkflowTemplate(resolveWorkflowTemplate(reopenId, options)!.recipe, reopenId, options, { sourceStageId: uid(13), targetStageId: uid(11) });
    expect(workflowTemplateSetupIssues(invalid, reopenId, options).join(' ')).toContain('Lost source');
  });

  it('makes missing/ambiguous initial stages, invalid terminal flags and unsupported timers explicit', () => {
    const custom = structuredClone(options);
    custom.pipelines[0].stages[0].name = 'Intake';
    custom.pipelines[0].stages[2].name = 'Evaluated';
    custom.pipelines[0].stages[3].isLost = true;
    expect(resolveWorkflowTemplate(`stage:created:${pipelineId}:${uid(10)}`, custom)).toBeUndefined();
    expect(resolveWorkflowTemplate(`stage:reopen:${pipelineId}:${uid(12)}:${uid(14)}`, custom)).toBeUndefined();
    expect(resolveWorkflowTemplate(`stage:won:${pipelineId}:${uid(13)}`, custom)).toBeUndefined();
    expect(workflowTemplateConfigurationNotes(custom).join(' ')).toContain('exactly one open Lead');
    expect(workflowTemplateConfigurationNotes(custom).join(' ')).toContain('conflicting Won and Lost');
    expect(WORKFLOW_UNSUPPORTED_SCENARIOS.join(' ')).toContain('overdue Task timers are unavailable');
    custom.pipelines[1].stages.push({ id: uid(22), name: 'Lead' });
    expect(resolveWorkflowTemplate(`stage:created:${otherPipelineId}:${uid(20)}`, custom)).toBeUndefined();
  });

  it('treats configured stage labels as plain text rather than message variables', () => {
    const custom = structuredClone(options);
    custom.pipelines[0].stages[5].name = '{{not_a_variable}}';
    const recipe = resolveWorkflowTemplate(`stage:entry:${pipelineId}:${uid(15)}`, custom)!.recipe;
    expect(recipe.name).toContain('{{not_a_variable}}');
    expect(recipe.actions[0].config.title).not.toContain('{{');
    expect(recipe.actions[0].config.description).not.toContain('{{');
  });
});

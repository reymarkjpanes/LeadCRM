import type { WorkflowDraft, WorkflowOptions } from '@leadcrm/shared';
import { bindWorkflowTemplate, workflowTemplateDescriptor, type WorkflowStageScenario } from './workflow-template-bindings';
import { prepareWorkflowRecipe, WORKFLOW_RECIPES, WORKFLOW_STARTER_TEMPLATES } from './workflow-recipes';

export interface WorkflowTemplateEntry {
  id: string;
  identity: number | string;
  recipe: WorkflowDraft;
  pipelineName?: string;
  stageName?: string;
  prerequisites: string[];
  expectedResult: string;
  repeatPolicy: string;
}

export const WORKFLOW_UNSUPPORTED_SCENARIOS = [
  'Waiting, inactivity and overdue Task timers are unavailable. Due dates schedule Task work; they do not start another workflow.',
  'Won Deals cannot reopen. Create a new Deal for a new opportunity.',
  'Deal Assigned matches changes to the assigned agent. Stage-entry templates require an actual stage entry.',
  'Tasks and Campaigns do not expose workflow triggers. Task assignment and due reminders use the existing notification system; Send Campaign and manual notification actions are retired.',
] as const;

export function workflowTemplateConfigurationNotes(options: WorkflowOptions): string[] {
  return options.pipelines.flatMap(pipeline => {
    const notes: string[] = [];
    if (pipeline.stages.filter(stage => !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'lead').length !== 1) notes.push(`${pipeline.name}: initial creation needs exactly one open Lead stage. Stage-entry templates remain available.`);
    if (pipeline.stages.some(stage => stage.isLost) && !pipeline.stages.some(stage => !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'qualified')) notes.push(`${pipeline.name}: Lost reopening is unavailable until an open Qualified stage exists.`);
    for (const stage of pipeline.stages.filter(stage => stage.isWon && stage.isLost)) notes.push(`${pipeline.name} / ${stage.name}: conflicting Won and Lost flags require repair before a template can be offered.`);
    return notes;
  });
}

type Pipeline = WorkflowOptions['pipelines'][number];
type Stage = Pipeline['stages'][number];

const currentEntryRepeat = 'One Task per genuine entry while the Deal remains in that stage. Retries and repeated unchanged stage clicks do not create another Task. Superseded queued entries are skipped; a later allowed re-entry can create another Task.';

function commonPrerequisites(recipe: WorkflowDraft): string[] {
  const recordType = recipe.trigger.split('.')[0];
  const notes = ['An active triggering record in this workspace and an authorized event actor.', 'The activating user must retain the trigger-record and action permissions. Save as a draft and activate through the existing controls.'];
  if (recipe.actions.some(action => action.type === 'create_task')) {
    notes.push('An active eligible Task assignee is required. Record-owner assignment has no fallback when the owner is missing, inactive or ineligible.');
    if (recordType !== 'deal') notes.push('A connected eligible Deal is required. No Deal fails clearly; several related Deals require an explicit connected Deal ID. Archived or foreign Deals are ineligible.');
    else notes.push('The Task links to the triggering persisted Deal. Archived Deals are ineligible.');
  }
  if (recipe.actions.some(action => action.type === 'assign_owner')) notes.push('Choose an eligible agent, Role or Group. Pools use round-robin and fail if no eligible member is available; there is no fallback outside the pool.');
  if (recipe.trigger === 'deal.stage_changed' && recipe.actions.some(action => action.type === 'create_task')) notes.push('Use the general stage-change template or the specific-stage template for the same task. Independent matching workflows each execute their own actions.');
  return notes;
}

function expectedResult(recipe: WorkflowDraft): string {
  const tasks = recipe.actions.filter(action => action.type === 'create_task').length;
  return tasks
    ? `${tasks} persisted linked ${tasks === 1 ? 'Task' : 'Tasks'} with a real ID, visible in Taskboard and the related Deal views. Missing associations, assignees or permissions produce a failed action with a reason; later actions skip. Independent overlapping workflows can each create a Task.`
    : 'The configured actions use the existing domain services. Execution history records actual success, failure or no movement; later actions skip after failure.';
}

function stagePurpose(stage: Stage): { title: string; description: string; due: number; priority: 'Medium' } {
  if (stage.isWon) return { title: 'Arrange won Deal handoff', description: 'Coordinate the completed opportunity handoff and confirm the next responsible agent.', due: 1, priority: 'Medium' };
  if (stage.isLost) return { title: 'Review lost Deal outcome', description: 'Review the recorded loss reason and document useful follow-up observations.', due: 3, priority: 'Medium' };
  if (stage.name.trim().toLowerCase() === 'lead') return { title: 'Complete first Deal outreach', description: 'Review the opportunity and contact the associated prospect to establish the next step.', due: 1, priority: 'Medium' };
  if (stage.name.trim().toLowerCase() === 'contacted') return { title: 'Confirm discovery and next conversation', description: 'Review the outreach outcome and arrange the next qualification conversation.', due: 1, priority: 'Medium' };
  if (stage.name.trim().toLowerCase() === 'qualified') return { title: 'Follow up on qualified Deal', description: 'Confirm requirements and agree the next proposal or decision step.', due: 1, priority: 'Medium' };
  // A stage label is plain record text, never an administrator-authored message variable.
  const label = stage.name.replaceAll('{{', '').replaceAll('}}', '').replace(/[\r\n\t]/g, ' ');
  return { title: `Complete next action for ${label}`, description: `Review the ${label} stage requirements and agree the next action.`, due: 1, priority: 'Medium' };
}

function stageEntry(pipeline: Pipeline, stage: Stage, scenario: WorkflowStageScenario, source?: Stage): WorkflowTemplateEntry {
  const id = `stage:${scenario}:${pipeline.id}:${stage.id}${source ? ':' + source.id : ''}`;
  const purpose = stagePurpose(stage);
  const recipe = structuredClone(WORKFLOW_RECIPES[scenario === 'won' ? 18 : scenario === 'lost' ? 20 : scenario === 'reopen' || stage.name.trim().toLowerCase() === 'qualified' ? 22 : 25]);
  recipe.trigger = workflowTemplateDescriptor(id)!.trigger;
  const label = scenario === 'created' ? 'Initial follow-up' : scenario === 'assign' ? 'Assign agent and follow up' : scenario === 'reopen' ? `Reopen from ${source!.name}` : stage.isWon ? 'Won handoff' : stage.isLost ? 'Lost outcome review' : 'Stage entry follow-up';
  recipe.name = `${pipeline.name} / ${stage.name}: ${label}`.slice(0, 255);
  recipe.description = purpose.description;
  recipe.isActive = false;
  // Creation binds the current stage; all stage changes bind transition evidence.
  recipe.conditions = { operator: 'AND', conditions: [] };
  if (!stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'qualified') {
    recipe.conditions.conditions.push({ field: 'deal.hasEverBeenWon', operator: 'equals', value: false }, { field: 'deal.wonHistoryVerified', operator: 'equals', value: true });
  }
  recipe.actions = [{ type: 'create_task', config: {
    title: purpose.title.slice(0, 255), description: purpose.description.slice(0, 10000),
    dueDaysFromNow: purpose.due, priority: purpose.priority, assignmentTarget: { type: 'record_owner' },
  } }];
  if (scenario === 'assign') recipe.actions.unshift({ type: 'assign_owner', config: {} });
  const bound = bindWorkflowTemplate(recipe, id, { users: [], templates: [], campaigns: [], pipelines: [pipeline] }, { pipelineId: pipeline.id, targetStageId: stage.id, sourceStageId: source?.id ?? '' });
  const prerequisites = commonPrerequisites(bound);
  if (stage.requiredFields?.length) prerequisites.push(`Stage entry requires: ${stage.requiredFields.join(', ')}. These templates do not supply missing stage evidence.`);
  if (stage.isWon) prerequisites.push('Close the Deal through the governed Won controls with the required closing evidence. Won Deals cannot reopen.');
  if (stage.isLost) prerequisites.push('Close the Deal through the governed Lost controls. Manual closing retains its reason requirement; automated stage actions can omit the reason.');
  if (!stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'qualified') prerequisites.push('Qualified follow-up requires verified stage history and a Deal that has never been Won.');
  if (scenario === 'reopen') prerequisites.push('The Lost Deal must never have been Won, its history must be verified, and the target must be an open Qualified stage. Use this as an alternative to the general Qualified entry template to avoid overlapping Tasks.');
  if (scenario === 'assign') prerequisites.push('This is an alternative to the follow-up-only template for this entry. An existing owner can be reassigned only through the selected ownership rules.');
  return { id, identity: id, recipe: bound, pipelineName: pipeline.name, stageName: stage.name, prerequisites,
    expectedResult: expectedResult(bound), repeatPolicy: scenario === 'created' ? 'One first follow-up per created Deal event. Stage entry and later ordinary edits do not repeat this creation workflow.' : currentEntryRepeat };
}

/** One editable template per scenario, independent of the number of configured stages. */
export function workflowTemplateCatalog(_options: WorkflowOptions): WorkflowTemplateEntry[] {
  const starters: WorkflowTemplateEntry[] = WORKFLOW_STARTER_TEMPLATES.map(({ id, index, recipe }) => ({ id, identity: index, recipe: structuredClone(recipe),
    prerequisites: commonPrerequisites(recipe), expectedResult: expectedResult(recipe),
    repeatPolicy: recipe.trigger.endsWith('.created') ? 'Once per created record event; retries reuse that event.' : recipe.trigger.startsWith('deal.') && !recipe.trigger.endsWith('.updated') ? currentEntryRepeat : 'Each distinct matching record-change event may run. Duplicate delivery of the same event does not run again.' }));
  return starters;
}

/** Retain previously shared stage-template URLs without adding them to the chooser. */
function legacyStageTemplates(options: WorkflowOptions): WorkflowTemplateEntry[] {
  return options.pipelines.flatMap(pipeline => {
    const stages = [...pipeline.stages].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
    const initial = stages.filter(stage => !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'lead');
    const lost = stages.filter(stage => stage.isLost && !stage.isWon);
    return stages.flatMap(stage => {
      // Conflicting terminal flags are invalid configuration, not a promised outcome.
      if (stage.isWon && stage.isLost) return [];
      if (stage.isWon || stage.isLost) return [stageEntry(pipeline, stage, stage.isWon ? 'won' : 'lost')];
      const entries = [stageEntry(pipeline, stage, 'entry'), stageEntry(pipeline, stage, 'assign')];
      if (initial.length === 1 && stage.id === initial[0].id) entries.unshift(stageEntry(pipeline, stage, 'created'));
      if (stage.name.trim().toLowerCase() === 'qualified') entries.push(...lost.map(source => stageEntry(pipeline, stage, 'reopen', source)));
      return entries;
    });
  });
}

/** Old numeric URLs and stable starter IDs remain readable; dynamic identities must still exist. */
export function resolveWorkflowTemplate(identity: number | string, options: WorkflowOptions): { recipe: WorkflowDraft; identity: number | string } | undefined {
  const index = typeof identity === 'number' ? identity : /^(0|[1-9]\d*)$/.test(identity) ? Number(identity) : undefined;
  if (index !== undefined) return WORKFLOW_RECIPES[index] ? { recipe: prepareWorkflowRecipe(WORKFLOW_RECIPES[index], options, index), identity: index } : undefined;
  const descriptor = workflowTemplateDescriptor(identity);
  if (descriptor && !String(identity).startsWith('stage:')) return { recipe: prepareWorkflowRecipe(WORKFLOW_RECIPES[descriptor.index], options, identity), identity };
  const entry = legacyStageTemplates(options).find(template => template.id === identity);
  if (!entry) return undefined;
  return { recipe: entry.id.startsWith('stage:') ? structuredClone(entry.recipe) : prepareWorkflowRecipe(entry.recipe, options, entry.id), identity: entry.id };
}

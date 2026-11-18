import type { WorkflowDraft, WorkflowOptions } from '@leadcrm/shared';

export type WorkflowTemplateSetup = 'none' | 'pipeline-routing' | 'related-deal-routing' | 'stage-entry' | 'qualified-entry' | 'open-entry' | 'initial-entry' | 'won-entry' | 'lost-entry' | 'reopen-entry';
export type WorkflowStageScenario = 'created' | 'entry' | 'assign' | 'won' | 'lost' | 'reopen';
export interface WorkflowTemplateDescriptor {
  id: string;
  index: number;
  trigger: string;
  setup: WorkflowTemplateSetup;
}

/** Stable identities are independent of editable names and existing numeric template URLs. */
export const WORKFLOW_TEMPLATE_DESCRIPTORS: WorkflowTemplateDescriptor[] = [
  { id: 'new-lead-follow-up', index: 0, trigger: 'lead.created', setup: 'none' },
  { id: 'hot-lead-urgent-response', index: 1, trigger: 'lead.status_changed', setup: 'none' },
  { id: 'new-lead-email-welcome', index: 7, trigger: 'lead.created', setup: 'none' },
  { id: 'contact-onboarding-handoff', index: 8, trigger: 'contact.created', setup: 'none' },
  { id: 'at-risk-contact-follow-up', index: 10, trigger: 'contact.status_changed', setup: 'none' },
  { id: 'qualified-deal-follow-up', index: 22, trigger: 'deal.stage_changed', setup: 'qualified-entry' },
  { id: 'high-value-deal-review', index: 13, trigger: 'deal.created', setup: 'none' },
  { id: 'won-deal-handoff', index: 18, trigger: 'deal.stage_changed', setup: 'won-entry' },
  { id: 'major-won-deal-kickoff', index: 19, trigger: 'deal.stage_changed', setup: 'won-entry' },
  { id: 'lost-deal-analysis', index: 20, trigger: 'deal.stage_changed', setup: 'lost-entry' },
  { id: 'high-value-lost-deal-review', index: 21, trigger: 'deal.stage_changed', setup: 'lost-entry' },
  { id: 'website-inbound-lead-triage', index: 2, trigger: 'lead.created', setup: 'none' },
  { id: 'warm-lead-discovery-preparation', index: 3, trigger: 'lead.status_changed', setup: 'none' },
  { id: 'pipeline-stage-routing', index: 17, trigger: 'deal.created', setup: 'pipeline-routing' },
  { id: 'hot-lead-related-deal-routing', index: 23, trigger: 'lead.status_changed', setup: 'related-deal-routing' },
  { id: 'hot-contact-related-deal-routing', index: 24, trigger: 'contact.status_changed', setup: 'related-deal-routing' },
  { id: 'selected-stage-entry-follow-up', index: 25, trigger: 'deal.stage_changed', setup: 'stage-entry' },
  { id: 'account-update-follow-up', index: 26, trigger: 'account.updated', setup: 'none' },
  { id: 'new-deal-created', index: 27, trigger: 'deal.created', setup: 'none' },
  { id: 'deal-assignment-follow-up', index: 28, trigger: 'deal.updated', setup: 'none' },
  { id: 'deal-follow-up-email', index: 29, trigger: 'deal.stage_changed', setup: 'stage-entry' },
  { id: 'won-deal-thank-you-email', index: 30, trigger: 'deal.stage_changed', setup: 'won-entry' },
  { id: 'lost-deal-follow-up', index: 31, trigger: 'deal.stage_changed', setup: 'lost-entry' },
  { id: 'new-lead-sms-acknowledgment', index: 32, trigger: 'lead.created', setup: 'none' },
  { id: 'contact-welcome-email-template', index: 33, trigger: 'contact.created', setup: 'none' },
  { id: 'deal-stage-changed', index: 16, trigger: 'deal.stage_changed', setup: 'none' },
  { id: 'automatic-deal-stage-update', index: 34, trigger: 'deal.updated', setup: 'pipeline-routing' },
];

export function workflowTemplateDescriptor(identity: number | string | undefined): WorkflowTemplateDescriptor | undefined {
  if (identity === undefined) return undefined;
  const index = typeof identity === 'number' ? identity : /^(0|[1-9]\d*)$/.test(identity) ? Number(identity) : undefined;
  const saved = WORKFLOW_TEMPLATE_DESCRIPTORS.find(template => index === undefined ? template.id === identity : template.index === index);
  if (saved || typeof identity !== 'string') return saved;
  const parts = identity.split(':');
  if (parts[0] !== 'stage' || !parts[2] || !parts[3]) return undefined;
  const scenario = parts[1] as WorkflowStageScenario;
  if (parts.length !== (scenario === 'reopen' ? 5 : 4) || scenario === 'reopen' && !parts[4]) return undefined;
  const definitions: Record<WorkflowStageScenario, Pick<WorkflowTemplateDescriptor, 'index' | 'trigger' | 'setup'>> = {
    created: { index: 25, trigger: 'deal.created', setup: 'initial-entry' },
    entry: { index: 25, trigger: 'deal.stage_changed', setup: 'open-entry' },
    assign: { index: 25, trigger: 'deal.stage_changed', setup: 'open-entry' },
    won: { index: 18, trigger: 'deal.stage_changed', setup: 'won-entry' },
    lost: { index: 20, trigger: 'deal.stage_changed', setup: 'lost-entry' },
    reopen: { index: 22, trigger: 'deal.stage_changed', setup: 'reopen-entry' },
  };
  return Object.prototype.hasOwnProperty.call(definitions, scenario) ? { id: identity, ...definitions[scenario] } : undefined;
}

type Stage = WorkflowOptions['pipelines'][number]['stages'][number];
type StageReference = { pipelineId: string; stage: Stage };
export interface WorkflowTemplateBinding {
  pipelineId: string;
  sourceStageId: string;
  targetStageId: string;
}
export type WorkflowTemplateBindingPatch = Partial<WorkflowTemplateBinding>;

function stageReference(options: WorkflowOptions, id: string): StageReference | undefined {
  const matches = options.pipelines.flatMap(pipeline => pipeline.stages.filter(stage => stage.id === id).map(stage => ({ pipelineId: pipeline.id, stage })));
  return matches.length === 1 ? matches[0] : undefined;
}
function conditionValue(draft: WorkflowDraft, field: string): string {
  const matches = draft.conditions?.conditions.filter(rule => rule.field === field && rule.operator === 'equals') ?? [];
  return matches.length === 1 && typeof matches[0].value === 'string' ? matches[0].value : '';
}
function moveAction(draft: WorkflowDraft) {
  const actions = draft.actions.filter(action => action.type === 'move_deal_stage');
  return actions.length === 1 ? actions[0] : undefined;
}
function bindingDescriptor(draft: WorkflowDraft, identity: number | string | undefined) {
  const descriptor = workflowTemplateDescriptor(identity);
  return descriptor?.trigger === draft.trigger && descriptor.setup !== 'none' ? descriptor : undefined;
}

function entryField(setup: WorkflowTemplateSetup): string {
  return setup === 'initial-entry' ? 'deal.stageId' : 'event.newStageId';
}

/** Terminal flags are authoritative; missing flags remain compatible with older options. */
export function workflowTemplateStageChoices(options: WorkflowOptions, pipelineId: string, openOnly = true): Stage[] {
  return (options.pipelines.find(pipeline => pipeline.id === pipelineId)?.stages ?? []).filter(stage => !openOnly || !stage.isWon && !stage.isLost);
}

export function workflowTemplateBinding(draft: WorkflowDraft, identity: number | string | undefined, options: WorkflowOptions, localPipelineId = ''): WorkflowTemplateBinding {
  const descriptor = bindingDescriptor(draft, identity);
  if (!descriptor) return { pipelineId: '', sourceStageId: '', targetStageId: '' };
  const related = descriptor.setup === 'related-deal-routing';
  const move = moveAction(draft);
  const targetStageId = related || descriptor.setup === 'pipeline-routing' ? String(move?.config.stageId ?? '') : conditionValue(draft, entryField(descriptor.setup));
  const sourceStageId = related ? String(move?.config.currentStageId ?? '') : descriptor.setup === 'pipeline-routing' ? conditionValue(draft, 'deal.stageId') : descriptor.setup === 'reopen-entry' ? conditionValue(draft, 'event.previousStageId') : '';
  const pipelineId = related
    ? stageReference(options, targetStageId)?.pipelineId ?? stageReference(options, sourceStageId)?.pipelineId ?? localPipelineId
    : conditionValue(draft, 'deal.pipelineId') || localPipelineId;
  return { pipelineId, sourceStageId, targetStageId };
}

function setCondition(draft: WorkflowDraft, field: string, value: string) {
  draft.conditions ??= { operator: 'AND', conditions: [] };
  const matches = draft.conditions.conditions.filter(rule => rule.field === field);
  // An intentional setup edit repairs duplicate/customized binding rules explicitly.
  if (matches.length === 1) {
    Object.assign(matches[0], { operator: 'equals', value });
    delete matches[0].incompleteValue;
  } else {
    draft.conditions.conditions = draft.conditions.conditions.filter(rule => rule.field !== field);
    draft.conditions.conditions.push({ field, operator: 'equals', value });
  }
}

/** One setup edit updates every persisted condition/action that participates in that binding. */
export function bindWorkflowTemplate(draft: WorkflowDraft, identity: number | string | undefined, options: WorkflowOptions, patch: WorkflowTemplateBindingPatch): WorkflowDraft {
  const descriptor = bindingDescriptor(draft, identity);
  if (!descriptor) return structuredClone(draft);
  const next = structuredClone(draft);
  const previous = workflowTemplateBinding(draft, identity, options);
  const binding = { ...previous, ...patch };
  if (patch.pipelineId !== undefined) {
    if (stageReference(options, binding.sourceStageId)?.pipelineId !== binding.pipelineId) binding.sourceStageId = '';
    if (stageReference(options, binding.targetStageId)?.pipelineId !== binding.pipelineId) binding.targetStageId = '';
  } else {
    const changedStage = patch.targetStageId || patch.sourceStageId;
    const reference = changedStage && stageReference(options, changedStage);
    if (reference) {
      binding.pipelineId = reference.pipelineId;
      if (stageReference(options, binding.sourceStageId)?.pipelineId !== binding.pipelineId) binding.sourceStageId = '';
      if (stageReference(options, binding.targetStageId)?.pipelineId !== binding.pipelineId) binding.targetStageId = '';
    }
  }
  const move = moveAction(next);
  if (descriptor.setup === 'related-deal-routing') {
    if (move) Object.assign(move.config, { currentStageId: binding.sourceStageId, stageId: binding.targetStageId });
  } else {
    setCondition(next, 'deal.pipelineId', binding.pipelineId);
    if (descriptor.setup === 'pipeline-routing') {
      setCondition(next, 'deal.stageId', binding.sourceStageId);
      if (move) move.config.stageId = binding.targetStageId;
    } else {
      setCondition(next, entryField(descriptor.setup), binding.targetStageId);
      if (descriptor.setup === 'reopen-entry') setCondition(next, 'event.previousStageId', binding.sourceStageId);
    }
  }
  return next;
}

export function workflowTemplateSetupIssues(draft: WorkflowDraft, identity: number | string | undefined, options: WorkflowOptions): string[] {
  const descriptor = bindingDescriptor(draft, identity);
  if (!descriptor) return [];
  const binding = workflowTemplateBinding(draft, identity, options);
  const issues: string[] = [];
  const pipeline = options.pipelines.find(pipeline => pipeline.id === binding.pipelineId);
  if (!pipeline) issues.push(binding.pipelineId ? 'The selected template pipeline is unavailable. Choose a current pipeline.' : 'Choose a pipeline for this template.');
  if (draft.conditions?.operator !== 'AND') issues.push('Linked template setup requires all conditions (AND). Switch to AND or customize this workflow without template setup.');
  const routing = ['pipeline-routing', 'related-deal-routing'].includes(descriptor.setup);
  if (routing && !moveAction(draft)) issues.push('Linked routing setup requires exactly one Move Deal Stage action.');
  const required = routing || descriptor.setup === 'reopen-entry' ? [['source', binding.sourceStageId], ['target', binding.targetStageId]] : [['entry', binding.targetStageId]];
  for (const [role, id] of required) {
    const reference = stageReference(options, id);
    if (!reference) issues.push(id ? `The selected ${role} stage is unavailable. Choose a current stage.` : `Choose the ${role} stage for this template.`);
    else {
      if (pipeline && reference.pipelineId !== pipeline.id) issues.push(`The ${role} stage must belong to the selected pipeline.`);
      if ((routing || ['qualified-entry', 'open-entry', 'initial-entry'].includes(descriptor.setup)) && (reference.stage.isWon || reference.stage.isLost)) issues.push(`Choose an open ${role} stage; Won and Lost stages are unavailable for this routing.`);
      if (descriptor.setup === 'initial-entry' && (reference.stage.name.trim().toLowerCase() !== 'lead' || pipeline?.stages.filter(stage => !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'lead').length !== 1)) issues.push('Initial Deal creation requires exactly one open Lead stage in this pipeline.');
      if (descriptor.setup === 'won-entry' && (!reference.stage.isWon || reference.stage.isLost)) issues.push('Choose a stage configured only as Won.');
      if (descriptor.setup === 'lost-entry' && (!reference.stage.isLost || reference.stage.isWon)) issues.push('Choose a stage configured only as Lost.');
      if (descriptor.setup === 'reopen-entry' && (role === 'source' ? !reference.stage.isLost || reference.stage.isWon : reference.stage.isWon || reference.stage.isLost || reference.stage.name.trim().toLowerCase() !== 'qualified')) issues.push('Reopening requires a Lost source and an open Qualified target in the same pipeline.');
    }
  }
  if (routing && binding.sourceStageId && binding.sourceStageId === binding.targetStageId) issues.push('Choose different source and target stages.');
  if (descriptor.setup !== 'related-deal-routing') {
    const fields = ['deal.pipelineId', descriptor.setup === 'pipeline-routing' ? 'deal.stageId' : entryField(descriptor.setup), ...(descriptor.setup === 'reopen-entry' ? ['event.previousStageId'] : [])];
    for (const field of fields) {
      const matching = draft.conditions?.conditions.filter(rule => rule.field === field) ?? [];
      if (matching.length !== 1 || matching[0].operator !== 'equals') issues.push('Repair the linked pipeline and stage conditions, or customize this workflow without template setup.');
    }
  }
  return [...new Set(issues)];
}

/** Resolve the original Qualified starter only when the workspace has one exact match. */
export function prepareWorkflowTemplateBinding(draft: WorkflowDraft, identity: number | string | undefined, options: WorkflowOptions): WorkflowDraft {
  const descriptor = bindingDescriptor(draft, identity);
  if (!descriptor) return structuredClone(draft);
  if (descriptor.setup === 'qualified-entry') {
    const matches = options.pipelines.flatMap(pipeline => pipeline.stages.filter(stage => stage.name.trim().toLowerCase() === 'qualified' && !stage.isWon && !stage.isLost).map(stage => ({ pipelineId: pipeline.id, targetStageId: stage.id })));
    return matches.length === 1 ? bindWorkflowTemplate(draft, identity, options, matches[0]) : structuredClone(draft);
  }
  return options.pipelines.length === 1 ? bindWorkflowTemplate(draft, identity, options, { pipelineId: options.pipelines[0].id }) : structuredClone(draft);
}

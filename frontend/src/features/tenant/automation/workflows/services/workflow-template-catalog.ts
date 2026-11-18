import {
  getWorkflowUpdateFields,
  workflowOperators,
  workflowActionAllowed,
  workflowAssignmentTarget,
  WorkflowAssignmentTargetSchema,
  type ActionDefinition,
  type TriggerDefinition,
  type WorkflowDraft,
  type WorkflowEntity,
  type WorkflowOptions,
} from '@leadcrm/shared';
import { conditionSummary, operatorLabels } from './workflow-editor';
import { workflowTemplateDescriptor } from './workflow-template-bindings';

export const workflowRecordLabels: Record<WorkflowEntity, string> = {
  lead: 'Leads', contact: 'Contacts', deal: 'Deals', account: 'Accounts',
};

/** Availability is catalog compatibility, not a substitute for server validation. */
export function templateAvailability(
  recipe: WorkflowDraft,
  triggers: TriggerDefinition[],
  actions: ActionDefinition[],
): string[] {
  const trigger = triggers.find(entry => entry.type === recipe.trigger);
  if (!trigger) return ['This template’s trigger is unavailable in this workspace.'];
  const issues: string[] = [];
  for (const action of recipe.actions) {
    const definition = actions.find(entry => entry.type === action.type);
    if (!definition || !workflowActionAllowed(trigger.type, action.type)) {
      issues.push('This template includes an action that is unavailable for its record type.');
    }
    if (action.type === 'update_field' && !getWorkflowUpdateFields(trigger.entity).some(field => field.field === action.config.field)) {
      issues.push('This template updates a field that is no longer available.');
    }
  }
  for (const rule of recipe.conditions?.conditions ?? []) {
    const field = trigger.fields.find(entry => entry.field === rule.field);
    if (!field || !workflowOperators(field.type).includes(rule.operator)) {
      issues.push('This template includes a condition that is no longer available.');
    }
  }
  return [...new Set(issues)];
}

export function templateSetup(recipe: WorkflowDraft, trigger: TriggerDefinition | undefined, actions: ActionDefinition[], identity?: number | string): string[] {
  const notes: string[] = [];
  const descriptor = workflowTemplateDescriptor(identity);
  if (descriptor?.trigger === recipe.trigger) {
    if (descriptor.setup === 'pipeline-routing') notes.push('Choose one pipeline and different open source and target stages in linked setup. These choices connect the matching conditions and Move Deal Stage action.');
    if (descriptor.setup === 'related-deal-routing') {
      notes.push('Choose a pipeline and different open source and target stages in linked setup. Optionally narrow related Deals to a Product.');
      notes.push('The default moves one matching persisted related open Deal. No matches produce no movement or task; multiple matches require review. All matching moves sequentially and can partially complete.');
    }
    if (descriptor.setup === 'stage-entry' || descriptor.setup === 'qualified-entry') notes.push('Choose the pipeline and entry stage in linked setup. An actual entry runs the configured actions; a later distinct entry can run them again.');
    if (descriptor.setup === 'won-entry' || descriptor.setup === 'lost-entry') notes.push(`Choose the pipeline and a stage configured as ${descriptor.setup === 'won-entry' ? 'Won' : 'Lost'}. Actions run when the Deal enters that stage.`);
  }
  for (const action of recipe.actions) {
    const definition = actions.find(entry => entry.type === action.type);
    for (const [key, field] of Object.entries(definition?.configSchema ?? {})) {
      if (field.required && (action.config[key] == null || String(action.config[key]).trim() === '')) {
        notes.push(`Choose ${field.label.toLowerCase().replace('gmail', 'Gmail')} in the builder.`);
      }
    }
    if (action.type === 'send_email') notes.push('Choose an email template or enter both subject and message. Connect the record’s assigned agent to Gmail before activating.');
    if (action.type === 'assign_owner' && !WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action)).success) notes.push('Choose agent, role or group in the builder.');
    if (action.type === 'create_task' && WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action)).data?.type === 'record_owner') {
      notes.push('Tasks use the record’s assigned agent. Assign an agent to the record or choose a task assignee in the builder.');
    }
    if (action.type === 'create_task' && trigger?.entity !== 'deal') notes.push('A connected eligible Deal is required. Missing Deals fail; several related Deals require an explicit connected Deal ID. Archived and foreign Deals are ineligible.');
    if (action.type === 'update_field') {
      const field = trigger && getWorkflowUpdateFields(trigger.entity).find(entry => entry.field === action.config.field);
      notes.push(`The ${field?.label.toLowerCase() ?? 'selected'} field will be replaced with the configured value.`);
    }
    if (action.type === 'move_deal_stage') notes.push('The destination must be in the Deal’s current pipeline. Stage entry requirements and existing transition rules still apply.');
  }
  for (const rule of recipe.conditions?.conditions ?? []) {
    const field = trigger?.fields.find(entry => entry.field === rule.field);
    if (field && ['stage', 'pipeline', 'user', 'account'].includes(field.type) && !rule.value) {
      notes.push(`Confirm the ${field.label.toLowerCase()} condition in the builder.`);
    }
  }
  return [...new Set(notes)];
}

export function templateBehaviorLabel(recipe: WorkflowDraft): string {
  if (recipe.actions.some(action => action.type === 'move_deal_stage')) return recipe.actions.some(action => action.type === 'create_task') ? 'Move Deal + create task' : recipe.trigger.startsWith('deal.') ? 'Move Deal stage' : 'Move related Deal';
  if (recipe.actions.some(action => action.type === 'send_email')) return recipe.actions.some(action => action.type === 'create_task') ? 'Send email + follow-up' : 'Send email';
  if (recipe.actions.some(action => action.type === 'send_sms')) return 'Send SMS';
  if (recipe.actions.some(action => action.type === 'update_field')) return 'Update fields';
  if (recipe.actions.some(action => action.type === 'assign_owner')) return recipe.actions.some(action => action.type === 'create_task') ? 'Assign agent + create task' : 'Assign agent';
  return recipe.trigger === 'deal.stage_changed' ? 'Task on stage entry' : 'Create follow-up task';
}

export function templateConditionLabel(rule: NonNullable<WorkflowDraft['conditions']>['conditions'][number], trigger?: TriggerDefinition, options?: WorkflowOptions): string {
  if (options) return conditionSummary(rule, trigger, options);
  const field = trigger?.fields.find(entry => entry.field === rule.field);
  const label = field?.label ?? rule.field;
  if (['is_empty', 'is_not_empty'].includes(rule.operator)) return `${label} ${operatorLabels[rule.operator]}`;
  const value = typeof rule.value === 'boolean' ? (rule.value ? 'Yes' : 'No') : String(rule.value ?? '').trim() || 'choose in builder';
  return `${label} ${operatorLabels[rule.operator]} ${value}`;
}

import {
  getWorkflowUpdateFields,
  workflowOperators,
  workflowAssignmentTarget,
  WorkflowAssignmentTargetSchema,
  type ActionDefinition,
  type TriggerDefinition,
  type WorkflowDraft,
  type WorkflowEntity,
} from '@leadcrm/shared';
import { operatorLabels } from './workflow-editor';

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
    if (!definition?.entities.includes(trigger.entity)) {
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

export function templateSetup(recipe: WorkflowDraft, trigger: TriggerDefinition | undefined, actions: ActionDefinition[]): string[] {
  const notes: string[] = [];
  for (const action of recipe.actions) {
    const definition = actions.find(entry => entry.type === action.type);
    for (const [key, field] of Object.entries(definition?.configSchema ?? {})) {
      if (field.required && (action.config[key] == null || String(action.config[key]).trim() === '')) {
        notes.push(`Choose ${field.label.toLowerCase().replace('gmail', 'Gmail')} in the builder.`);
      }
    }
    if (action.type === 'send_email') notes.push('Review the email message and connect the selected sender to Gmail before activating.');
    if (action.type === 'assign_owner' && !WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action)).success) notes.push('Choose agent, role or group in the builder.');
    if (action.type === 'create_task' && WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action)).data?.type === 'record_owner') {
      notes.push('Tasks use the record’s assigned agent. Assign an agent to the record or choose a task assignee in the builder.');
    }
    if (action.type === 'update_field') {
      const field = trigger && getWorkflowUpdateFields(trigger.entity).find(entry => entry.field === action.config.field);
      notes.push(`The ${field?.label.toLowerCase() ?? 'selected'} field will be replaced with the configured value.`);
    }
    if (action.type === 'move_deal_stage') notes.push('Choose a stage in the deal’s pipeline. Existing pipeline transition rules still apply.');
  }
  for (const rule of recipe.conditions?.conditions ?? []) {
    const field = trigger?.fields.find(entry => entry.field === rule.field);
    if (field && ['stage', 'pipeline', 'user', 'account'].includes(field.type) && !rule.value) {
      notes.push(`Confirm the ${field.label.toLowerCase()} condition in the builder.`);
    }
  }
  return [...new Set(notes)];
}

export function templateConditionLabel(rule: NonNullable<WorkflowDraft['conditions']>['conditions'][number], trigger?: TriggerDefinition): string {
  const field = trigger?.fields.find(entry => entry.field === rule.field);
  const label = field?.label ?? rule.field;
  if (['is_empty', 'is_not_empty'].includes(rule.operator)) return `${label} ${operatorLabels[rule.operator]}`;
  const value = typeof rule.value === 'boolean' ? (rule.value ? 'Yes' : 'No') : String(rule.value ?? '').trim() || 'choose in builder';
  return `${label} ${operatorLabels[rule.operator]} ${value}`;
}

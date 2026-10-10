import {
  workflowOperators,
  missingWorkflowConditionValues,
  WORKFLOW_MESSAGE_VARIABLES,
  getWorkflowUpdateFields,
  getAvailableActions,
  normalizeWorkflowAssignment,
  type ActionDefinition,
  type TriggerDefinition,
  type WorkflowAction,
  type WorkflowConditionRule,
  type WorkflowCondition,
  type WorkflowDraft,
  type WorkflowOptions,
} from '@leadcrm/shared';
import { assignmentIssues, assignmentSummary } from './workflow-assignment';

export type StepSelection =
  | 'details'
  | 'trigger'
  | 'conditions'
  | `action:${string}`;
export interface EditorDocument {
  draft: WorkflowDraft;
  actionIds: string[];
}
export type LibraryItem =
  | { kind: 'trigger'; type: string }
  | { kind: 'condition'; field?: string }
  | { kind: 'action'; type: WorkflowAction['type'] };
export type DragItem = LibraryItem | { kind: 'move'; id: string };
export type Placement =
  | { kind: 'trigger' }
  | { kind: 'condition' }
  | { kind: 'action'; index: number };
export interface EditorIssue {
  step: StepSelection;
  message: string;
}

export const retiredActionLabels: Record<string, string> = {
  send_campaign: 'Send Campaign (retired)',
  create_notification: 'Send Notification (retired)',
};
const actionLabels = new Map(getAvailableActions().map(action => [action.type as string, action.label]));
export const workflowActionLabel = (type: string) => actionLabels.get(type) ?? retiredActionLabels[type] ?? type.replaceAll('_', ' ');
export function workflowNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
export function workflowNameIssue(
  name: string,
  workflows: Array<{ id: string; name: string }>,
  workflowId?: string,
): string {
  const key = workflowNameKey(name);
  if (!key) return 'Workflow name is required.';
  return workflows.some((workflow) => workflow.id !== workflowId && workflowNameKey(workflow.name) === key)
    ? 'A workflow with this name already exists. Choose another name.'
    : '';
}
export function duplicateWorkflowName(name: string, workflows: Array<{ name: string }>): string {
  const names = new Set(workflows.map((workflow) => workflowNameKey(workflow.name)));
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? ' (Copy)' : ` (Copy ${number})`;
    const candidate = `${name.trim().slice(0, 255 - suffix.length)}${suffix}`;
    if (!names.has(workflowNameKey(candidate))) return candidate;
  }
}

export function toDraft(value: WorkflowDraft): WorkflowDraft {
  return {
    name: value.name,
    description: value.description,
    trigger: value.trigger,
    conditions: value.conditions,
    actions: value.actions.map(normalizeWorkflowAssignment),
    isActive: value.isActive,
  };
}
export function editorDocument(draft: WorkflowDraft): EditorDocument {
  const copy = structuredClone(toDraft(draft));
  copy.actions = copy.actions.map((action) => ({
    ...action,
    config: action.config ?? {},
  }));
  return {
    draft: copy,
    actionIds: draft.actions.map(() => crypto.randomUUID()),
  };
}
export function canPlace(
  item: DragItem,
  target: Placement,
  document: EditorDocument,
  triggers: TriggerDefinition[],
  actions: ActionDefinition[],
): boolean {
  const trigger = triggers.find(
    (entry) => entry.type === document.draft.trigger,
  );
  if (item.kind === 'trigger')
    return (
      target.kind === 'trigger' &&
      triggers.some((entry) => entry.type === item.type)
    );
  if (item.kind === 'condition')
    return (
      target.kind === 'condition' &&
      !!trigger &&
      (!item.field ||
        trigger.fields.some((field) => field.field === item.field)) &&
      (document.draft.conditions?.conditions.length ?? 0) < 30
    );
  if (
    target.kind !== 'action' ||
    !trigger ||
    !Number.isInteger(target.index) ||
    target.index < 0 ||
    target.index > document.draft.actions.length
  )
    return false;
  if (item.kind === 'move') return document.actionIds.includes(item.id);
  return (
    document.draft.actions.length < 20 &&
    actions.some(
      (entry) =>
        entry.type === item.type && entry.entities.includes(trigger.entity),
    )
  );
}
/** Destination is an insertion boundary in the original sequence, including the end. */
export function moveAction(
  document: EditorDocument,
  id: string,
  boundary: number,
): EditorDocument {
  const from = document.actionIds.indexOf(id);
  if (from < 0 || boundary < 0 || boundary > document.actionIds.length)
    return document;
  const to = boundary > from ? boundary - 1 : boundary;
  if (from === to) return document;
  const actions = [...document.draft.actions],
    actionIds = [...document.actionIds];
  actions.splice(to, 0, actions.splice(from, 1)[0]);
  actionIds.splice(to, 0, actionIds.splice(from, 1)[0]);
  return { draft: { ...document.draft, actions }, actionIds };
}
export function insertAction(
  document: EditorDocument,
  action: WorkflowAction,
  index: number,
  id: string,
): EditorDocument {
  if (
    document.draft.actions.length >= 20 ||
    index < 0 ||
    index > document.actionIds.length
  )
    return document;
  const actions = [...document.draft.actions],
    actionIds = [...document.actionIds];
  actions.splice(index, 0, structuredClone(action));
  actionIds.splice(index, 0, id);
  return { draft: { ...document.draft, actions }, actionIds };
}
export function references(
  type: string,
  options: WorkflowOptions,
): Array<{ id: string; name: string }> | undefined {
  if (type === 'user') return options.users;
  if (type === 'pipeline') return options.pipelines;
  if (type === 'stage')
    return options.pipelines.flatMap((pipeline) =>
      pipeline.stages.map((stage) => ({
        id: stage.id,
        name: `${pipeline.name} / ${stage.name}`,
      })),
    );
  if (type === 'template') return options.templates;
  if (type === 'campaign') return options.campaigns;
  if (type === 'products') return options.productInterests ?? [];
  if (type === 'account') return options.accounts ?? [];
  if (type === 'contacts') return options.contacts ?? [];
  if (type === 'leads') return options.leads ?? [];
}
export function referenceName(
  type: string,
  value: unknown,
  options: WorkflowOptions,
  fallback = 'Choose…',
) {
  return value
    ? (references(type, options)?.find((entry) => entry.id === value)?.name ??
        'Unavailable selection')
    : fallback;
}
export const operatorLabels: Record<WorkflowConditionRule['operator'], string> =
  {
    equals: 'is',
    not_equals: 'is not',
    greater_than: 'is greater than',
    less_than: 'is less than',
    greater_than_or_equal: 'is at least',
    less_than_or_equal: 'is at most',
    contains: 'contains',
    not_contains: 'does not contain',
    starts_with: 'starts with',
    ends_with: 'ends with',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
    before: 'is before',
    after: 'is after',
  };
export function conditionSummary(
  rule: WorkflowConditionRule,
  trigger: TriggerDefinition | undefined,
  options: WorkflowOptions,
) {
  const field = trigger?.fields.find((entry) => entry.field === rule.field);
  const value = references(field?.type ?? '', options)
    ? referenceName(field!.type, rule.value, options)
    : field?.optionLabels?.[String(rule.value)] ?? (field?.type === 'boolean' ? rule.value ? 'Yes' : 'No' : String(rule.value ?? ''));
  return `${field?.label ?? 'Choose a field'} ${operatorLabels[rule.operator]}${['is_empty', 'is_not_empty'].includes(rule.operator) ? '' : ` ${value || '…'}`}`;
}
export function actionSummary(
  action: WorkflowAction,
  options: WorkflowOptions,
): string[] {
  const config = action.config;
  switch (action.type) {
    case 'create_task':
      return [
        String(config.title || 'Add a task title'),
        `Assigned to ${assignmentSummary(action, options)}`,
        `Due in ${config.dueDaysFromNow === '' || config.dueDaysFromNow == null ? 3 : config.dueDaysFromNow} day(s) · ${config.priority || 'Medium'} priority`,
      ];
    case 'create_notification':
      return ['Notifications are automatic. Disable or remove this retired step before activating.'];
    case 'assign_owner':
      return [
        `Assign to ${assignmentSummary(action, options)}`,
      ];
    case 'send_email':
      return [
        config.templateId
          ? `Template: ${referenceName('template', config.templateId, options)}`
          : String(config.subject || 'Add an email template or message'),
        `Sender: ${(options.senders?.find(sender => sender.id === config.senderUserId)?.name ?? 'choose connected Gmail sender')}`,
      ];
    case 'send_sms':
      return [String(config.message || 'Add an SMS message'), `To: ${config.recipient === 'primary_contact' ? 'primary contact' : config.recipient === 'primary_lead' ? 'primary lead' : 'triggering record'}`];
    case 'move_deal_stage':
      return [
        `Move Deal → ${referenceName('stage', config.stageId, options, 'choose a stage')}`,
      ];
    case 'update_field': {
      const field = (['lead', 'contact', 'account', 'deal'] as const).flatMap(entity => getWorkflowUpdateFields(entity, options.customFields)).find(field => field.field === config.field);
      const value = references(field?.type ?? '', options) ? (Array.isArray(config.value) ? config.value.map(value => referenceName(field!.type, value, options)).join(', ') : referenceName(field!.type, config.value, options)) : field?.optionLabels?.[String(config.value)] ?? String(config.value ?? 'Add a value');
      return [
        field?.label ?? 'Unavailable field',
        config.clear ? 'Clear this field' : value,
      ];
    }
    case 'send_campaign':
      return ['Send Campaign is retired. Disable or remove this step before activating.'];
    default:
      return [
        'This older action is unsupported. Remove it and choose an available action.',
      ];
  }
}
export function conditionIssues(
  draft: WorkflowDraft,
  trigger: TriggerDefinition | undefined,
  options: WorkflowOptions,
): string[] {
  return (draft.conditions?.conditions ?? []).flatMap((rule, index) => {
    const field = trigger?.fields.find((entry) => entry.field === rule.field);
    let message = '';
    if (!field) message = 'Choose an available field.';
    else if (!workflowOperators(field.type).includes(rule.operator))
      message = 'Choose an operator supported by this field.';
    else if (!['is_empty', 'is_not_empty'].includes(rule.operator)) {
      const choices = references(field.type, options);
      if (
        field.type === 'number' &&
        (typeof rule.value !== 'number' || !Number.isFinite(rule.value))
      )
        message = 'Enter a valid number.';
      else if (field.type === 'boolean' && typeof rule.value !== 'boolean')
        message = 'Choose Yes or No.';
      else if (field.options && !field.options.includes(String(rule.value)))
        message = 'Choose an available value.';
      else if (choices && !choices.some((entry) => entry.id === rule.value))
        message = 'Choose an available record.';
      else if (
        field.type === 'date' &&
        (typeof rule.value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(rule.value) ||
          Number.isNaN(Date.parse(rule.value)) ||
          new Date(rule.value).toISOString().slice(0, 10) !== rule.value)
      )
        message = 'Choose a valid date.';
    }
    return message ? [`Condition ${index + 1}: ${message}`] : [];
  });
}
// Immediate editing guidance. Server validation still owns permissions, references and integrations.
export function actionIssues(
  action: WorkflowAction,
  definition: ActionDefinition | undefined,
  entity: TriggerDefinition['entity'] | undefined,
  options: WorkflowOptions,
  incomplete = false,
): string[] {
  incomplete = incomplete || action.enabled === false;
  if (retiredActionLabels[action.type]) return incomplete ? [] : ['This action is retired. Disable or remove it before activating.'];
  if (!definition || !entity || !definition.entities.includes(entity))
    return ['This action is unavailable for the trigger.'];
  const issues: string[] = [];
  if (['create_task', 'assign_owner'].includes(action.type)) issues.push(...assignmentIssues(action, options, incomplete));
  if (action.type === 'update_field') {
    const field = getWorkflowUpdateFields(entity, options.customFields).find((entry) => entry.field === action.config.field);
    if (!field) return incomplete ? [] : ['Choose an available field.'];
    if (action.config.clear) return !field.required ? [] : ['This field cannot be cleared.'];
    const value = action.config.value;
    if ((value == null || value === '' || (Array.isArray(value) && !value.length)) && !incomplete)
      return ['Enter a new value or choose Clear this field.'];
    if (value == null || value === '') return [];
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) issues.push('Enter a valid number.');
    if (field.type === 'boolean' && typeof value !== 'boolean') issues.push('Choose Yes or No.');
    if (field.options && !field.options.includes(String(value))) issues.push('Choose an available value.');
    const choices = references(field.type, options);
    if (choices) {
      const selected = Array.isArray(value) ? value : [value];
      if (selected.some((selection) => !choices.some((choice) => choice.id === selection))) issues.push('Choose an available selection.');
    }
    return issues;
  }
  for (const [key, field] of Object.entries(definition.configSchema)) {
    if (field.type === 'assignment' || (action.type === 'create_task' && key === 'assignedUserId') || (action.type === 'assign_owner' && key === 'userId')) continue;
    const value = action.config[key];
    if (
      value == null ||
      value === '' ||
      (typeof value === 'string' && !value.trim())
    ) {
      if (field.required && !incomplete)
        issues.push(`${field.label} is required.`);
      continue;
    }
    const choices = key === 'senderUserId' ? options.senders ?? [] : references(field.type, options);
    if (choices && !choices.some((entry) => entry.id === value))
      issues.push(`${field.label}: choose an available selection.`);
    if (field.options && !field.options.includes(String(value)))
      issues.push(`${field.label}: choose a supported value.`);
    if (
      field.type === 'number' &&
      (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 365)
    )
      issues.push(`${field.label}: enter a whole number from 0 to 365.`);
    if (
      ['title', 'description', 'subject', 'body', 'message'].includes(key) &&
      typeof value === 'string' &&
      [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].some(
        (match) =>
          !WORKFLOW_MESSAGE_VARIABLES.some(variable => variable.token === match[1]),
      )
    )
      issues.push(
        `${field.label}: use the supported personalization variables.`,
      );
  }
  if (
    action.type === 'send_email' &&
    !incomplete &&
    !action.config.templateId &&
    (!String(action.config.subject ?? '').trim() ||
      !String(action.config.body ?? '').trim())
  )
    issues.push(
      'Choose a complete template or enter both subject and message.',
    );
  if (action.type === 'send_sms' && options.smsConfigured === false && !incomplete)
    issues.push('SMS is not configured. Connect SMS before activating this workflow.');
  return issues;
}
export function editorIssues(
  document: EditorDocument,
  triggers: TriggerDefinition[],
  definitions: ActionDefinition[],
  options: WorkflowOptions,
  incomplete = false,
  previousConditions?: WorkflowCondition | null,
): EditorIssue[] {
  const { draft, actionIds } = document;
  const trigger = triggers.find((entry) => entry.type === draft.trigger);
  return [
    ...(!draft.name.trim()
      ? [{ step: 'details' as const, message: 'Workflow name is required.' }]
      : []),
    ...(!trigger
      ? [{ step: 'trigger' as const, message: 'Choose a trigger.' }]
      : []),
    ...conditionIssues(draft, trigger, options).map((message) => ({
      step: 'conditions' as const,
      message,
    })),
    ...(!incomplete ? missingWorkflowConditionValues(draft.conditions, previousConditions).map(index => ({ step: 'conditions' as const, message: `Condition ${index + 1}: Enter a value or choose an empty-value operator.` })) : []),
    ...(!incomplete && !draft.actions.some((action) => action.enabled !== false)
      ? [
          {
            step: 'details' as const,
            message: 'Enable at least one action before activating.',
          },
        ]
      : []),
    ...draft.actions.flatMap((action, index) =>
      actionIssues(
        action,
        definitions.find((entry) => entry.type === action.type),
        trigger?.entity,
        options,
        incomplete,
      ).map((message) => ({
        step: `action:${actionIds[index]}` as const,
        message: `Action ${index + 1}: ${message}`,
      })),
    ),
  ];
}

import type { ActionDefinition, WorkflowDraft, WorkflowEntity, WorkflowField, WorkflowTriggerDefinition } from './workflow.contracts';
import { CRM_STATUSES, LEAD_SOURCES, COMPANY_SIZE_OPTIONS } from './record-experience';
import { COMPANY_INDUSTRIES } from '../constants/company-industries';
import { isClosedWonField, type ClosingField, type CustomFieldModule } from './closing-requirements';
import { getCrmFieldCatalog, type FieldLayout } from './field-catalog';
import { isRetiredContactField } from './contact-retirement';
import { campaignFields, campaignVariableChoices, campaignFieldsForSource, campaignApprovedVariableKeys, campaignPersonalizationAvailable } from './campaign-fields';

export const WORKFLOW_MODULES: Record<WorkflowEntity, CustomFieldModule> = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };
export const WORKFLOW_MESSAGE_VARIABLES = [
  { token: 'firstName', label: 'First Name', fields: ['firstName'], legacyToken: 'first_name' },
  { token: 'lastName', label: 'Last Name', fields: ['lastName'], legacyToken: 'last_name' },
  { token: 'email', label: 'Email', fields: ['email'], legacyToken: 'email' },
  { token: 'companyName', label: 'Company', fields: ['companyName'], legacyToken: 'company_name' },
] as const;
export function workflowMessageEntity(entity: WorkflowEntity, recipient?: unknown): WorkflowEntity {
  return recipient && (entity === 'account' || entity === 'deal') ? recipient === 'primary_lead' ? 'lead' : 'contact' : entity;
}
function messageCatalog(entity: WorkflowEntity, definitions: ClosingField[], layout?: FieldLayout) {
  const module = WORKFLOW_MODULES[entity];
  const direct = getCrmFieldCatalog(module, definitions, layout);
  return entity === 'lead' || entity === 'contact' ? campaignFieldsForSource([
    ...direct, ...getCrmFieldCatalog('accounts', definitions), ...getCrmFieldCatalog('deals', definitions),
  ], entity === 'lead' ? 'LEADS' : 'CONTACTS') : direct.filter(campaignPersonalizationAvailable);
}
export function getWorkflowMessageVariables(entity: WorkflowEntity, layout?: FieldLayout, definitions: ClosingField[] = []) {
  const catalog = messageCatalog(entity, definitions, layout);
  return [...new Map(catalog.map(field => [field.technicalKey, { token: field.technicalKey, label: field.label }])).values(),
    { token: 'sender_name', label: 'Sender Name' }, { token: 'sender_email', label: 'Sender Email' }];
}
/** New email insertion is limited to fields owned by the triggering person. */
export function getWorkflowEmailVariableChoices(entity: WorkflowEntity, layout?: FieldLayout, definitions: ClosingField[] = [], includeSender = false) {
  if (entity !== 'lead' && entity !== 'contact') return [];
  const source = entity === 'lead' ? 'LEADS' : 'CONTACTS';
  return campaignVariableChoices(campaignFields(source, definitions, layout), source, { forInsertion: true })
    .filter(choice => (includeSender || choice.category !== 'Sender') && choice.personalizationAvailable);
}
export function workflowMessageVariableKeys(entity: WorkflowEntity, definitions: ClosingField[] = [], layout?: FieldLayout) {
  const keys = campaignApprovedVariableKeys(messageCatalog(entity, definitions, layout));
  return keys;
}
export function workflowMessageVariableError(value: string, keys: ReadonlySet<string>): string | undefined {
  const unsupported = [...new Set([...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]).filter(key => !keys.has(key)))];
  return unsupported.length ? `Unsupported message variable${unsupported.length === 1 ? '' : 's'}: ${unsupported.map(key => '{{' + key + '}}').join(', ')}. Choose an available technical key from Customize Fields for this record or recipient.` : undefined;
}
const text = (field: string, label: string, required = false, maxLength = 2000): WorkflowField => ({ field, label, type: 'string', required, maxLength });
const choice = (field: string, label: string, options: readonly string[]): WorkflowField => ({ field, label, type: 'enum', options: [...options] });
export function getWorkflowCustomFields(entity: WorkflowEntity, definitions: ClosingField[] = []): WorkflowField[] {
  // Hidden fields and governed closing evidence follow the existing record editor rules.
  return definitions.filter(f => f.module === WORKFLOW_MODULES[entity] && f.active && f.visibleInForm && !isClosedWonField(f) && f.type !== 'File Upload').map(f => ({
    field: 'customFieldValues.' + f.id, customFieldId: f.id, label: f.name, group: 'custom', required: f.required, nullable: true,
    type: f.type === 'Number' ? 'number' : f.type === 'Date' ? 'date' : f.type === 'Dropdown' ? 'enum' : 'string',
    ...(f.type === 'Dropdown' ? { options: f.options } : {}), multiline: f.type === 'Long Text', maxLength: f.type === 'Long Text' ? 10000 : 1000,
  }));
}
/** Explicit module contract. Database properties never become builder fields implicitly. */
export function getWorkflowUpdateFields(entity: WorkflowEntity, customFields: ClosingField[] = [], layout?: FieldLayout): WorkflowField[] {
  const assignment: WorkflowField = { field: 'assignedUserId', label: 'Assigned Agent', type: 'user', nullable: true };
  const account: WorkflowField = { field: 'accountId', label: 'Account', type: 'account', nullable: true };
  const product: WorkflowField = { field: 'productInterestIds', label: 'Product Interest', type: 'products' };
  let standard: WorkflowField[];
  if (entity === 'deal') standard = [text('title', 'Title', true, 255),
    { ...choice('priority', 'Priority', ['LOW', 'MEDIUM', 'HIGH']), required: true, optionLabels: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } },
    { field: 'expectedCloseDate', label: 'Expected Close Date', type: 'date', nullable: true },
    choice('leadSource', 'Lead Source', LEAD_SOURCES), choice('industry', 'Industry', COMPANY_INDUSTRIES), text('address', 'Address'), assignment, account,
    { field: 'contactIds', label: 'Contacts', type: 'contacts' }, { field: 'leadIds', label: 'Leads', type: 'leads' },
  ];
  else if (entity === 'account') standard = [text('name', 'Account Name', true, 255), choice('industry', 'Industry', COMPANY_INDUSTRIES),
    choice('size', 'Size', COMPANY_SIZE_OPTIONS), text('website', 'Website'), text('address', 'Full Address'),
    { ...text('notes', 'Notes'), multiline: true },
    // These remain editable in Account Edit; retain their supported automation contract.
  ];
  else standard = [text('firstName', 'First Name', true, 100), text('lastName', 'Last Name', true, 100), text('email', 'Email', true, 254), text('phone', 'Phone', false, entity === 'contact' ? 100 : 2000),
    text('companyName', entity === 'contact' ? 'Company' : 'Company Name'),
    { ...choice('status', 'Status', CRM_STATUSES), required: true }, product, account,
    choice('source', entity === 'lead' ? 'Lead Source' : 'Source', LEAD_SOURCES), assignment, text('address', 'Full Address'),
  ];
  return [...standard.filter(field => field.field !== 'assignedUserId').map(field => ({ ...field, label: layout?.fields[field.field]?.label ?? field.label })), ...getWorkflowCustomFields(entity, customFields)];
}
export function getWorkflowConditionFields(entity: WorkflowEntity, trigger?: string, customFields: ClosingField[] = [], layout?: FieldLayout): WorkflowField[] {
  // Presentation visibility governs editing; active hidden values remain readable.
  const definitions = getWorkflowUpdateFields(entity, customFields.map(field => ({ ...field, visibleInForm: true })), layout).map(f => ({ ...f, field: entity + '.' + f.field }));
  if (entity !== 'account') definitions.push({ field: `${entity}.assignedUserId`, label: layout?.fields.assignedUserId?.label ?? 'Assigned Agent', type: 'user', nullable: true });
  if (entity === 'deal') definitions.push(
    { field: 'deal.value', label: 'Deal Value', type: 'number' },
    { field: 'deal.productInterestIds', label: 'Product Interest', type: 'products' },
    { field: 'deal.stageId', label: 'Stage', type: 'stage' }, { field: 'deal.pipelineId', label: 'Pipeline', type: 'pipeline' },
    { field: 'deal.hasEverBeenWon', label: 'Has ever reached Won', type: 'boolean' },
    { field: 'deal.wonHistoryVerified', label: 'Stage history verified', type: 'boolean' },
  );
  if (trigger === 'deal.stage_changed') definitions.push(
    { field: 'event.previousStageId', label: 'Previous Stage', type: 'stage' }, { field: 'event.newStageId', label: 'New Stage', type: 'stage' },
  );
  if (trigger === 'lead.status_changed' || trigger === 'contact.status_changed') definitions.push(
    choice('event.previousStatus', 'Previous Status', CRM_STATUSES), choice('event.newStatus', 'New Status', CRM_STATUSES),
  );
  if (trigger?.endsWith('.updated')) definitions.push({ field: 'event.changedFields', label: 'Changed fields', type: 'list', maxLength: 160 });
  return definitions;
}
export const WORKFLOW_TRIGGERS: WorkflowTriggerDefinition[] = [
  ['lead.created', 'Lead Created', 'lead'], ['lead.updated', 'Lead Updated', 'lead'], ['lead.status_changed', 'Lead Status Changed', 'lead'],
  ['contact.created', 'Contact Created', 'contact'], ['contact.updated', 'Contact Updated', 'contact'], ['contact.status_changed', 'Contact Status Changed', 'contact'],
  ['deal.created', 'Deal Created', 'deal'], ['deal.updated', 'Deal Updated', 'deal'], ['deal.stage_changed', 'Deal Stage Changed', 'deal'],
  ['deal.closed_won', 'Deal Closed Won', 'deal'], ['deal.closed_lost', 'Deal Closed Lost', 'deal'], ['account.updated', 'Account Updated', 'account'],
].map(([type, label, entity]) => ({ type, label, entity: entity as WorkflowEntity, fields: getWorkflowConditionFields(entity as WorkflowEntity, type) }));
export const findTrigger = (type: string) => WORKFLOW_TRIGGERS.find(trigger => trigger.type === type);
/** Legacy names map only on exact, unique catalog matches. Unresolved selections remain repairable. */
export function normalizeWorkflowReferences<T extends { trigger: string; conditions?: unknown; actions?: unknown }>(draft: T, products: Array<{ id: string; name: string }>): T {
  const entity = findTrigger(draft.trigger)?.entity;
  if (!entity || entity === 'account') return draft;
  const resolveProduct = (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    if (products.some(p => p.id === value)) return value;
    const matches = products.filter(p => p.name.trim().toLowerCase() === value.trim().toLowerCase());
    return matches.length === 1 ? matches[0].id : undefined;
  };
  const aliases: Record<string, string> = { productInterest: 'productInterestIds', productInterests: 'productInterestIds', productInterestIds: 'productInterestIds', activeProducts: 'activeProductIds', activeProductIds: 'activeProductIds' };
  const conditions = draft.conditions as { operator: string; conditions?: Array<{ field: string; value: unknown; operator: string }> } | null;
  return { ...draft,
    conditions: conditions && Array.isArray(conditions.conditions) ? { ...conditions, conditions: conditions.conditions.map(rule => {
      if (!rule || typeof rule.field !== 'string') return rule;
      const field = rule.field.startsWith(entity + '.') ? rule.field.slice(entity.length + 1) : '';
      if (aliases[field] && !isRetiredContactField(field, entity)) {
        const value = resolveProduct(rule.value);
        if (value || ['is_empty', 'is_not_empty'].includes(rule.operator)) return { ...rule, field: entity + '.' + aliases[field], value: value ?? rule.value };
      }
      if ([entity + '.status', 'event.previousStatus', 'event.newStatus'].includes(rule.field)) {
        const value = CRM_STATUSES.find(s => s.toLowerCase() === String(rule.value).toLowerCase());
        if (value) return { ...rule, value };
      }
      return rule;
    }) } : draft.conditions,
    actions: Array.isArray(draft.actions) ? draft.actions.map(action => {
      if (action?.type === 'update_field' && action.config?.field === 'status') {
        const value = CRM_STATUSES.find(status => status.toLowerCase() === String(action.config.value).toLowerCase());
        if (value) return { ...action, config: { ...action.config, value } };
      }
      if (action?.type !== 'update_field' || !action.config || !aliases[action.config.field] || isRetiredContactField(action.config.field, entity)) return action;
      const values = Array.isArray(action.config.value) ? action.config.value.map(resolveProduct) : [];
      if (action.config.clear || (Array.isArray(action.config.value) && values.every(Boolean))) return { ...action, config: { ...action.config, field: aliases[action.config.field], value: values } };
      return action;
    }) : draft.actions,
  };
}
export const RETIRED_WORKFLOW_ACTIONS = ['send_campaign', 'create_notification'] as const;
export function getAvailableActions(): ActionDefinition[] {
  return [
    { type: 'create_task', label: 'Create Task', description: 'Create a follow-up task linked to the triggering Deal.', entities: ['deal'], configSchema: {
      targetMode: { type: 'select', label: 'Associate task with', required: false, options: ['triggering_deal', 'single_match', 'all_matching'] },
      pipelineId: { type: 'pipeline', label: 'Pipeline filter', required: false },
      currentStageId: { type: 'stage', label: 'Stage filter', required: false },
      productInterestId: { type: 'products', label: 'Product filter', required: false },
      dealId: { type: 'deal', label: 'Specific deal (optional)', required: false },
      title: { type: 'string', label: 'Task title', required: true }, description: { type: 'string', label: 'Description', required: false },
      assignedUserId: { type: 'user', label: 'Assign to (defaults to assigned agent)', required: false },
      assignmentTarget: { type: 'assignment', label: 'Assign to', required: false },
      dueDaysFromNow: { type: 'number', label: 'Due in days', required: false }, priority: { type: 'select', label: 'Priority', required: false, options: ['Low', 'Medium', 'High'] },
    } },
    { type: 'send_email', label: 'Send Email', description: 'Send a template through the assigned agent’s connected Gmail account.', entities: ['lead', 'contact', 'deal'], configSchema: {
      recipient: { type: 'select', label: 'Recipient', required: false, options: ['record', 'primary_contact', 'primary_lead'] },
      templateId: { type: 'template', label: 'Email template (optional with subject and message)', required: false },
      subject: { type: 'string', label: 'Subject (overrides template)', required: false }, body: { type: 'string', label: 'Message (overrides template)', required: false },
    } },
    { type: 'send_sms', label: 'Send SMS', description: 'Send a message to the record or its explicitly selected primary relationship.', entities: ['lead', 'contact', 'deal'], configSchema: {
      recipient: { type: 'select', label: 'Recipient', required: true, options: ['record', 'primary_contact', 'primary_lead'] },
      message: { type: 'string', label: 'SMS message', required: true },
    } },
    { type: 'assign_owner', label: 'Assign Agent', description: 'Assign the record to an eligible workspace agent.', entities: ['lead', 'contact', 'deal'], configSchema: {
      userId: { type: 'user', label: 'Agent', required: false },
      assignmentTarget: { type: 'assignment', label: 'Assign to', required: false },
    } },
    { type: 'update_field', label: 'Update Fields', description: 'Update an editable record field.', entities: ['lead', 'contact', 'deal', 'account'], configSchema: {
      field: { type: 'field', label: 'Field', required: true }, value: { type: 'value', label: 'New value', required: false },
      clear: { type: 'boolean', label: 'Clear value', required: false }, otherDetails: { type: 'string', label: 'Specify (optional)', required: false },
    } },
    { type: 'move_deal_stage', label: 'Move Deal Stage', description: 'Move the triggering Deal or explicitly filtered related Deals using pipeline transition rules.', entities: ['deal', 'lead', 'contact'], configSchema: {
      targetMode: { type: 'select', label: 'Related Deal selection', required: false, options: ['single_match', 'all_matching'] },
      productInterestId: { type: 'products', label: 'Product filter', required: false },
      currentStageId: { type: 'stage', label: 'Current stage filter', required: false },
      stageId: { type: 'stage', label: 'Target stage', required: true },
      includeLossReason: { type: 'boolean', label: 'Include a loss reason', required: false },
      lostReason: { type: 'string', label: 'Loss reason', required: false },
    } },
  ];
}

/** One policy for builder placement, activation and execution. */
export function workflowActionAllowed(triggerType: string, actionType: string): boolean {
  const trigger = findTrigger(triggerType);
  if (!trigger || !getAvailableActions().find(action => action.type === actionType)?.entities.includes(trigger.entity)) return false;
  if (trigger.entity === 'account') return actionType === 'update_field';
  return actionType !== 'assign_owner' || ['lead.created', 'contact.created', 'deal.created', 'lead.status_changed', 'contact.status_changed', 'deal.stage_changed'].includes(triggerType);
}

export function workflowActionPolicyIssues(draft: Pick<WorkflowDraft, 'trigger' | 'conditions' | 'actions'>): string[] {
  return draft.actions.flatMap((action, index) => {
    if (action.enabled === false) return [];
    const prefix = `Action ${index + 1}: `;
    if (!workflowActionAllowed(draft.trigger, action.type)) return [prefix + 'This action is unavailable for the selected trigger. Disable or remove it before activating.'];
    if (action.type === 'update_field' && action.config.field === 'assignedUserId') return [prefix + 'Use Assign Agent to change ownership. Field updates cannot reassign records.'];
    if (action.type !== 'assign_owner' || draft.trigger.endsWith('.created')) return [];
    const entity = findTrigger(draft.trigger)!.entity;
    const fields = draft.trigger === 'deal.stage_changed' ? ['deal.stageId', 'event.newStageId'] : [`${entity}.status`, 'event.newStatus'];
    const rules = draft.conditions?.conditions ?? [];
    const routes = rules.map(rule => fields.includes(rule.field) && rule.operator === 'equals' && typeof rule.value === 'string' && !!rule.value.trim());
    const guarded = rules.length > 0 && (draft.conditions?.operator === 'OR' ? routes.every(Boolean) : routes.some(Boolean));
    return guarded ? [] : [prefix + 'Agent handoffs require an explicit target status or stage Equals condition that every matching record must satisfy.'];
  });
}

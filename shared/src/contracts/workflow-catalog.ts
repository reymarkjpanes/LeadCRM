import type { ActionDefinition, WorkflowEntity, WorkflowField, WorkflowTriggerDefinition } from './workflow.contracts';
import { CRM_STATUSES, LEAD_SOURCES, COMPANY_SIZE_OPTIONS } from './record-experience';
import { COMPANY_INDUSTRIES } from '../constants/company-industries';
import { isClosedWonField, type ClosingField, type CustomFieldModule } from './closing-requirements';

export const WORKFLOW_MODULES: Record<WorkflowEntity, CustomFieldModule> = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };
export const WORKFLOW_MESSAGE_VARIABLES = [
  { token: 'first_name', label: 'First name', fields: ['firstName'] },
  { token: 'last_name', label: 'Last name', fields: ['lastName'] },
  { token: 'email', label: 'Email', fields: ['email'] },
  { token: 'company', label: 'Company', fields: ['company', 'companyName'] },
] as const;
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
export function getWorkflowUpdateFields(entity: WorkflowEntity, customFields: ClosingField[] = []): WorkflowField[] {
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
    choice('size', 'Size', COMPANY_SIZE_OPTIONS), text('website', 'Website'), text('address', 'Street Address'), text('city', 'City'), text('province', 'Province'), text('country', 'Country'), assignment, product,
    { ...text('notes', 'Notes'), multiline: true },
    // These remain editable in Account Edit; retain their supported automation contract.
    { ...text('internalNotes', 'Internal Notes'), multiline: true }, { field: 'activeProductIds', label: 'Active Products', type: 'products' },
  ];
  else standard = [text('firstName', 'First Name', true, 100), text('lastName', 'Last Name', true, 100), text('email', 'Email', true, 254), text('phone', 'Phone', false, entity === 'contact' ? 100 : 2000),
    text(entity === 'lead' ? 'companyName' : 'company', 'Company Name'),
    { ...choice('status', 'Status', CRM_STATUSES), required: true }, product, account,
    choice('source', entity === 'lead' ? 'Lead Source' : 'Source', LEAD_SOURCES), assignment, text('address', 'Full Address'),
  ];
  return [...standard, ...getWorkflowCustomFields(entity, customFields)];
}
export function getWorkflowConditionFields(entity: WorkflowEntity, trigger?: string, customFields: ClosingField[] = []): WorkflowField[] {
  const definitions = getWorkflowUpdateFields(entity, customFields).map(f => ({ ...f, field: entity + '.' + f.field }));
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
  if (!entity) return draft;
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
      if (aliases[field]) {
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
      if (action?.type !== 'update_field' || !action.config || !aliases[action.config.field]) return action;
      const values = Array.isArray(action.config.value) ? action.config.value.map(resolveProduct) : [];
      if (action.config.clear || (Array.isArray(action.config.value) && values.every(Boolean))) return { ...action, config: { ...action.config, field: aliases[action.config.field], value: values } };
      return action;
    }) : draft.actions,
  };
}
export const RETIRED_WORKFLOW_ACTIONS = ['send_campaign', 'create_notification'] as const;
export function getAvailableActions(): ActionDefinition[] {
  return [
    { type: 'create_task', label: 'Create Task', description: 'Create a linked follow-up task.', entities: ['lead', 'contact', 'deal', 'account'], configSchema: {
      title: { type: 'string', label: 'Task title', required: true }, description: { type: 'string', label: 'Description', required: false },
      assignedUserId: { type: 'user', label: 'Assign to (defaults to assigned agent)', required: false },
      assignmentTarget: { type: 'assignment', label: 'Assign to', required: false },
      dueDaysFromNow: { type: 'number', label: 'Due in days', required: false }, priority: { type: 'select', label: 'Priority', required: false, options: ['Low', 'Medium', 'High'] },
    } },
    { type: 'send_email', label: 'Send Email', description: 'Send a template through a connected Gmail account.', entities: ['lead', 'contact'], configSchema: {
      templateId: { type: 'template', label: 'Email template (optional with subject and message)', required: false },
      subject: { type: 'string', label: 'Subject (overrides template)', required: false }, body: { type: 'string', label: 'Message (overrides template)', required: false }, senderUserId: { type: 'user', label: 'Connected Gmail sender', required: true },
    } },
    { type: 'send_sms', label: 'Send SMS', description: 'Send a message to the record or its explicitly selected primary relationship.', entities: ['lead', 'contact', 'deal', 'account'], configSchema: {
      recipient: { type: 'select', label: 'Recipient', required: true, options: ['record', 'primary_contact', 'primary_lead'] },
      message: { type: 'string', label: 'SMS message', required: true },
    } },
    { type: 'assign_owner', label: 'Assign Agent', description: 'Assign the record to an eligible workspace agent.', entities: ['lead', 'contact', 'deal', 'account'], configSchema: {
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
      stageId: { type: 'stage', label: 'Target stage', required: true }, lostReason: { type: 'string', label: 'Reason (required for lost stages)', required: false },
    } },
  ];
}

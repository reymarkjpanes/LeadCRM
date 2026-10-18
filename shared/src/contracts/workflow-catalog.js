"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETIRED_WORKFLOW_ACTIONS = exports.findTrigger = exports.WORKFLOW_TRIGGERS = exports.WORKFLOW_MESSAGE_VARIABLES = exports.WORKFLOW_MODULES = void 0;
exports.workflowMessageEntity = workflowMessageEntity;
exports.getWorkflowMessageVariables = getWorkflowMessageVariables;
exports.getWorkflowEmailVariableChoices = getWorkflowEmailVariableChoices;
exports.workflowMessageVariableKeys = workflowMessageVariableKeys;
exports.workflowMessageVariableError = workflowMessageVariableError;
exports.getWorkflowCustomFields = getWorkflowCustomFields;
exports.getWorkflowUpdateFields = getWorkflowUpdateFields;
exports.getWorkflowConditionFields = getWorkflowConditionFields;
exports.normalizeWorkflowReferences = normalizeWorkflowReferences;
exports.getAvailableActions = getAvailableActions;
exports.workflowActionAllowed = workflowActionAllowed;
exports.workflowActionPolicyIssues = workflowActionPolicyIssues;
const record_experience_1 = require("./record-experience");
const company_industries_1 = require("../constants/company-industries");
const closing_requirements_1 = require("./closing-requirements");
const field_catalog_1 = require("./field-catalog");
const contact_retirement_1 = require("./contact-retirement");
const campaign_fields_1 = require("./campaign-fields");
exports.WORKFLOW_MODULES = { lead: 'leads', contact: 'contacts', account: 'accounts', deal: 'deals' };
exports.WORKFLOW_MESSAGE_VARIABLES = [
    { token: 'firstName', label: 'First Name', fields: ['firstName'], legacyToken: 'first_name' },
    { token: 'lastName', label: 'Last Name', fields: ['lastName'], legacyToken: 'last_name' },
    { token: 'email', label: 'Email', fields: ['email'], legacyToken: 'email' },
    { token: 'companyName', label: 'Company', fields: ['companyName'], legacyToken: 'company_name' },
];
function workflowMessageEntity(entity, recipient) {
    return recipient && (entity === 'account' || entity === 'deal') ? recipient === 'primary_lead' ? 'lead' : 'contact' : entity;
}
function messageCatalog(entity, definitions, layout) {
    const module = exports.WORKFLOW_MODULES[entity];
    const direct = (0, field_catalog_1.getCrmFieldCatalog)(module, definitions, layout);
    return entity === 'lead' || entity === 'contact' ? (0, campaign_fields_1.campaignFieldsForSource)([
        ...direct, ...(0, field_catalog_1.getCrmFieldCatalog)('accounts', definitions), ...(0, field_catalog_1.getCrmFieldCatalog)('deals', definitions),
    ], entity === 'lead' ? 'LEADS' : 'CONTACTS') : direct.filter(campaign_fields_1.campaignPersonalizationAvailable);
}
function getWorkflowMessageVariables(entity, layout, definitions = []) {
    const catalog = messageCatalog(entity, definitions, layout);
    return [...new Map(catalog.map(field => [field.technicalKey, { token: field.technicalKey, label: field.label }])).values(),
        { token: 'sender_name', label: 'Sender Name' }, { token: 'sender_email', label: 'Sender Email' }];
}
/** New email insertion is limited to fields owned by the triggering person. */
function getWorkflowEmailVariableChoices(entity, layout, definitions = [], includeSender = false) {
    if (entity !== 'lead' && entity !== 'contact')
        return [];
    const source = entity === 'lead' ? 'LEADS' : 'CONTACTS';
    return (0, campaign_fields_1.campaignVariableChoices)((0, campaign_fields_1.campaignFields)(source, definitions, layout), source, { forInsertion: true })
        .filter(choice => (includeSender || choice.category !== 'Sender') && choice.personalizationAvailable);
}
function workflowMessageVariableKeys(entity, definitions = [], layout) {
    const keys = (0, campaign_fields_1.campaignApprovedVariableKeys)(messageCatalog(entity, definitions, layout));
    return keys;
}
function workflowMessageVariableError(value, keys) {
    const unsupported = [...new Set([...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]).filter(key => !keys.has(key)))];
    return unsupported.length ? `Unsupported message variable${unsupported.length === 1 ? '' : 's'}: ${unsupported.map(key => '{{' + key + '}}').join(', ')}. Choose an available technical key from Customize Fields for this record or recipient.` : undefined;
}
const text = (field, label, required = false, maxLength = 2000) => ({ field, label, type: 'string', required, maxLength });
const choice = (field, label, options) => ({ field, label, type: 'enum', options: [...options] });
function getWorkflowCustomFields(entity, definitions = []) {
    // Hidden fields and governed closing evidence follow the existing record editor rules.
    return definitions.filter(f => f.module === exports.WORKFLOW_MODULES[entity] && f.active && f.visibleInForm && !(0, closing_requirements_1.isClosedWonField)(f) && f.type !== 'File Upload').map(f => ({
        field: 'customFieldValues.' + f.id, customFieldId: f.id, label: f.name, group: 'custom', required: f.required, nullable: true,
        type: f.type === 'Number' ? 'number' : f.type === 'Date' ? 'date' : f.type === 'Dropdown' ? 'enum' : 'string',
        ...(f.type === 'Dropdown' ? { options: f.options } : {}), multiline: f.type === 'Long Text', maxLength: f.type === 'Long Text' ? 10000 : 1000,
    }));
}
/** Explicit module contract. Database properties never become builder fields implicitly. */
function getWorkflowUpdateFields(entity, customFields = [], layout) {
    const assignment = { field: 'assignedUserId', label: 'Assigned Agent', type: 'user', nullable: true };
    const account = { field: 'accountId', label: 'Account', type: 'account', nullable: true };
    const product = { field: 'productInterestIds', label: 'Product Interest', type: 'products' };
    let standard;
    if (entity === 'deal')
        standard = [text('title', 'Title', true, 255),
            { ...choice('priority', 'Priority', ['LOW', 'MEDIUM', 'HIGH']), required: true, optionLabels: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } },
            { field: 'expectedCloseDate', label: 'Expected Close Date', type: 'date', nullable: true },
            choice('leadSource', 'Lead Source', record_experience_1.LEAD_SOURCES), choice('industry', 'Industry', company_industries_1.COMPANY_INDUSTRIES), text('address', 'Address'), assignment, account,
            { field: 'contactIds', label: 'Contacts', type: 'contacts' }, { field: 'leadIds', label: 'Leads', type: 'leads' },
        ];
    else if (entity === 'account')
        standard = [text('name', 'Account Name', true, 255), choice('industry', 'Industry', company_industries_1.COMPANY_INDUSTRIES),
            choice('size', 'Size', record_experience_1.COMPANY_SIZE_OPTIONS), text('website', 'Website'), text('address', 'Full Address'),
            { ...text('notes', 'Notes'), multiline: true },
            // These remain editable in Account Edit; retain their supported automation contract.
        ];
    else
        standard = [text('firstName', 'First Name', true, 100), text('lastName', 'Last Name', true, 100), text('email', 'Email', true, 254), text('phone', 'Phone', false, entity === 'contact' ? 100 : 2000),
            text('companyName', entity === 'contact' ? 'Company' : 'Company Name'),
            { ...choice('status', 'Status', record_experience_1.CRM_STATUSES), required: true }, product, account,
            choice('source', entity === 'lead' ? 'Lead Source' : 'Source', record_experience_1.LEAD_SOURCES), assignment, text('address', 'Full Address'),
        ];
    return [...standard.filter(field => field.field !== 'assignedUserId').map(field => ({ ...field, label: layout?.fields[field.field]?.label ?? field.label })), ...getWorkflowCustomFields(entity, customFields)];
}
function getWorkflowConditionFields(entity, trigger, customFields = [], layout) {
    // Presentation visibility governs editing; active hidden values remain readable.
    const definitions = getWorkflowUpdateFields(entity, customFields.map(field => ({ ...field, visibleInForm: true })), layout).map(f => ({ ...f, field: entity + '.' + f.field }));
    if (entity !== 'account')
        definitions.push({ field: `${entity}.assignedUserId`, label: layout?.fields.assignedUserId?.label ?? 'Assigned Agent', type: 'user', nullable: true });
    if (entity === 'deal')
        definitions.push({ field: 'deal.value', label: 'Deal Value', type: 'number' }, { field: 'deal.productInterestIds', label: 'Product Interest', type: 'products' }, { field: 'deal.stageId', label: 'Stage', type: 'stage' }, { field: 'deal.pipelineId', label: 'Pipeline', type: 'pipeline' }, { field: 'deal.hasEverBeenWon', label: 'Has ever reached Won', type: 'boolean' }, { field: 'deal.wonHistoryVerified', label: 'Stage history verified', type: 'boolean' });
    if (trigger === 'deal.stage_changed')
        definitions.push({ field: 'event.previousStageId', label: 'Previous Stage', type: 'stage' }, { field: 'event.newStageId', label: 'New Stage', type: 'stage' });
    if (trigger === 'lead.status_changed' || trigger === 'contact.status_changed')
        definitions.push(choice('event.previousStatus', 'Previous Status', record_experience_1.CRM_STATUSES), choice('event.newStatus', 'New Status', record_experience_1.CRM_STATUSES));
    if (trigger?.endsWith('.updated'))
        definitions.push({ field: 'event.changedFields', label: 'Changed fields', type: 'list', maxLength: 160 });
    return definitions;
}
exports.WORKFLOW_TRIGGERS = [
    ['lead.created', 'Lead Created', 'lead'], ['lead.updated', 'Lead Updated', 'lead'], ['lead.status_changed', 'Lead Status Changed', 'lead'],
    ['contact.created', 'Contact Created', 'contact'], ['contact.updated', 'Contact Updated', 'contact'], ['contact.status_changed', 'Contact Status Changed', 'contact'],
    ['deal.created', 'Deal Created', 'deal'], ['deal.updated', 'Deal Updated', 'deal'], ['deal.stage_changed', 'Deal Stage Changed', 'deal'],
    ['deal.closed_won', 'Deal Closed Won', 'deal'], ['deal.closed_lost', 'Deal Closed Lost', 'deal'], ['account.updated', 'Account Updated', 'account'],
].map(([type, label, entity]) => ({ type, label, entity: entity, fields: getWorkflowConditionFields(entity, type) }));
const findTrigger = (type) => exports.WORKFLOW_TRIGGERS.find(trigger => trigger.type === type);
exports.findTrigger = findTrigger;
/** Legacy names map only on exact, unique catalog matches. Unresolved selections remain repairable. */
function normalizeWorkflowReferences(draft, products) {
    const entity = (0, exports.findTrigger)(draft.trigger)?.entity;
    if (!entity || entity === 'account')
        return draft;
    const resolveProduct = (value) => {
        if (typeof value !== 'string')
            return undefined;
        if (products.some(p => p.id === value))
            return value;
        const matches = products.filter(p => p.name.trim().toLowerCase() === value.trim().toLowerCase());
        return matches.length === 1 ? matches[0].id : undefined;
    };
    const aliases = { productInterest: 'productInterestIds', productInterests: 'productInterestIds', productInterestIds: 'productInterestIds', activeProducts: 'activeProductIds', activeProductIds: 'activeProductIds' };
    const conditions = draft.conditions;
    return { ...draft,
        conditions: conditions && Array.isArray(conditions.conditions) ? { ...conditions, conditions: conditions.conditions.map(rule => {
                if (!rule || typeof rule.field !== 'string')
                    return rule;
                const field = rule.field.startsWith(entity + '.') ? rule.field.slice(entity.length + 1) : '';
                if (aliases[field] && !(0, contact_retirement_1.isRetiredContactField)(field, entity)) {
                    const value = resolveProduct(rule.value);
                    if (value || ['is_empty', 'is_not_empty'].includes(rule.operator))
                        return { ...rule, field: entity + '.' + aliases[field], value: value ?? rule.value };
                }
                if ([entity + '.status', 'event.previousStatus', 'event.newStatus'].includes(rule.field)) {
                    const value = record_experience_1.CRM_STATUSES.find(s => s.toLowerCase() === String(rule.value).toLowerCase());
                    if (value)
                        return { ...rule, value };
                }
                return rule;
            }) } : draft.conditions,
        actions: Array.isArray(draft.actions) ? draft.actions.map(action => {
            if (action?.type === 'update_field' && action.config?.field === 'status') {
                const value = record_experience_1.CRM_STATUSES.find(status => status.toLowerCase() === String(action.config.value).toLowerCase());
                if (value)
                    return { ...action, config: { ...action.config, value } };
            }
            if (action?.type !== 'update_field' || !action.config || !aliases[action.config.field] || (0, contact_retirement_1.isRetiredContactField)(action.config.field, entity))
                return action;
            const values = Array.isArray(action.config.value) ? action.config.value.map(resolveProduct) : [];
            if (action.config.clear || (Array.isArray(action.config.value) && values.every(Boolean)))
                return { ...action, config: { ...action.config, field: aliases[action.config.field], value: values } };
            return action;
        }) : draft.actions,
    };
}
exports.RETIRED_WORKFLOW_ACTIONS = ['send_campaign', 'create_notification'];
function getAvailableActions() {
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
function workflowActionAllowed(triggerType, actionType) {
    const trigger = (0, exports.findTrigger)(triggerType);
    if (!trigger || !getAvailableActions().find(action => action.type === actionType)?.entities.includes(trigger.entity))
        return false;
    if (trigger.entity === 'account')
        return actionType === 'update_field';
    return actionType !== 'assign_owner' || ['lead.created', 'contact.created', 'deal.created', 'lead.status_changed', 'contact.status_changed', 'deal.stage_changed'].includes(triggerType);
}
function workflowActionPolicyIssues(draft) {
    return draft.actions.flatMap((action, index) => {
        if (action.enabled === false)
            return [];
        const prefix = `Action ${index + 1}: `;
        if (!workflowActionAllowed(draft.trigger, action.type))
            return [prefix + 'This action is unavailable for the selected trigger. Disable or remove it before activating.'];
        if (action.type === 'update_field' && action.config.field === 'assignedUserId')
            return [prefix + 'Use Assign Agent to change ownership. Field updates cannot reassign records.'];
        if (action.type !== 'assign_owner' || draft.trigger.endsWith('.created'))
            return [];
        const entity = (0, exports.findTrigger)(draft.trigger).entity;
        const fields = draft.trigger === 'deal.stage_changed' ? ['deal.stageId', 'event.newStageId'] : [`${entity}.status`, 'event.newStatus'];
        const rules = draft.conditions?.conditions ?? [];
        const routes = rules.map(rule => fields.includes(rule.field) && rule.operator === 'equals' && typeof rule.value === 'string' && !!rule.value.trim());
        const guarded = rules.length > 0 && (draft.conditions?.operator === 'OR' ? routes.every(Boolean) : routes.some(Boolean));
        return guarded ? [] : [prefix + 'Agent handoffs require an explicit target status or stage Equals condition that every matching record must satisfy.'];
    });
}

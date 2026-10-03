"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETIRED_WORKFLOW_ACTIONS = exports.findTrigger = exports.WORKFLOW_TRIGGERS = void 0;
exports.getWorkflowUpdateFields = getWorkflowUpdateFields;
exports.getAvailableActions = getAvailableActions;
const text = (field, label, required = false) => ({ field, label, type: 'string', required });
/** Matches the normal record editors. Governed stage changes retain their dedicated action. */
function getWorkflowUpdateFields(entity) {
    const assignment = { field: 'assignedUserId', label: 'Assigned agent', type: 'user', nullable: true };
    const account = { field: 'accountId', label: 'Account', type: 'account', nullable: true };
    if (entity === 'deal')
        return [
            text('title', 'Deal title', true), text('currency', 'Currency', true),
            { field: 'priority', label: 'Priority', type: 'enum', options: ['LOW', 'MEDIUM', 'HIGH'], required: true },
            { field: 'billingFrequency', label: 'Billing frequency', type: 'enum', options: ['monthly', 'one_time', 'annual', 'quarterly'], required: true },
            { field: 'expectedCloseDate', label: 'Expected close date', type: 'date', nullable: true },
            text('leadSource', 'Lead source'), text('industry', 'Industry'), text('address', 'Address'), assignment, account,
            { field: 'contactIds', label: 'Contacts', type: 'contacts' }, { field: 'leadIds', label: 'Leads', type: 'leads' },
            { field: 'productInterestIds', label: 'Product Interest', type: 'products', required: true },
            { field: 'value', label: 'Deal Value', type: 'number', group: 'custom', required: true },
        ];
    if (entity === 'account')
        return [text('name', 'Account name', true), text('industry', 'Industry'),
            { field: 'size', label: 'Company size', type: 'enum', options: ['1-10', '11-50', '51-200', '200+'], required: true },
            ...['website', 'address', 'city', 'province', 'country', 'notes', 'internalNotes'].map(f => text(f, { internalNotes: 'Internal notes' }[f] ?? f[0].toUpperCase() + f.slice(1))),
            assignment, { field: 'tags', label: 'Tags', type: 'list' }, { field: 'activeProducts', label: 'Active products', type: 'list' },
            { field: 'productInterests', label: 'Product Interest', type: 'products' },];
    return [text('firstName', 'First name', true), text('lastName', 'Last name', true), text('email', 'Email', true), text('phone', 'Phone'),
        text(entity === 'lead' ? 'companyName' : 'company', 'Company'), text('source', 'Source'), text('address', 'Address'),
        ...(entity === 'lead' ? [text('website', 'Website'), text('description', 'Description')] : [text('jobTitle', 'Job title'), text('notes', 'Notes')]),
        { field: 'status', label: entity === 'lead' ? 'Lead status' : 'Relationship status', type: 'enum', options: ['Hot', 'Warm', 'Cold', 'Cancelled', 'Closed'], required: true },
        assignment, account, { field: entity === 'lead' ? 'productInterest' : 'productInterests', label: 'Product Interest', type: 'products' },
    ];
}
function fields(entity) {
    const definitions = getWorkflowUpdateFields(entity).filter(f => !['contacts', 'leads'].includes(f.type))
        .map(f => ({ ...f, field: `${entity}.${f.field}` }));
    // Conditions compare product names, while Lead/Deal update actions use catalog IDs.
    const product = definitions.find(f => f.type === 'products');
    if (product)
        product.field = entity === 'lead' ? 'lead.productInterest' : `${entity}.productInterests`;
    if (entity === 'lead')
        definitions.find(f => f.field === 'lead.status').options = ['Inquiry', 'Hot', 'Warm', 'Cold', 'Closed', 'Cancelled', 'Qualified', 'Converted', 'Archived', 'HOT', 'WARM', 'COLD'];
    if (entity === 'contact') {
        const status = definitions.find(f => f.field === 'contact.status');
        status.options = ['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED', 'Hot', 'Warm', 'Cold', 'Cancelled', 'Closed'];
    }
    if (entity === 'deal')
        definitions.push({ field: 'deal.stageId', label: 'Stage', type: 'stage' }, { field: 'deal.pipelineId', label: 'Pipeline', type: 'pipeline' }, { field: 'deal.hasEverBeenWon', label: 'Has ever reached Won', type: 'boolean' }, { field: 'deal.wonHistoryVerified', label: 'Stage history verified', type: 'boolean' });
    return definitions;
}
exports.WORKFLOW_TRIGGERS = [
    ['lead.created', 'Lead Created', 'lead'], ['lead.updated', 'Lead Updated', 'lead'], ['lead.status_changed', 'Lead Status Changed', 'lead'],
    ['contact.created', 'Contact Created', 'contact'], ['contact.updated', 'Contact Updated', 'contact'], ['contact.status_changed', 'Contact Status Changed', 'contact'],
    ['deal.created', 'Deal Created', 'deal'], ['deal.updated', 'Deal Updated', 'deal'], ['deal.stage_changed', 'Deal Stage Changed', 'deal'],
    ['deal.closed_won', 'Deal Closed Won', 'deal'], ['deal.closed_lost', 'Deal Closed Lost', 'deal'], ['account.updated', 'Account Updated', 'account'],
].map(([type, label, entity]) => ({ type, label, entity: entity, fields: [
        ...fields(entity), ...(type === 'deal.stage_changed' ? [
            { field: 'event.previousStageId', label: 'Previous stage', type: 'stage' },
            { field: 'event.newStageId', label: 'New stage', type: 'stage' },
        ] : []),
    ] }));
const findTrigger = (type) => exports.WORKFLOW_TRIGGERS.find(trigger => trigger.type === type);
exports.findTrigger = findTrigger;
exports.RETIRED_WORKFLOW_ACTIONS = ['send_campaign', 'create_notification'];
function getAvailableActions() {
    return [
        { type: 'create_task', label: 'Create Task', description: 'Create a linked follow-up task.', entities: ['lead', 'contact', 'deal', 'account'], configSchema: {
                title: { type: 'string', label: 'Task title', required: true }, description: { type: 'string', label: 'Description', required: false },
                assignedUserId: { type: 'user', label: 'Assign to (defaults to assigned agent)', required: false },
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
                userId: { type: 'user', label: 'Agent', required: true },
            } },
        { type: 'update_field', label: 'Update Fields', description: 'Update an editable record field. Deal Value is available under Custom Fields.', entities: ['lead', 'contact', 'deal', 'account'], configSchema: {
                field: { type: 'field', label: 'Field', required: true }, value: { type: 'value', label: 'New value', required: false },
                clear: { type: 'boolean', label: 'Clear value', required: false }, otherDetails: { type: 'string', label: 'Specify (optional)', required: false },
            } },
        { type: 'move_deal_stage', label: 'Move Deal Stage', description: 'Move the deal using the pipeline transition rules.', entities: ['deal'], configSchema: {
                stageId: { type: 'stage', label: 'Target stage', required: true }, lostReason: { type: 'string', label: 'Reason (required for lost stages)', required: false },
            } },
    ];
}

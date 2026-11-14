"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowRevisionTokenSchema = exports.WorkflowRevisionWriteSchema = exports.WorkflowTestInputSchema = exports.WORKFLOW_OUTCOME_STATUSES = exports.WorkflowExecutionViewSchema = exports.WorkflowValidationSchema = exports.StoredWorkflowDraftSchema = exports.WorkflowDraftSchema = exports.WorkflowDescriptionSchema = exports.WORKFLOW_DESCRIPTION_MAX_ERROR = exports.WORKFLOW_DESCRIPTION_MAX_LENGTH = exports.WORKFLOW_NAME_MAX_LENGTH = exports.WorkflowAssignmentTargetSchema = exports.WorkflowCapacitySchema = exports.WorkflowAvailabilitySchema = exports.WorkflowAssignmentStrategySchema = exports.WORKFLOW_ASSIGNMENT_METHODS = exports.WorkflowTaskAssociationSchema = exports.WorkflowActionSchema = exports.WorkflowConditionSchema = exports.WorkflowConditionRuleSchema = exports.WorkflowConditionOperatorSchema = void 0;
exports.missingWorkflowConditionValues = missingWorkflowConditionValues;
exports.workflowLossReason = workflowLossReason;
exports.workflowLossReasonIssue = workflowLossReasonIssue;
exports.workflowAssignmentTarget = workflowAssignmentTarget;
exports.normalizeWorkflowAssignment = normalizeWorkflowAssignment;
exports.normalizeSavedWorkflowAssignment = normalizeSavedWorkflowAssignment;
exports.workflowOperators = workflowOperators;
exports.workflowRunOutcome = workflowRunOutcome;
exports.workflowStateAction = workflowStateAction;
const text_length_1 = require("../validation/text-length");
const zod_1 = require("zod");
const condition_operators_1 = require("./condition-operators");
exports.WorkflowConditionOperatorSchema = zod_1.z.enum([
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal',
    'less_than_or_equal', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'before', 'after',
]);
exports.WorkflowConditionRuleSchema = zod_1.z.object({
    field: zod_1.z.string().min(1), operator: exports.WorkflowConditionOperatorSchema,
    value: zod_1.z.union([zod_1.z.string(), zod_1.z.number().finite(), zod_1.z.boolean(), zod_1.z.null()]),
    // Server-maintained draft state distinguishes new missing input from historical literals.
    incompleteValue: zod_1.z.literal(true).optional(),
}).strict();
exports.WorkflowConditionSchema = zod_1.z.object({
    operator: zod_1.z.enum(['AND', 'OR']), conditions: zod_1.z.array(exports.WorkflowConditionRuleSchema).max(30),
}).strict();
/** Empty operators need no value. Preserve explicit blank literals in saved rules. */
function missingWorkflowConditionValues(conditions, previous) {
    return (conditions?.conditions ?? []).flatMap((rule, index) => {
        if (['is_empty', 'is_not_empty'].includes(rule.operator))
            return [];
        const missing = rule.value == null || (typeof rule.value === 'string' && !rule.value.trim());
        const savedLiteral = typeof rule.value === 'string' && previous?.conditions.some(saved => !saved.incompleteValue && saved.field === rule.field && saved.operator === rule.operator && saved.value === rule.value);
        return missing && !savedLiteral ? [index] : [];
    });
}
exports.WorkflowActionSchema = zod_1.z.object({
    type: zod_1.z.enum(['create_task', 'send_email', 'send_sms', 'assign_owner', 'update_field', 'create_notification', 'move_deal_stage', 'send_campaign']),
    enabled: zod_1.z.boolean().optional(),
    config: zod_1.z.record(zod_1.z.unknown()),
}).strict().transform(action => {
    if (action.type !== 'send_email')
        return action;
    const { senderUserId: _deprecated, ...config } = action.config;
    return { ...action, config };
});
/** Older actions with a saved reason keep that reason unless explicitly disabled. */
function workflowLossReason(config) {
    return config.includeLossReason === false ? undefined : typeof config.lostReason === 'string' ? config.lostReason.trim() || undefined : undefined;
}
function workflowLossReasonIssue(config, incomplete = false) {
    if (config.includeLossReason !== undefined && typeof config.includeLossReason !== 'boolean')
        return 'Include a loss reason must be Yes or No.';
    if (config.lostReason !== undefined && (typeof config.lostReason !== 'string' || config.lostReason.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(config.lostReason)))
        return 'Loss reason must be text of at most 2000 characters without control characters.';
    // Retired UI flag: blank legacy reasons are optional; stage evidence still applies.
}
const optionalWorkflowReference = zod_1.z.preprocess(value => value === '' ? undefined : value, zod_1.z.string().uuid().optional());
exports.WorkflowTaskAssociationSchema = zod_1.z.object({
    targetMode: zod_1.z.preprocess(value => value === '' ? undefined : value, zod_1.z.enum(['triggering_deal', 'single_match', 'all_matching']).optional()),
    pipelineId: optionalWorkflowReference,
    currentStageId: optionalWorkflowReference,
    productInterestId: optionalWorkflowReference,
    dealId: optionalWorkflowReference,
});
exports.WORKFLOW_ASSIGNMENT_METHODS = {
    round_robin: 'Round-robin',
    weighted_workload: 'Weighted workload assignment',
};
exports.WorkflowAssignmentStrategySchema = zod_1.z.enum(['round_robin', 'weighted_workload']);
const assignmentDays = zod_1.z.array(zod_1.z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length, 'Choose each day only once.');
const assignmentTime = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid time.');
const assignmentSchedule = zod_1.z.object({ days: assignmentDays, start: assignmentTime, end: assignmentTime }).strict()
    .refine(schedule => schedule.start !== schedule.end, 'Shift start and end must differ.');
exports.WorkflowAvailabilitySchema = zod_1.z.object({
    timeZone: zod_1.z.string().min(1).max(100).refine(value => { try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
    }
    catch {
        return false;
    } }, 'Choose a valid IANA timezone.'),
    schedule: assignmentSchedule,
    members: zod_1.z.array(zod_1.z.object({ userId: zod_1.z.string().uuid(), unavailable: zod_1.z.boolean(), schedule: assignmentSchedule.optional() }).strict()).max(200)
        .refine(members => new Set(members.map(member => member.userId)).size === members.length, 'Duplicate member availability.'),
}).strict();
exports.WorkflowCapacitySchema = zod_1.z.object({
    maxPerMember: zod_1.z.number().int().min(1).max(10000),
    members: zod_1.z.array(zod_1.z.object({ userId: zod_1.z.string().uuid(), limit: zod_1.z.number().int().min(1).max(10000) }).strict()).max(200)
        .refine(members => new Set(members.map(member => member.userId)).size === members.length, 'Duplicate member capacity.'),
}).strict();
const poolAssignment = {
    id: zod_1.z.string().uuid(), strategy: exports.WorkflowAssignmentStrategySchema,
    availability: exports.WorkflowAvailabilitySchema.optional(), capacity: exports.WorkflowCapacitySchema.optional(),
};
exports.WorkflowAssignmentTargetSchema = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({ type: zod_1.z.literal('record_owner') }).strict(),
    zod_1.z.object({ type: zod_1.z.literal('user'), id: zod_1.z.string().uuid() }).strict(),
    zod_1.z.object({ type: zod_1.z.literal('role'), ...poolAssignment }).strict(),
    zod_1.z.object({ type: zod_1.z.literal('group'), ...poolAssignment }).strict(),
]);
/** Read old definitions without rewriting stored workflows or hiding invalid new targets. */
function workflowAssignmentTarget(action) {
    if (action.config.assignmentTarget !== undefined)
        return action.config.assignmentTarget;
    const id = action.config[action.type === 'create_task' ? 'assignedUserId' : 'userId'];
    return id !== undefined && id !== '' ? { type: 'user', id } : action.type === 'create_task' ? { type: 'record_owner' } : undefined;
}
function normalizeWorkflowAssignment(action) {
    if (!['create_task', 'assign_owner'].includes(action.type))
        return action;
    const target = workflowAssignmentTarget(action);
    const config = { ...action.config };
    delete config[action.type === 'create_task' ? 'assignedUserId' : 'userId'];
    return { ...action, config: { ...config, ...(target === undefined ? {} : { assignmentTarget: target }) } };
}
/** Adapt saved retired methods on read; new API input still uses the strict target schema. */
function normalizeSavedWorkflowAssignment(action) {
    if (action.type === 'send_email') {
        const { senderUserId: _deprecated, ...config } = action.config;
        return { ...action, config };
    }
    if (!['create_task', 'assign_owner'].includes(action.type))
        return action;
    const normalized = normalizeWorkflowAssignment(action);
    const target = normalized.config.assignmentTarget;
    if (!target || typeof target !== 'object' || !('type' in target) || !('strategy' in target) ||
        !['role', 'group'].includes(String(target.type)) ||
        !['least_workload', 'random', 'availability', 'capacity', 'sticky'].includes(String(target.strategy)))
        return normalized;
    const { sticky: _retired, ...pool } = target;
    return { ...normalized, config: { ...normalized.config, assignmentTarget: { ...pool, strategy: 'round_robin' } } };
}
exports.WORKFLOW_NAME_MAX_LENGTH = 255;
exports.WORKFLOW_DESCRIPTION_MAX_LENGTH = 1000;
exports.WORKFLOW_DESCRIPTION_MAX_ERROR = (0, text_length_1.maxLengthMessage)('Workflow description', exports.WORKFLOW_DESCRIPTION_MAX_LENGTH);
const workflowDescription = (limit, message) => zod_1.z.string().max(limit, message).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Control characters are not allowed.')
    .transform(value => value.length > exports.WORKFLOW_DESCRIPTION_MAX_LENGTH ? value : value.trim()).nullable().optional();
exports.WorkflowDescriptionSchema = workflowDescription(exports.WORKFLOW_DESCRIPTION_MAX_LENGTH, exports.WORKFLOW_DESCRIPTION_MAX_ERROR);
exports.WorkflowDraftSchema = zod_1.z.object({
    name: zod_1.z.string().regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.').trim().min(1, 'Workflow name is required.').max(exports.WORKFLOW_NAME_MAX_LENGTH, (0, text_length_1.maxLengthMessage)('Workflow name', exports.WORKFLOW_NAME_MAX_LENGTH)),
    description: exports.WorkflowDescriptionSchema,
    trigger: zod_1.z.string().min(1, 'Choose a trigger.'),
    conditions: exports.WorkflowConditionSchema.nullable().optional(),
    actions: zod_1.z.array(exports.WorkflowActionSchema).max(20),
    isActive: zod_1.z.boolean().default(false),
}).strict();
exports.StoredWorkflowDraftSchema = exports.WorkflowDraftSchema.extend({ description: workflowDescription(2000) });
exports.WorkflowValidationSchema = exports.StoredWorkflowDraftSchema.extend({ workflowId: zod_1.z.string().uuid().optional() });
function workflowOperators(type) {
    const keys = { gt: 'greater_than', gte: 'greater_than_or_equal', lt: 'less_than', lte: 'less_than_or_equal' };
    return (0, condition_operators_1.conditionOperators)('workflow', (0, condition_operators_1.conditionFieldKind)(type)).map(key => keys[key] ?? key);
}
exports.WorkflowExecutionViewSchema = zod_1.z.enum(['all', 'outcomes']);
exports.WORKFLOW_OUTCOME_STATUSES = ['completed', 'failed', 'skipped', 'interrupted'];
/** Interrupted submissions remain uncertain internally and require review, never automatic replay. */
function workflowRunOutcome(status) {
    if (status === 'interrupted')
        return 'failed';
    return status === 'completed' || status === 'failed' || status === 'skipped' ? status : null;
}
exports.WorkflowTestInputSchema = zod_1.z.object({ entityId: zod_1.z.string().uuid(), stageHistoryId: zod_1.z.string().uuid().optional(), useDraft: zod_1.z.boolean().optional() }).strict();
exports.WorkflowRevisionWriteSchema = zod_1.z.object({ draft: exports.StoredWorkflowDraftSchema, expectedDraftRevision: zod_1.z.number().int().min(0), expectedVersion: zod_1.z.number().int().min(1) }).strict();
exports.WorkflowRevisionTokenSchema = exports.WorkflowRevisionWriteSchema.omit({ draft: true });
/** Initial activation and controlling a published workflow are separate grants. */
function workflowStateAction(workflow, isActive) {
    return !isActive || workflow.status === 'PAUSED' ? 'canPause' : 'canActivate';
}

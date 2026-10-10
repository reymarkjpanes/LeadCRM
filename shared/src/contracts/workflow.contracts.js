"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowValidationSchema = exports.WorkflowDraftSchema = exports.WorkflowAssignmentTargetSchema = exports.WorkflowCapacitySchema = exports.WorkflowAvailabilitySchema = exports.WorkflowAssignmentStrategySchema = exports.WORKFLOW_ASSIGNMENT_METHODS = exports.WorkflowActionSchema = exports.WorkflowConditionSchema = exports.WorkflowConditionRuleSchema = exports.WorkflowConditionOperatorSchema = void 0;
exports.missingWorkflowConditionValues = missingWorkflowConditionValues;
exports.workflowAssignmentTarget = workflowAssignmentTarget;
exports.normalizeWorkflowAssignment = normalizeWorkflowAssignment;
exports.workflowOperators = workflowOperators;
const zod_1 = require("zod");
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
}).strict();
exports.WORKFLOW_ASSIGNMENT_METHODS = {
    round_robin: 'Round-robin', least_workload: 'Least workload', random: 'Random',
    availability: 'Availability-based', capacity: 'Capacity-based', sticky: 'Previous assignee / Sticky assignment',
};
exports.WorkflowAssignmentStrategySchema = zod_1.z.enum(['round_robin', 'least_workload', 'random', 'availability', 'capacity', 'sticky']);
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
    sticky: zod_1.z.object({ fallback: zod_1.z.enum(['round_robin', 'least_workload', 'random']), preferCurrentOwner: zod_1.z.boolean() }).strict().optional(),
};
exports.WorkflowAssignmentTargetSchema = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({ type: zod_1.z.literal('record_owner') }).strict(),
    zod_1.z.object({ type: zod_1.z.literal('user'), id: zod_1.z.string().uuid() }).strict(),
    zod_1.z.object({ type: zod_1.z.literal('role'), ...poolAssignment }).strict(),
    zod_1.z.object({ type: zod_1.z.literal('group'), ...poolAssignment }).strict(),
]).superRefine((target, ctx) => {
    if (target.type !== 'role' && target.type !== 'group')
        return;
    if (target.strategy === 'availability' && !target.availability)
        ctx.addIssue({ code: 'custom', path: ['availability'], message: 'Configure an availability schedule.' });
    if (target.strategy === 'capacity' && !target.capacity)
        ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Configure a capacity limit.' });
    if (target.strategy !== 'sticky' && target.sticky)
        ctx.addIssue({ code: 'custom', path: ['sticky'], message: 'Sticky settings require the sticky assignment method.' });
});
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
exports.WorkflowDraftSchema = zod_1.z.object({
    name: zod_1.z.string().regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.').trim().min(1, 'Workflow name is required.').max(255),
    description: zod_1.z.string().max(2000).transform(value => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()).nullable().optional(),
    trigger: zod_1.z.string().min(1, 'Choose a trigger.'),
    conditions: exports.WorkflowConditionSchema.nullable().optional(),
    actions: zod_1.z.array(exports.WorkflowActionSchema).max(20),
    isActive: zod_1.z.boolean().default(false),
}).strict();
exports.WorkflowValidationSchema = exports.WorkflowDraftSchema.extend({ workflowId: zod_1.z.string().uuid().optional() });
function workflowOperators(type) {
    if (['products', 'list', 'contacts', 'leads'].includes(type))
        return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
    if (type === 'number')
        return ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'];
    if (type === 'date')
        return ['equals', 'not_equals', 'before', 'after', 'is_empty', 'is_not_empty'];
    if (type !== 'string')
        return type === 'boolean' ? ['equals', 'not_equals'] : ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
    return ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'];
}

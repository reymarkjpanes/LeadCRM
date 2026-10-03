"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowDraftSchema = exports.WorkflowActionSchema = exports.WorkflowConditionSchema = exports.WorkflowConditionRuleSchema = exports.WorkflowConditionOperatorSchema = void 0;
exports.workflowOperators = workflowOperators;
const zod_1 = require("zod");
exports.WorkflowConditionOperatorSchema = zod_1.z.enum([
    'equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal',
    'less_than_or_equal', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'before', 'after',
]);
exports.WorkflowConditionRuleSchema = zod_1.z.object({
    field: zod_1.z.string().min(1), operator: exports.WorkflowConditionOperatorSchema,
    value: zod_1.z.union([zod_1.z.string(), zod_1.z.number().finite(), zod_1.z.boolean(), zod_1.z.null()]),
}).strict();
exports.WorkflowConditionSchema = zod_1.z.object({
    operator: zod_1.z.enum(['AND', 'OR']), conditions: zod_1.z.array(exports.WorkflowConditionRuleSchema).max(30),
}).strict();
exports.WorkflowActionSchema = zod_1.z.object({
    type: zod_1.z.enum(['create_task', 'send_email', 'send_sms', 'assign_owner', 'update_field', 'create_notification', 'move_deal_stage', 'send_campaign']),
    enabled: zod_1.z.boolean().optional(),
    config: zod_1.z.record(zod_1.z.unknown()),
}).strict();
exports.WorkflowDraftSchema = zod_1.z.object({
    name: zod_1.z.string().regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.').trim().min(1, 'Workflow name is required.').max(255),
    description: zod_1.z.string().max(2000).transform(value => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()).nullable().optional(),
    trigger: zod_1.z.string().min(1, 'Choose a trigger.'),
    conditions: exports.WorkflowConditionSchema.nullable().optional(),
    actions: zod_1.z.array(exports.WorkflowActionSchema).max(20),
    isActive: zod_1.z.boolean().default(false),
}).strict();
function workflowOperators(type) {
    if (type === 'products' || type === 'list')
        return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
    if (type === 'number')
        return ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'];
    if (type === 'date')
        return ['equals', 'before', 'after'];
    if (type !== 'string')
        return type === 'boolean' ? ['equals', 'not_equals'] : ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
    return ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'];
}

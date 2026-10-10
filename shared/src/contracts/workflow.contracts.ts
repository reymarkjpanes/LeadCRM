import { z } from 'zod';
import type { ClosingField } from './closing-requirements';

export const WorkflowConditionOperatorSchema = z.enum([
  'equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal',
  'less_than_or_equal', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'before', 'after',
]);
export type WorkflowConditionOperator = z.infer<typeof WorkflowConditionOperatorSchema>;
export const WorkflowConditionRuleSchema = z.object({
  field: z.string().min(1), operator: WorkflowConditionOperatorSchema,
  value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  // Server-maintained draft state distinguishes new missing input from historical literals.
  incompleteValue: z.literal(true).optional(),
}).strict();
export type WorkflowConditionRule = z.infer<typeof WorkflowConditionRuleSchema>;
export const WorkflowConditionSchema = z.object({
  operator: z.enum(['AND', 'OR']), conditions: z.array(WorkflowConditionRuleSchema).max(30),
}).strict();
export type WorkflowCondition = z.infer<typeof WorkflowConditionSchema>;
export type WorkflowConditionGroup = WorkflowCondition;

/** Empty operators need no value. Preserve explicit blank literals in saved rules. */
export function missingWorkflowConditionValues(conditions?: WorkflowCondition | null, previous?: WorkflowCondition | null): number[] {
  return (conditions?.conditions ?? []).flatMap((rule, index) => {
    if (['is_empty', 'is_not_empty'].includes(rule.operator)) return [];
    const missing = rule.value == null || (typeof rule.value === 'string' && !rule.value.trim());
    const savedLiteral = typeof rule.value === 'string' && previous?.conditions.some(saved => !saved.incompleteValue && saved.field === rule.field && saved.operator === rule.operator && saved.value === rule.value);
    return missing && !savedLiteral ? [index] : [];
  });
}
export const WorkflowActionSchema = z.object({
  type: z.enum(['create_task', 'send_email', 'send_sms', 'assign_owner', 'update_field', 'create_notification', 'move_deal_stage', 'send_campaign']),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()),
}).strict();
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowActionType = WorkflowAction['type'];
export const WORKFLOW_ASSIGNMENT_METHODS = {
  round_robin: 'Round-robin', least_workload: 'Least workload', random: 'Random',
  availability: 'Availability-based', capacity: 'Capacity-based', sticky: 'Previous assignee / Sticky assignment',
} as const;
export const WorkflowAssignmentStrategySchema = z.enum(['round_robin', 'least_workload', 'random', 'availability', 'capacity', 'sticky']);
export type WorkflowAssignmentStrategy = z.infer<typeof WorkflowAssignmentStrategySchema>;
const assignmentDays = z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length, 'Choose each day only once.');
const assignmentTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid time.');
const assignmentSchedule = z.object({ days: assignmentDays, start: assignmentTime, end: assignmentTime }).strict()
  .refine(schedule => schedule.start !== schedule.end, 'Shift start and end must differ.');
export const WorkflowAvailabilitySchema = z.object({
  timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid IANA timezone.'),
  schedule: assignmentSchedule,
  members: z.array(z.object({ userId: z.string().uuid(), unavailable: z.boolean(), schedule: assignmentSchedule.optional() }).strict()).max(200)
    .refine(members => new Set(members.map(member => member.userId)).size === members.length, 'Duplicate member availability.'),
}).strict();
export type WorkflowAvailability = z.infer<typeof WorkflowAvailabilitySchema>;
export const WorkflowCapacitySchema = z.object({
  maxPerMember: z.number().int().min(1).max(10000),
  members: z.array(z.object({ userId: z.string().uuid(), limit: z.number().int().min(1).max(10000) }).strict()).max(200)
    .refine(members => new Set(members.map(member => member.userId)).size === members.length, 'Duplicate member capacity.'),
}).strict();
const poolAssignment = {
  id: z.string().uuid(), strategy: WorkflowAssignmentStrategySchema,
  availability: WorkflowAvailabilitySchema.optional(), capacity: WorkflowCapacitySchema.optional(),
  sticky: z.object({ fallback: z.enum(['round_robin', 'least_workload', 'random']), preferCurrentOwner: z.boolean() }).strict().optional(),
};
export const WorkflowAssignmentTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('record_owner') }).strict(),
  z.object({ type: z.literal('user'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('role'), ...poolAssignment }).strict(),
  z.object({ type: z.literal('group'), ...poolAssignment }).strict(),
]).superRefine((target, ctx) => {
  if (target.type !== 'role' && target.type !== 'group') return;
  if (target.strategy === 'availability' && !target.availability) ctx.addIssue({ code: 'custom', path: ['availability'], message: 'Configure an availability schedule.' });
  if (target.strategy === 'capacity' && !target.capacity) ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Configure a capacity limit.' });
  if (target.strategy !== 'sticky' && target.sticky) ctx.addIssue({ code: 'custom', path: ['sticky'], message: 'Sticky settings require the sticky assignment method.' });
});
export type WorkflowAssignmentTarget = z.infer<typeof WorkflowAssignmentTargetSchema>;
export type WorkflowAssignmentPurpose = 'crm_owner' | 'task_assignee';
export interface WorkflowAssignmentPoolOption {
  id: string; name: string; memberCount: number;
  eligibleMemberCounts: Record<WorkflowAssignmentPurpose, number>;
  members?: Array<{ id: string; name: string; purposes: WorkflowAssignmentPurpose[] }>;
}
/** Read old definitions without rewriting stored workflows or hiding invalid new targets. */
export function workflowAssignmentTarget(action: WorkflowAction): unknown {
  if (action.config.assignmentTarget !== undefined) return action.config.assignmentTarget;
  const id = action.config[action.type === 'create_task' ? 'assignedUserId' : 'userId'];
  return id !== undefined && id !== '' ? { type: 'user', id } : action.type === 'create_task' ? { type: 'record_owner' } : undefined;
}
export function normalizeWorkflowAssignment(action: WorkflowAction): WorkflowAction {
  if (!['create_task', 'assign_owner'].includes(action.type)) return action;
  const target = workflowAssignmentTarget(action);
  const config = { ...action.config };
  delete config[action.type === 'create_task' ? 'assignedUserId' : 'userId'];
  return { ...action, config: { ...config, ...(target === undefined ? {} : { assignmentTarget: target }) } };
}
export type WorkflowEntity = 'lead' | 'contact' | 'deal' | 'account';
export const WorkflowDraftSchema = z.object({
  name: z.string().regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.').trim().min(1, 'Workflow name is required.').max(255),
  description: z.string().max(2000).transform(value => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()).nullable().optional(),
  trigger: z.string().min(1, 'Choose a trigger.'),
  conditions: WorkflowConditionSchema.nullable().optional(),
  actions: z.array(WorkflowActionSchema).max(20),
  isActive: z.boolean().default(false),
}).strict();
export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>;
export const WorkflowValidationSchema = WorkflowDraftSchema.extend({ workflowId: z.string().uuid().optional() });
export interface WorkflowOptions {
  customFields?: ClosingField[];
  users: Array<{id:string;name:string}>;
  taskAssignees?: Array<{id:string;name:string}>;
  roles?: WorkflowAssignmentPoolOption[];
  groups?: WorkflowAssignmentPoolOption[];
  senders?: Array<{id:string;name:string}>;
  pipelines: Array<{id:string;name:string;stages:Array<{id:string;name:string}>}>;
  templates: Array<{id:string;name:string}>;
  campaigns: Array<{id:string;name:string}>;
  productInterests?: Array<{id:string;name:string}>;
  accounts?: Array<{id:string;name:string}>;
  contacts?: Array<{id:string;name:string}>;
  leads?: Array<{id:string;name:string}>;
  smsConfigured?: boolean;
}
export interface Workflow extends WorkflowDraft {
  id: string; tenantId: string;
  version?: number;
  isArchived: boolean; createdAt: string; updatedAt: string; lastRunAt?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED'; totalRuns?: number; successfulRuns?: number; failedRuns?: number;
}
export interface WorkflowTriggerDefinition {
  type: string; label: string; entity: WorkflowEntity;
  fields: WorkflowField[];
}
export interface WorkflowField {
  field: string; label: string; type: 'string' | 'number' | 'boolean' | 'enum' | 'date' | 'user' | 'pipeline' | 'stage' | 'products' | 'account' | 'contacts' | 'leads' | 'list'; options?: string[];
  group?: 'standard' | 'custom'; required?: boolean; nullable?: boolean;
  customFieldId?: string; multiline?: boolean; maxLength?: number;
  optionLabels?: Record<string, string>;
}
export function workflowOperators(type: WorkflowField['type']): WorkflowConditionOperator[] {
  if (['products', 'list', 'contacts', 'leads'].includes(type)) return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
  if (type === 'number') return ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'];
  if (type === 'date') return ['equals', 'not_equals', 'before', 'after', 'is_empty', 'is_not_empty'];
  if (type !== 'string') return type === 'boolean' ? ['equals', 'not_equals'] : ['equals', 'not_equals', 'is_empty', 'is_not_empty'];
  return ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'];
}
export interface WorkflowActionDefinition {
  type: WorkflowActionType; label: string; description: string; entities: WorkflowEntity[];
  configSchema: Record<string, { type: string; label: string; required: boolean; options?: string[] }>;
}
export type TriggerDefinition = WorkflowTriggerDefinition;
export type ActionDefinition = WorkflowActionDefinition;
export interface WorkflowExecutionStep {
  id: string; tenantId: string; executionId: string; stepIndex: number; actionType: string;
  status: 'running' | 'success' | 'failed' | 'skipped'; output?: Record<string, unknown> | null;
  error?: string | null; executedAt: string;
}
export interface WorkflowExecutionRun {
  id: string; tenantId: string; workflowId: string; triggerId: string; entityType: string; entityId: string;
  status: 'running' | 'completed' | 'failed' | 'skipped'; startedAt: string; completedAt?: string | null;
  errorMessage?: string | null; steps: WorkflowExecutionStep[];
  workflowVersion?: number | null;
  definitionSnapshot?: WorkflowDraft | null;
  trigger: { triggerType: string; entityType: string; triggeredAt: string; payload?: { recordName?: string } | null };
}
export interface WorkflowTestResult {
  trigger: { matched: boolean; type: string; requiresEvent?: boolean };
  conditions: { passed: number; total: number; matched: boolean };
  actions: Array<{ type: string; valid: boolean; message: string; assignment?: { resolvedUserId: string; resolvedUserName: string; candidateCount: number; strategy?: string; reason?: string; workload?: number; capacityLimit?: number } }>;
  valid: boolean;
}
export interface WorkflowNameAvailability { available: boolean; suggestedName?: string }

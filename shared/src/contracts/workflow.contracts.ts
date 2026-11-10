import { z } from 'zod';
import type { ClosingField } from './closing-requirements';
import { conditionFieldKind, conditionOperators } from './condition-operators';

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
}).strict().transform(action => {
  if (action.type !== 'send_email') return action;
  const { senderUserId: _deprecated, ...config } = action.config;
  return { ...action, config };
});
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowActionType = WorkflowAction['type'];
/** Older actions with a saved reason keep that reason unless explicitly disabled. */
export function workflowLossReason(config: Record<string, unknown>): string | undefined {
  return config.includeLossReason === false ? undefined : typeof config.lostReason === 'string' ? config.lostReason.trim() || undefined : undefined;
}
export function workflowLossReasonIssue(config: Record<string, unknown>, incomplete = false): string | undefined {
  if (config.includeLossReason !== undefined && typeof config.includeLossReason !== 'boolean') return 'Include a loss reason must be Yes or No.';
  if (config.lostReason !== undefined && (typeof config.lostReason !== 'string' || config.lostReason.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(config.lostReason))) return 'Loss reason must be text of at most 2000 characters without control characters.';
  // Retired UI flag: blank legacy reasons are optional; stage evidence still applies.
}
const optionalWorkflowReference = z.preprocess(value => value === '' ? undefined : value, z.string().uuid().optional());
export const WorkflowTaskAssociationSchema = z.object({
  targetMode: z.preprocess(value => value === '' ? undefined : value, z.enum(['triggering_deal', 'single_match', 'all_matching']).optional()),
  pipelineId: optionalWorkflowReference,
  currentStageId: optionalWorkflowReference,
  productInterestId: optionalWorkflowReference,
  dealId: optionalWorkflowReference,
});
export type WorkflowTaskAssociation = z.infer<typeof WorkflowTaskAssociationSchema>;
export const WORKFLOW_ASSIGNMENT_METHODS = {
  round_robin: 'Round-robin',
  weighted_workload: 'Weighted workload assignment',
} as const;
export const WorkflowAssignmentStrategySchema = z.enum(['round_robin', 'weighted_workload']);
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
};
export const WorkflowAssignmentTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('record_owner') }).strict(),
  z.object({ type: z.literal('user'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('role'), ...poolAssignment }).strict(),
  z.object({ type: z.literal('group'), ...poolAssignment }).strict(),
]);
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
/** Adapt saved retired methods on read; new API input still uses the strict target schema. */
export function normalizeSavedWorkflowAssignment(action: WorkflowAction): WorkflowAction {
  if (action.type === 'send_email') {
    const { senderUserId: _deprecated, ...config } = action.config;
    return { ...action, config };
  }
  if (!['create_task', 'assign_owner'].includes(action.type)) return action;
  const normalized = normalizeWorkflowAssignment(action);
  const target = normalized.config.assignmentTarget;
  if (!target || typeof target !== 'object' || !('type' in target) || !('strategy' in target) ||
      !['role', 'group'].includes(String(target.type)) ||
      !['least_workload', 'random', 'availability', 'capacity', 'sticky'].includes(String(target.strategy))) return normalized;
  const { sticky: _retired, ...pool } = target as Record<string, unknown>;
  return { ...normalized, config: { ...normalized.config, assignmentTarget: { ...pool, strategy: 'round_robin' } } };
}
export type WorkflowEntity = 'lead' | 'contact' | 'deal' | 'account';
export const WorkflowDraftSchema = z.object({
  name: z.string().regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.').trim().min(1, 'Workflow name is required.').max(255),
  description: z.string().max(2000).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Control characters are not allowed.').transform(value => value.trim()).nullable().optional(),
  trigger: z.string().min(1, 'Choose a trigger.'),
  conditions: WorkflowConditionSchema.nullable().optional(),
  actions: z.array(WorkflowActionSchema).max(20),
  isActive: z.boolean().default(false),
}).strict();
export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>;
export const WorkflowValidationSchema = WorkflowDraftSchema.extend({ workflowId: z.string().uuid().optional() });
export interface WorkflowOptions {
  customFields?: ClosingField[];
  fieldLayouts?: Partial<Record<import('./closing-requirements').CustomFieldModule, import('./field-catalog').FieldLayout>>;
  users: Array<{id:string;name:string}>;
  taskAssignees?: Array<{id:string;name:string}>;
  roles?: WorkflowAssignmentPoolOption[];
  groups?: WorkflowAssignmentPoolOption[];
  pipelines: Array<{id:string;name:string;stages:Array<{id:string;name:string;order?:number;isDefault?:boolean;isWon?:boolean;isLost?:boolean;requiredFields?:string[]}>}>;
  templates: Array<{id:string;name:string}>;
  campaigns: Array<{id:string;name:string}>;
  productInterests?: Array<{id:string;name:string}>;
  accounts?: Array<{id:string;name:string}>;
  contacts?: Array<{id:string;name:string}>;
  leads?: Array<{id:string;name:string}>;
  smsConfigured?: boolean;
}
export interface Workflow extends WorkflowDraft {
  /** Original server-owned creator; null for unverifiable historical rows. */
  createdById?: string | null;
  draftDefinition?: WorkflowDraft | null;
  draftRevision?: number;
  repairReason?: string;
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
  const keys: Record<string, WorkflowConditionOperator> = { gt: 'greater_than', gte: 'greater_than_or_equal', lt: 'less_than', lte: 'less_than_or_equal' };
  return conditionOperators('workflow', conditionFieldKind(type)).map(key => keys[key] ?? key as WorkflowConditionOperator);
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
export const WorkflowExecutionViewSchema = z.enum(['all', 'outcomes']);
export type WorkflowExecutionView = z.infer<typeof WorkflowExecutionViewSchema>;
export const WORKFLOW_OUTCOME_STATUSES = ['completed', 'failed', 'skipped', 'interrupted'] as const;
export type WorkflowRunOutcome = 'completed' | 'failed' | 'skipped';
/** Interrupted submissions remain uncertain internally and require review, never automatic replay. */
export function workflowRunOutcome(status: WorkflowExecutionRun['status']): WorkflowRunOutcome | null {
  if (status === 'interrupted') return 'failed';
  return status === 'completed' || status === 'failed' || status === 'skipped' ? status : null;
}
export interface WorkflowExecutionRun {
  id: string; tenantId: string; workflowId: string; triggerId: string; entityType: string; entityId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'interrupted'; startedAt: string; completedAt?: string | null;
  errorMessage?: string | null; steps: WorkflowExecutionStep[];
  workflowVersion?: number | null;
  definitionSnapshot?: WorkflowDraft | null;
  trigger: { triggerType: string; entityType: string; triggeredAt: string; payload?: { recordName?: string } | null };
}
export const WorkflowTestInputSchema = z.object({ entityId: z.string().uuid(), stageHistoryId: z.string().uuid().optional(), useDraft: z.boolean().optional() }).strict();
export type WorkflowTestInput = z.infer<typeof WorkflowTestInputSchema>;
export interface WorkflowTaskPreview {
  title: string; description?: string | null; priority: 'Low' | 'Medium' | 'High'; status: 'pending';
  dueDate: string; assignedUserId: string; dealIds: string[];
  taskCount?: 1; dealCount?: number; deals?: Array<{ id: string; title: string }>; associationSummary?: string;
}
export interface WorkflowEmailPreview {
  senderName: string; senderEmail: string; recipient: string; subject: string; body: string; warnings: string[];
}
export interface WorkflowTestResult {
  trigger: { matched: boolean; type: string; requiresEvent?: boolean; stageHistoryId?: string; eventId?: string; reason?: string };
  conditions: { passed: number; total: number; matched: boolean };
  actions: Array<{ type: string; valid: boolean; message: string; status?: 'ready' | 'skipped' | 'failed'; taskPreview?: WorkflowTaskPreview; emailPreview?: WorkflowEmailPreview; warnings?: string[]; assignment?: { resolvedUserId: string; resolvedUserName: string; candidateCount: number; strategy?: string; reason?: string; workload?: number; capacityLimit?: number } }>;
  valid: boolean;
}
export interface WorkflowNameAvailability { available: boolean; suggestedName?: string }

export const WorkflowRevisionWriteSchema = z.object({ draft: WorkflowDraftSchema, expectedDraftRevision: z.number().int().min(0), expectedVersion: z.number().int().min(1) }).strict();
export const WorkflowRevisionTokenSchema = WorkflowRevisionWriteSchema.omit({ draft: true });
export type WorkflowRevisionWrite = z.infer<typeof WorkflowRevisionWriteSchema>;
export type WorkflowRevisionToken = z.infer<typeof WorkflowRevisionTokenSchema>;

/** Initial activation and controlling a published workflow are separate grants. */
export function workflowStateAction(workflow: { status?: string; isActive?: boolean }, isActive: boolean): 'canActivate' | 'canPause' {
  return !isActive || workflow.status === 'PAUSED' ? 'canPause' : 'canActivate';
}

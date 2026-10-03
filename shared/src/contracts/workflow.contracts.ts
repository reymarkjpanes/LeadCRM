import { z } from 'zod';

export const WorkflowConditionOperatorSchema = z.enum([
  'equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal',
  'less_than_or_equal', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty', 'before', 'after',
]);
export type WorkflowConditionOperator = z.infer<typeof WorkflowConditionOperatorSchema>;
export const WorkflowConditionRuleSchema = z.object({
  field: z.string().min(1), operator: WorkflowConditionOperatorSchema,
  value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
}).strict();
export type WorkflowConditionRule = z.infer<typeof WorkflowConditionRuleSchema>;
export const WorkflowConditionSchema = z.object({
  operator: z.enum(['AND', 'OR']), conditions: z.array(WorkflowConditionRuleSchema).max(30),
}).strict();
export type WorkflowCondition = z.infer<typeof WorkflowConditionSchema>;
export type WorkflowConditionGroup = WorkflowCondition;
export const WorkflowActionSchema = z.object({
  type: z.enum(['create_task', 'send_email', 'send_sms', 'assign_owner', 'update_field', 'create_notification', 'move_deal_stage', 'send_campaign']),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()),
}).strict();
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowActionType = WorkflowAction['type'];
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
export interface WorkflowOptions {
  users: Array<{id:string;name:string}>;
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
}
export function workflowOperators(type: WorkflowField['type']): WorkflowConditionOperator[] {
  if (type === 'products' || type === 'list') return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
  if (type === 'number') return ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal'];
  if (type === 'date') return ['equals', 'before', 'after'];
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
  trigger: { triggerType: string; entityType: string; triggeredAt: string; payload?: { recordName?: string } | null };
}
export interface WorkflowTestResult {
  trigger: { matched: boolean; type: string; requiresEvent?: boolean };
  conditions: { passed: number; total: number; matched: boolean };
  actions: Array<{ type: string; valid: boolean; message: string }>;
  valid: boolean;
}
export interface WorkflowNameAvailability { available: boolean; suggestedName?: string }

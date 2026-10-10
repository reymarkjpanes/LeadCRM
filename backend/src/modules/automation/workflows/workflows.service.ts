import { compatibleWorkflow } from './workflow-fields';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { WorkflowDraftSchema, WorkflowValidationSchema, WorkflowConditionSchema, missingWorkflowConditionValues, normalizeWorkflowAssignment, type WorkflowDraft, type WorkflowTestResult } from '@leadcrm/shared';
import { assignmentPurpose, parseAssignment, resolveWorkflowAssignee, assignmentOutput } from '../assignment/workflow-assignment.service';
import { assertWorkflowPermissions, assertAssignmentReferencePermissions } from '../actions/action-permissions';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { paginate } from '../../../shared/helpers/pagination';
import * as repo from './workflows.repository';
import { validateWorkflow, validateConditionReferences } from './workflow-validation';
import { findTrigger } from '../triggers/trigger-catalog';
import { validateAction } from '../actions/action-validation';
import { resolveDealTargets } from '../actions/action-deal-targets';
import { fieldUpdatePatch } from '../actions/action-fields';
import { evaluateCondition, evaluateRule } from './workflow-conditions';
import { safeWorkflowError } from '../actions/action-dispatcher';
import { findUserEffectivePermissions } from '../../administration/roles/roles.repository';
import { findUser } from '../actions/actions.repository';
import { sanitizeCampaignHtml } from '../../marketing/campaigns/campaign-content';
import { z } from 'zod';
import { workflowNameKey, suggestWorkflowCopyName } from './workflow-names';
import { workflowDefinitionChanged } from './workflow-version';

function sanitizeDraft(draft: WorkflowDraft, previousConditions?: unknown): WorkflowDraft {
  const previous = WorkflowConditionSchema.safeParse(previousConditions);
  const incomplete = new Set(missingWorkflowConditionValues(draft.conditions, previous.success ? previous.data : undefined));
  return { ...draft, ...(draft.conditions ? { conditions: { ...draft.conditions, conditions: draft.conditions.conditions.map(({ incompleteValue: _previousMarker, ...rule }, index) => incomplete.has(index) ? { ...rule, incompleteValue: true as const } : rule) } } : {}), actions: draft.actions.map(normalizeWorkflowAssignment).map(action => ({ ...action, config: Object.fromEntries(
    Object.entries(action.config).map(([key, value]) => [key, typeof value !== 'string' ? value
      : action.type === 'send_email' && key === 'body' ? sanitizeCampaignHtml(value.trim()) : value.trim()]),
  ) })) };
}

function requireScope(tenantId: string) {
  const scope = tenantContext.getStore();
  if (!scope || scope.tenantId !== tenantId) throw new ValidationError('A matching CRM tenant context is required for automation.');
}

export async function getOptions(tenantId: string, userId: string) {
  requireScope(tenantId);
  const user = await findUser(userId, tenantId);
  const permissions = await findUserEffectivePermissions(userId, tenantId);
  const admin = user?.role === 'Client Admin';
  const marketing = admin || !!permissions.campaigns?.canView;
  return repo.builderOptions(tenantId, marketing, Object.fromEntries(['contacts', 'accounts', 'leads', 'deals', 'products', 'users', 'roles', 'groups'].map(module => [module, admin || !!permissions[module]?.canView])) as { contacts: boolean; accounts: boolean; leads: boolean; deals: boolean; products: boolean; users: boolean; roles: boolean; groups: boolean });
}

export async function getWorkflows(tenantId: string, query: Record<string, unknown>) {
  requireScope(tenantId);
  const result = await repo.listWorkflows(tenantId, query);
  return paginate(result.rows, result.total, result);
}
export async function getWorkflowById(id: string, tenantId: string) {
  requireScope(tenantId);
  const workflow = await repo.findWorkflowById(id, tenantId);
  if (!workflow) throw new NotFoundError('Workflow');
  return compatibleWorkflow(workflow, tenantId);
}
export async function getWorkflowNameAvailability(tenantId: string, name: unknown, excludeId?: unknown) {
  requireScope(tenantId);
  const parsedName = WorkflowDraftSchema.shape.name.safeParse(name);
  if (!parsedName.success) throw new ValidationError(parsedName.error.issues.map(issue => issue.message).join('; '));
  let excluded: string | undefined;
  if (excludeId !== undefined) {
    const parsedId = z.string().uuid().safeParse(excludeId);
    if (!parsedId.success) throw new ValidationError('Choose an existing workflow when checking its name.');
    excluded = parsedId.data;
    await getWorkflowById(excluded, tenantId);
  }
  const names = (await repo.workflowNames(tenantId, excluded)).map(row => row.name);
  const available = !names.some(existing => workflowNameKey(existing) === workflowNameKey(parsedName.data));
  return available ? { available: true } : { available: false, suggestedName: suggestWorkflowCopyName(parsedName.data, names) };
}
function parseDraft(value: unknown): WorkflowDraft {
  const result = WorkflowDraftSchema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return result.data;
}
export async function createWorkflow(tenantId: string, userId: string, dto: unknown) {
  requireScope(tenantId);
  const draft = parseDraft(dto);
  await assertAssignmentReferencePermissions(draft, tenantId, userId);
  if (!findTrigger(draft.trigger)) throw new ValidationError('Choose a supported trigger.');
  await validateConditionReferences(draft, tenantId);
  if (!draft.isActive) for (const action of draft.actions) await validateAction(action, findTrigger(draft.trigger)!.entity, tenantId, undefined, true);
  if (draft.isActive) { await validateWorkflow(draft, tenantId); await assertWorkflowPermissions(draft, tenantId, userId); }
  const workflow = await repo.createWorkflow(tenantId, sanitizeDraft(draft), draft.isActive ? userId : undefined);
  await writeAuditLog({ tenantId, userId, action: 'workflow.created', entityType: 'Workflow', entityId: workflow.id });
  return workflow;
}
export async function updateWorkflow(id: string, tenantId: string, userId: string, dto: Record<string, unknown>) {
  requireScope(tenantId);
  const existing = await getWorkflowById(id, tenantId);
  if (existing.isArchived) throw new ValidationError('Archived workflows cannot be edited or activated. Duplicate an available workflow instead.');
  // Pausing must remain possible when a referenced user, template or campaign is no longer valid.
  if (Object.keys(dto).length === 1 && dto.isActive === false) {
    const workflow = await repo.updateWorkflow(id, tenantId, { isActive: false, status: existing.isActive || existing.status === 'PAUSED' ? 'PAUSED' : 'DRAFT' });
    if (existing.isActive) await writeAuditLog({ tenantId, userId, action: 'workflow.paused', entityType: 'Workflow', entityId: id });
    return workflow;
  }
  const updates = WorkflowDraftSchema.partial().safeParse(dto);
  if (!updates.success) throw new ValidationError('Use the supported workflow fields.');
  const draft = parseDraft({ name: existing.name, description: existing.description, trigger: existing.trigger,
    conditions: existing.conditions, actions: existing.actions, isActive: existing.isActive, ...updates.data });
  await assertAssignmentReferencePermissions(draft, tenantId, userId);
  if (!findTrigger(draft.trigger)) throw new ValidationError('Choose a supported trigger.');
  await validateConditionReferences(draft, tenantId);
  if (!draft.isActive) for (const action of draft.actions) await validateAction(action, findTrigger(draft.trigger)!.entity, tenantId, undefined, true);
  if (draft.isActive) { await validateWorkflow(draft, tenantId, existing.status !== 'DRAFT' ? existing.conditions : undefined); await assertWorkflowPermissions(draft, tenantId, userId); }
  const sanitized = sanitizeDraft(draft, existing.status !== 'DRAFT' ? existing.conditions : undefined);
  const workflow = await repo.updateWorkflow(id, tenantId, { ...sanitized, status: draft.isActive ? 'ACTIVE' : existing.isActive || existing.status === 'PAUSED' ? 'PAUSED' : 'DRAFT', ...(draft.isActive ? { activatedById: userId } : {}) }, workflowDefinitionChanged(existing, sanitized));
  await writeAuditLog({ tenantId, userId, action: existing.isActive !== workflow.isActive ? workflow.isActive ? 'workflow.activated' : 'workflow.paused' : 'workflow.updated', entityType: 'Workflow', entityId: id });
  return workflow;
}
export async function toggleWorkflow(id: string, tenantId: string, userId: string, isActive: boolean) {
  requireScope(tenantId);
  return updateWorkflow(id, tenantId, userId, { isActive });
}

export async function archiveWorkflow(id: string, tenantId: string, userId: string) {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  await repo.updateWorkflow(id, tenantId, { isArchived: true, isActive: false, status: 'PAUSED' });
  await writeAuditLog({ tenantId, userId, action: 'workflow.archived', entityType: 'Workflow', entityId: id });
}
export async function getWorkflowExecutions(id: string, tenantId: string, page = 1) {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  return repo.listExecutions(id, tenantId, page);
}
export async function getWorkflowExecutionPage(id: string, tenantId: string, page: number, limit: number) {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  const [data, total] = await Promise.all([repo.listExecutions(id, tenantId, page, limit), repo.countExecutions(id, tenantId)]);
  return paginate(data, total, { page, limit });
}
export async function testWorkflow(id: string, tenantId: string, entityId: string, userId?: string): Promise<WorkflowTestResult> {
  requireScope(tenantId);
  const existing = await getWorkflowById(id, tenantId);
  const draft = parseDraft({ name: existing.name, description: existing.description, trigger: existing.trigger,
    conditions: existing.conditions, actions: existing.actions, isActive: false });
  const trigger = findTrigger(draft.trigger);
  if (!trigger) throw new ValidationError('Choose a supported trigger.');
  if (userId) await assertWorkflowPermissions(draft, tenantId, userId);
  const context = await repo.entityContext(trigger.entity, entityId, tenantId);
  if (!context) throw new NotFoundError('Sample record');
  const conditionContext = { ...context };
  const actions: WorkflowTestResult['actions'] = [];
  const previewLoads = new Map<string, number>();
  for (const [actionIndex, action] of draft.actions.entries()) {
    if (action.enabled === false) {
      actions.push({ type: action.type, valid: true, message: 'Disabled. This action will be skipped.' });
      continue;
    }
    try { await validateAction(action, trigger.entity, tenantId, context);
      const resolvedAssignment = ['create_task', 'assign_owner'].includes(action.type) ? await resolveWorkflowAssignee({
        tenantId, workflowId: id, actionIndex, target: parseAssignment(action), purpose: assignmentPurpose(action),
        recordOwnerId: context[`${trigger.entity}.assignedUserId`] as string | undefined, entity: trigger.entity, entityId, dryRun: true, previewLoads,
      }) : undefined;
      const assignment = resolvedAssignment ? assignmentOutput(resolvedAssignment) : undefined;
      const targets = action.type === 'move_deal_stage' ? await resolveDealTargets(action, trigger.entity, tenantId, context) : undefined;
      actions.push({ type: action.type, valid: true, ...(assignment ? { assignment } : {}),
        message: assignment ? `Would assign ${assignment.resolvedUserName} (${assignment.candidateCount} eligible). ${assignment.reason}.${assignment.workload !== undefined ? ` Active workload: ${assignment.workload}${assignment.capacityLimit !== undefined ? ` / ${assignment.capacityLimit}` : ''}.` : ''} No records or assignment state changed.` : targets ? (targets.length ? `${targets.length} matching Deal(s): ${targets.join(', ')}. No changes made.` : 'No matching Deals. This action will be a no-op.')
          : action.type === 'send_email' ? 'Recipient, sender permissions, mailbox ownership and projected assignment are valid. No email sent.' : 'Configuration and references valid. No changes made.' });
      // Project validated earlier actions into this in-memory sample only.
      if (action.type === 'assign_owner') context[`${trigger.entity}.assignedUserId`] = assignment!.resolvedUserId;
      if (action.type === 'create_task' && assignment) {
        const key = `task:${assignment.resolvedUserId}`;
        previewLoads.set(key, (previewLoads.get(key) ?? 0) + 1);
      }
      if (action.type === 'update_field') {
        const patch = await fieldUpdatePatch(action, trigger.entity, tenantId);
        for (const [field, value] of Object.entries(patch)) {
          if (field === 'customFieldValues') for (const [id, customValue] of Object.entries(value as Record<string, unknown>)) context[`${trigger.entity}.customFieldValues.${id}`] = customValue;
          else context[`${trigger.entity}.${field === 'productInterest' ? 'productInterestIds' : field}`] = value;
        }
      }
    }
    catch (error) { actions.push({ type: action.type, valid: false, message: safeWorkflowError(error) }); }
  }
  await validateConditionReferences(draft, tenantId);
  const rules = draft.conditions?.conditions ?? [];
  return { trigger: { type: draft.trigger, matched: true, requiresEvent: !draft.trigger.endsWith('.created') }, conditions: { total: rules.length,
    passed: rules.filter(rule => evaluateRule(rule, conditionContext)).length, matched: !draft.conditions || evaluateCondition(draft.conditions, conditionContext) },
    actions, valid: draft.actions.some(action => action.enabled !== false) && actions.every(action => action.valid) };
}

export async function validateDraft(tenantId: string, userId: string, input: unknown) {
  requireScope(tenantId);
  const parsed = WorkflowValidationSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Review the workflow.');
  const { workflowId, ...draft } = parsed.data;
  const existing = workflowId ? await repo.findWorkflowById(workflowId, tenantId) : null;
  if (workflowId && (!existing || existing.isArchived)) throw new NotFoundError('Workflow');
  await assertAssignmentReferencePermissions(draft, tenantId, userId);
  await validateWorkflow(draft, tenantId, existing && existing.status !== 'DRAFT' ? existing.conditions : undefined);
  await assertWorkflowPermissions(draft, tenantId, userId);
  return { valid: true, message: 'Trigger, conditions, action configuration, permissions and references are valid. No actions were executed.' };
}
export async function getExecution(id: string, workflowId: string, tenantId: string) {
  requireScope(tenantId);
  await getWorkflowById(workflowId, tenantId);
  const run = await repo.findExecution(id, workflowId, tenantId);
  if (!run) throw new NotFoundError('Workflow execution');
  return run;
}

export async function duplicateWorkflow(id: string, tenantId: string, userId: string) {
  const original = await getWorkflowById(id, tenantId);
  const names = (await repo.workflowNames(tenantId)).map(row => row.name);
  // Duplication preserves repairable references without activating or copying runs.
  const draft = parseDraft({ name: suggestWorkflowCopyName(original.name, names), description: original.description, trigger: original.trigger, conditions: original.conditions, actions: original.actions, isActive: false });
  const copy = await repo.createWorkflow(tenantId, sanitizeDraft(draft));
  await writeAuditLog({ tenantId, userId, action: 'workflow.duplicated', entityType: 'Workflow', entityId: copy.id, metadata: { sourceId: id } });
  return copy;
}

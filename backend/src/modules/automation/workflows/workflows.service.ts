import { tenantContext } from '../../../core/tenant/tenant-context';
import { WorkflowDraftSchema, type WorkflowDraft, type WorkflowTestResult } from '@leadcrm/shared';
import { assertWorkflowPermissions } from '../actions/action-permissions';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { paginate } from '../../../shared/helpers/pagination';
import * as repo from './workflows.repository';
import { validateWorkflow, validateWorkflowConditions, validateConditionReferences } from './workflow-validation';
import { findTrigger } from '../triggers/trigger-catalog';
import { validateAction } from '../actions/action-validation';
import { fieldUpdatePatch } from '../actions/action-fields';
import { evaluateCondition, evaluateRule } from './workflow-conditions';
import { safeWorkflowError } from '../actions/action-dispatcher';
import { findUserEffectivePermissions } from '../../administration/roles/roles.repository';
import { findUser } from '../actions/actions.repository';
import { sanitizeCampaignHtml } from '../../marketing/campaigns/campaign-content';
import { z } from 'zod';
import { workflowNameKey, suggestWorkflowCopyName } from './workflow-names';

function sanitizeDraft(draft: WorkflowDraft): WorkflowDraft {
  return { ...draft, actions: draft.actions.map(action => ({ ...action, config: Object.fromEntries(
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
  return repo.builderOptions(tenantId, marketing, { contacts: admin || !!permissions.contacts?.canView, accounts: admin || !!permissions.accounts?.canView });
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
  return workflow;
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
    const workflow = await repo.updateWorkflow(id, tenantId, { isActive: false, status: 'PAUSED' });
    if (existing.isActive) await writeAuditLog({ tenantId, userId, action: 'workflow.paused', entityType: 'Workflow', entityId: id });
    return workflow;
  }
  const updates = WorkflowDraftSchema.partial().safeParse(dto);
  if (!updates.success) throw new ValidationError('Use the supported workflow fields.');
  const draft = parseDraft({ name: existing.name, description: existing.description, trigger: existing.trigger,
    conditions: existing.conditions, actions: existing.actions, isActive: existing.isActive, ...updates.data });
  if (!findTrigger(draft.trigger)) throw new ValidationError('Choose a supported trigger.');
  await validateConditionReferences(draft, tenantId);
  if (!draft.isActive) for (const action of draft.actions) await validateAction(action, findTrigger(draft.trigger)!.entity, tenantId, undefined, true);
  if (draft.isActive) { await validateWorkflow(draft, tenantId); await assertWorkflowPermissions(draft, tenantId, userId); }
  const workflow = await repo.updateWorkflow(id, tenantId, { ...sanitizeDraft(draft), status: draft.isActive ? 'ACTIVE' : 'DRAFT', ...(draft.isActive ? { activatedById: userId } : {}) });
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
export async function testWorkflow(id: string, tenantId: string, entityId: string): Promise<WorkflowTestResult> {
  requireScope(tenantId);
  const existing = await getWorkflowById(id, tenantId);
  const draft = parseDraft({ name: existing.name, description: existing.description, trigger: existing.trigger,
    conditions: existing.conditions, actions: existing.actions, isActive: false });
  const trigger = findTrigger(draft.trigger);
  if (!trigger) throw new ValidationError('Choose a supported trigger.');
  const context = await repo.entityContext(trigger.entity, entityId, tenantId);
  if (!context) throw new NotFoundError('Sample record');
  const conditionContext = { ...context };
  const actions: WorkflowTestResult['actions'] = [];
  for (const action of draft.actions) {
    if (action.enabled === false) {
      actions.push({ type: action.type, valid: true, message: 'Disabled. This action will be skipped.' });
      continue;
    }
    try { await validateAction(action, trigger.entity, tenantId, context); actions.push({ type: action.type, valid: true,
      message: action.type === 'send_email' ? 'Recipient resolved; template and sender available. No email sent.' : 'Configuration and references valid. No changes made.' });
      // Project validated earlier actions into this in-memory sample only.
      if (action.type === 'assign_owner') context[`${trigger.entity}.assignedUserId`] = action.config.userId;
      if (action.type === 'update_field') {
        const patch = await fieldUpdatePatch(action, trigger.entity, tenantId);
        for (const [field, value] of Object.entries(patch)) context[`${trigger.entity}.${field}`] = value;
      }
    }
    catch (error) { actions.push({ type: action.type, valid: false, message: safeWorkflowError(error) }); }
  }
  validateWorkflowConditions(draft);
  const rules = draft.conditions?.conditions ?? [];
  return { trigger: { type: draft.trigger, matched: true, requiresEvent: !draft.trigger.endsWith('.created') }, conditions: { total: rules.length,
    passed: rules.filter(rule => evaluateRule(rule, conditionContext)).length, matched: !draft.conditions || evaluateCondition(draft.conditions, conditionContext) },
    actions, valid: draft.actions.some(action => action.enabled !== false) && actions.every(action => action.valid) };
}

export async function validateDraft(tenantId: string, userId: string, input: unknown) {
  requireScope(tenantId);
  const draft = parseDraft(input);
  await validateWorkflow(draft, tenantId);
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
  return createWorkflow(tenantId, userId, { name: suggestWorkflowCopyName(original.name, names), description: original.description, trigger: original.trigger, conditions: original.conditions, actions: original.actions, isActive: false });
}

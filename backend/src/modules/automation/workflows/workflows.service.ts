import { creatorWhere } from '../../crm/access/record-visibility';
import { assertPermissions } from '../../../core/permissions/permission.service';
import { hasModulePermission, PERMISSION_ACTION_KEYS, workflowStateAction, type PermissionKey } from '@leadcrm/shared';
import { WorkflowRevisionWriteSchema, WorkflowRevisionTokenSchema, WorkflowAssignmentTargetSchema, workflowAssignmentTarget, Role } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { Prisma } from '@prisma/client';
import { ConflictError } from '../../../shared/errors/http-error';
import { AppError } from '../../../shared/errors/app-error';
import { compatibleWorkflow, accountWorkflowRetirementReferences } from './workflow-fields';
import { retiredContactReferences, retiredAccountWorkflowReferences, ACCOUNT_RETIREMENT_REASON } from '@leadcrm/shared';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { WorkflowDraftSchema, WorkflowValidationSchema, WorkflowConditionSchema, missingWorkflowConditionValues, normalizeWorkflowAssignment, type WorkflowDraft, type WorkflowTestResult } from '@leadcrm/shared';
import { assignmentPurpose, parseAssignment, resolveWorkflowAssignee, assignmentOutput } from '../assignment/workflow-assignment.service';
import { assertWorkflowPermissions, assertAssignmentReferencePermissions } from '../actions/action-permissions';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import { paginate } from '../../../shared/helpers/pagination';
import * as repo from './workflows.repository';
import { validateWorkflow, validateConditionReferences, validateDealStageMovePipelineReferences } from './workflow-validation';
import { findTrigger } from '../triggers/trigger-catalog';
import { validateAction } from '../actions/action-validation';
import { resolveDealTargets, type WorkflowDealProjection } from '../actions/action-deal-targets';
import { loadWorkflowDealProjection, projectWorkflowFields, projectWorkflowDealMove } from './workflow-preview';
import type { WorkflowExecutionView } from '@leadcrm/shared';
import { fieldUpdatePatch } from '../actions/action-fields';
import { evaluateCondition, evaluateRule } from './workflow-conditions';
import { safeWorkflowError } from '../actions/action-dispatcher';
import { findUserEffectivePermissions } from '../../administration/roles/roles.repository';
import { findUser } from '../actions/actions.repository';
import { sanitizeCampaignHtml } from '../../marketing/campaigns/campaign-content';
import { z } from 'zod';
import { workflowNameKey, suggestWorkflowCopyName } from './workflow-names';
import { workflowDefinitionChanged } from './workflow-version';
import { workflowStageEvent, assertCurrentStageEntry, isStageEvent, isSupersededStageEntry } from './workflow-stage-entry';
import { prepareWorkflowTaskInput } from '../actions/action-task-input';
import { resolveTaskDeals, workflowTaskAssociationSummary } from '../actions/action-task-deals';
import { prepareWorkflowEmailInput } from '../actions/action-email';
import { prepareWorkflowSmsInput } from '../actions/action-sms';
import { workflowActionPolicyIssues, workflowDefinitionIssues } from '@leadcrm/shared';
import { WORKFLOW_MODULES } from '@leadcrm/shared';
import { crmActor, assertCrmRecordRead } from '../../crm/access/crm-record-access.service';

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
  return paginate(await Promise.all(result.rows.map(row => compatibleWorkflow(row, tenantId))), result.total, result);
}
export async function getWorkflowById(id: string, tenantId: string) {
  requireScope(tenantId);
  const workflow = await repo.findVisibleWorkflowById(id, tenantId);
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
  if (draft.isActive) {
    const issues = workflowActionPolicyIssues(draft);
    if (issues.length) throw new ValidationError(issues[0]);
  }
  if ((await accountWorkflowRetirementReferences(draft, tenantId)).length) throw new ValidationError(ACCOUNT_RETIREMENT_REASON);
  if (retiredContactReferences([draft.conditions, draft.actions], findTrigger(draft.trigger)?.entity).length) throw new ValidationError('Retired Contact fields cannot be used in a new Workflow. Choose supported fields.');
  await assertAssignmentReferencePermissions(draft, tenantId, userId);
  if (!findTrigger(draft.trigger)) throw new ValidationError('Choose a supported trigger.');
  await validateConditionReferences(draft, tenantId);
  if (!draft.isActive) for (const action of draft.actions) await validateAction(action, findTrigger(draft.trigger)!.entity, tenantId, undefined, true);
  if (draft.isActive) { await validateWorkflow(draft, tenantId); await assertWorkflowPermissions(draft, tenantId, userId); }
  const workflow = await repo.createWorkflow(tenantId, sanitizeDraft(draft), draft.isActive ? userId : undefined, userId);
  await writeAuditLog({ tenantId, userId, action: 'workflow.created', entityType: 'Workflow', entityId: workflow.id });
  return workflow;
}
export async function updateWorkflow(id: string, tenantId: string, userId: string, dto: Record<string, unknown>) {
  requireScope(tenantId);
  const stored = await repo.findVisibleWorkflowById(id, tenantId);
  if (!stored) throw new NotFoundError('Workflow');
  if (stored.isArchived) throw new ValidationError('Archived workflows cannot be edited or activated. Duplicate an available workflow instead.');
  const pausing = Object.keys(dto).length === 1 && dto.isActive === false;
  const alreadyActive = Object.keys(dto).length === 1 && dto.isActive === true && stored.isActive && stored.status === 'ACTIVE';
  if (alreadyActive) {
    const permissions = await findUserEffectivePermissions(userId, tenantId);
    if (!hasModulePermission(permissions, 'workflows', 'canActivate') && !hasModulePermission(permissions, 'workflows', 'canPause')) throw new AppError('Access denied', 403);
    return stored;
  }
  const existing = pausing ? stored : await compatibleWorkflow(stored, tenantId);
  const changingDefinition = Object.keys(dto).some(key => key !== 'isActive');
  const enablingPaused = stored.status === 'PAUSED' && !stored.isActive && dto.isActive === true && !changingDefinition;
  const resuming = enablingPaused && !!await prisma.workflowPublication.findUnique({
    where: { workflowId_tenantId_version: { workflowId: id, tenantId, version: stored.version } }, select: { id: true },
  });
  const required: PermissionKey[] = changingDefinition || dto.isActive === undefined ? ['workflows.edit'] : [];
  if (dto.isActive !== undefined && (dto.isActive !== existing.isActive || !changingDefinition)) {
    required.push(dto.isActive === true && (changingDefinition || enablingPaused && !resuming) ? 'workflows.activate'
      : `workflows.${PERMISSION_ACTION_KEYS[workflowStateAction(existing, dto.isActive === true)]}`);
  }
  if (changingDefinition && existing.isActive && dto.isActive !== false) required.push('workflows.activate');
  await assertPermissions({ userId, tenantId, role: '' }, required);
  // Pausing must remain possible when a referenced user, template or campaign is no longer valid.
  if (pausing) {
    const workflow = await repo.updateWorkflow(id, tenantId, { isActive: false, status: existing.isActive || existing.status === 'PAUSED' ? 'PAUSED' : 'DRAFT' }, stored);
    if (existing.isActive) await writeAuditLog({ tenantId, userId, action: 'workflow.paused', entityType: 'Workflow', entityId: id });
    return workflow;
  }
  const updates = WorkflowDraftSchema.partial().safeParse(dto);
  if (!updates.success) throw new ValidationError('Use the supported workflow fields.');
  const draft = parseDraft({ name: existing.name, description: existing.description, trigger: existing.trigger,
    conditions: existing.conditions, actions: existing.actions, isActive: existing.isActive, ...updates.data });
  const oldReferences = new Set(retiredContactReferences([existing.conditions, existing.actions], findTrigger(existing.trigger)?.entity));
  const oldAccountReferences = new Set(await accountWorkflowRetirementReferences(existing, tenantId));
  const accountReferences = await accountWorkflowRetirementReferences(draft, tenantId);
  if ((draft.isActive && accountReferences.length) || accountReferences.some(field => !oldAccountReferences.has(field))) throw new ValidationError(ACCOUNT_RETIREMENT_REASON);
  if (retiredContactReferences([draft.conditions, draft.actions], findTrigger(draft.trigger)?.entity).some(field => !oldReferences.has(field))) throw new ValidationError('Retired Contact fields cannot be added to a Workflow. Repair the saved references.');
  if (!resuming) await assertAssignmentReferencePermissions(draft, tenantId, userId);
  if (!findTrigger(draft.trigger)) throw new ValidationError('Choose a supported trigger.');
  const validationDraft = !draft.isActive && accountReferences.length ? { ...draft, actions: [], conditions: draft.conditions && { ...draft.conditions,
    conditions: draft.conditions.conditions.filter(rule => !retiredAccountWorkflowReferences({ trigger: draft.trigger, conditions: { conditions: [rule] } }).length),
  } } : draft;
  if (!draft.isActive) await validateConditionReferences(validationDraft, tenantId);
  if (!draft.isActive) for (const action of draft.actions) {
    if ((await accountWorkflowRetirementReferences({ trigger: draft.trigger, actions: [action] }, tenantId)).length) continue;
    await validateAction(action, findTrigger(draft.trigger)!.entity, tenantId, undefined, true);
  }
  if (draft.isActive) {
    // Resume retains the approved publisher. Workers still recheck that publisher's grants.
    if (resuming && !stored.activatedById) throw new ValidationError('Publish this workflow before resuming it.');
    const publisherId = resuming ? stored.activatedById! : userId;
    await crmActor.run({ tenantId, userId: publisherId, readRecords: true }, async () => {
      await validateWorkflow(draft, tenantId, existing.status !== 'DRAFT' ? existing.conditions : undefined);
      await assertWorkflowPermissions(draft, tenantId, publisherId);
    });
  }
  const sanitized = sanitizeDraft(draft, existing.status !== 'DRAFT' ? existing.conditions : undefined);
  const workflow = draft.isActive && !changingDefinition
    ? await repo.updateWorkflow(id, tenantId, { isActive: true, status: 'ACTIVE', ...(resuming ? {} : { activatedById: userId }) }, stored)
    : await repo.updateWorkflow(id, tenantId, { ...sanitized, status: draft.isActive ? 'ACTIVE' : existing.isActive || existing.status === 'PAUSED' ? 'PAUSED' : 'DRAFT', ...(draft.isActive ? { activatedById: userId } : {}) }, stored, workflowDefinitionChanged(existing, sanitized));
  await writeAuditLog({ tenantId, userId, action: existing.isActive !== workflow.isActive ? workflow.isActive ? 'workflow.activated' : 'workflow.paused' : 'workflow.updated', entityType: 'Workflow', entityId: id });
  return workflow;
}
export async function toggleWorkflow(id: string, tenantId: string, userId: string, isActive: boolean) {
  requireScope(tenantId);
  return updateWorkflow(id, tenantId, userId, { isActive });
}

export async function archiveWorkflow(id: string, tenantId: string, userId: string) {
  requireScope(tenantId);
  const stored = await repo.findVisibleWorkflowById(id, tenantId);
  if (!stored) throw new NotFoundError('Workflow');
  await repo.updateWorkflow(id, tenantId, { isArchived: true, isActive: false, status: 'PAUSED' }, stored);
  await writeAuditLog({ tenantId, userId, action: 'workflow.archived', entityType: 'Workflow', entityId: id });
}
export async function getWorkflowExecutions(id: string, tenantId: string, page = 1, view: WorkflowExecutionView = 'all') {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  return repo.listExecutions(id, tenantId, page, 25, view);
}
export async function getWorkflowExecutionPage(id: string, tenantId: string, page: number, limit: number, view: WorkflowExecutionView = 'all') {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  const [data, total] = await Promise.all([repo.listExecutions(id, tenantId, page, limit, view), repo.countExecutions(id, tenantId, view)]);
  return paginate(data, total, { page, limit });
}
export async function testWorkflow(id: string, tenantId: string, entityId: string, userId?: string, stageHistoryId?: string, useDraft = false): Promise<WorkflowTestResult> {
  requireScope(tenantId);
  const actor = crmActor.getStore();
  if ((actor && !actor.readRecords) || (!actor && userId)) {
    return crmActor.run({ ...(actor ?? { tenantId, userId: userId! }), readRecords: true, readPolicy: undefined },
      () => testWorkflow(id, tenantId, entityId, userId, stageHistoryId, useDraft));
  }
  const existing = await getWorkflowById(id, tenantId);
  const draft = parseDraft(useDraft && existing.draftDefinition ? existing.draftDefinition : { name: existing.name, description: existing.description, trigger: existing.trigger,
    conditions: existing.conditions, actions: existing.actions, isActive: false });
  const trigger = findTrigger(draft.trigger);
  if (!trigger) throw new ValidationError('Choose a supported trigger.');
  if (userId) await assertWorkflowPermissions(draft, tenantId, userId, 'workflows.execute');
  await assertCrmRecordRead(prisma, WORKFLOW_MODULES[trigger.entity], entityId);
  const context = await repo.entityContext(trigger.entity, entityId, tenantId);
  if (!context) throw new NotFoundError('Sample record');
  let triggerReason: string | undefined;
  let eventId: string | undefined;
  if (stageHistoryId) {
    const event = await workflowStageEvent(tenantId, entityId, draft.trigger, stageHistoryId);
    Object.assign(context, event.context); eventId = event.eventId;
    try { await assertCurrentStageEntry(tenantId, entityId, stageHistoryId); }
    catch (error) { if (!isSupersededStageEntry(error)) throw error; triggerReason = error.message; }
  } else if (isStageEvent(draft.trigger)) triggerReason = 'Choose a recorded stage transition to evaluate this event. No actions were executed.';
  if (!triggerReason && draft.trigger === 'deal.stage_changed' && context['deal.isQualified'] === true &&
    (context['deal.hasEverBeenWon'] !== false || context['deal.wonHistoryVerified'] !== true)) {
    triggerReason = context['deal.hasEverBeenWon'] ? 'This deal previously reached Won.' : 'This deal’s earlier stage history needs verification.';
  }
  const conditionContext = { ...context };
  const conditionsMatch = !draft.conditions || evaluateCondition(draft.conditions, conditionContext);
  const actions: WorkflowTestResult['actions'] = [];
  const previewLoads = new Map<string, number>();
  const definitionIssues = workflowDefinitionIssues(draft);
  let transitionIssue: string | undefined;
  if (!definitionIssues.length && !triggerReason && conditionsMatch) {
    try { await validateDealStageMovePipelineReferences(draft, tenantId); }
    catch (error) { transitionIssue = safeWorkflowError(error); }
  }
  let stoppedReason = definitionIssues[0] ?? transitionIssue ?? triggerReason ?? (!conditionsMatch ? 'Workflow conditions did not match. Actions would be skipped.' : undefined);
  const projection: WorkflowDealProjection = new Map();
  if (!stoppedReason && trigger.entity === 'deal' && draft.actions.some(action => action.enabled !== false && action.type === 'move_deal_stage')) {
    await loadWorkflowDealProjection(tenantId, entityId, projection);
  }
  for (const [actionIndex, action] of draft.actions.entries()) {
    if (action.enabled === false) {
      actions.push({ type: action.type, valid: true, status: 'skipped', message: 'Disabled. This action will be skipped.' });
      continue;
    }
    if (stoppedReason) { actions.push({ type: action.type, valid: true, status: 'skipped', message: stoppedReason }); continue; }
    try { await validateAction(action, trigger.entity, tenantId, context, false, projection);
      const resolvedAssignment = ['create_task', 'assign_owner'].includes(action.type) ? await resolveWorkflowAssignee({
        tenantId, workflowId: id, actionIndex, target: parseAssignment(action), purpose: assignmentPurpose(action),
        recordOwnerId: context[`${trigger.entity}.assignedUserId`] as string | undefined, entity: trigger.entity, entityId, dryRun: true, previewLoads,
      }) : undefined;
      const assignment = resolvedAssignment ? assignmentOutput(resolvedAssignment) : undefined;
      const targets = action.type === 'move_deal_stage' ? await resolveDealTargets(action, trigger.entity, tenantId, context, projection) : undefined;
      const taskInput = action.type === 'create_task' ? await prepareWorkflowTaskInput({ action, entity: trigger.entity, tenantId, context, assignedUserId: assignment!.resolvedUserId }) : undefined;
      const preparedEmail = action.type === 'send_email' ? await prepareWorkflowEmailInput(action, trigger.entity, tenantId, context) : undefined;
      const preparedSms = action.type === 'send_sms' ? await prepareWorkflowSmsInput(action, trigger.entity, tenantId, context) : undefined;
      const emailPreview = preparedEmail ? { senderName: preparedEmail.senderName, senderEmail: preparedEmail.senderEmail, recipient: preparedEmail.recipient, subject: preparedEmail.subject, body: preparedEmail.body, warnings: preparedEmail.warnings } : undefined;
      const taskPreview = taskInput ? { title: taskInput.title, description: taskInput.description, priority: taskInput.priority,
        status: 'pending' as const, dueDate: taskInput.dueDate, assignedUserId: taskInput.assignedUserId, dealIds: taskInput.dealIds ?? [],
        taskCount: 1 as const, dealCount: taskInput.dealIds!.length, deals: await resolveTaskDeals(action, trigger.entity, tenantId, context),
        associationSummary: workflowTaskAssociationSummary(taskInput.dealIds!.length) } : undefined;
      if (taskPreview && JSON.stringify(taskPreview.deals.map(deal => deal.id)) !== JSON.stringify(taskPreview.dealIds))
        throw new ValidationError('Related deals changed during this check. Run the check again before saving.');
      const ready: WorkflowTestResult['actions'][number] = { type: action.type, valid: true, status: 'ready', ...(assignment ? { assignment } : {}), ...(taskPreview ? { taskPreview } : {}), ...(emailPreview ? { emailPreview, warnings: emailPreview.warnings } : {}),
        message: assignment ? `${taskPreview ? `${taskPreview.associationSummary} ` : ''}Would assign ${assignment.resolvedUserName} (${assignment.candidateCount} eligible). ${assignment.reason}.${assignment.workload !== undefined ? ` Active workload: ${assignment.workload}${assignment.capacityLimit !== undefined ? ` / ${assignment.capacityLimit}` : ''}.` : ''} No records or assignment state changed.` : targets ? (targets.length ? `${targets.length} matching Deal(s): ${targets.join(', ')}. No changes made.` : 'No matching Deals. This action will be a no-op.')
          : action.type === 'send_email' ? 'Recipient, sender permissions, mailbox ownership and projected assignment are valid. No email sent.' : preparedSms ? `SMS recipient ${preparedSms.phone} and personalized content are valid (${preparedSms.stats.characters} characters, ${preparedSms.stats.segments} segment(s)). No SMS sent.` : 'Configuration and references valid. No changes made.' };
      // Project validated earlier actions into this in-memory sample only.
      if (action.type === 'assign_owner') projectWorkflowFields(trigger.entity, context, { assignedUserId: assignment!.resolvedUserId }, projection);
      if (action.type === 'create_task' && assignment) {
        const key = `task:${assignment.resolvedUserId}`;
        previewLoads.set(key, (previewLoads.get(key) ?? 0) + 1);
      }
      if (action.type === 'update_field') {
        const patch = await fieldUpdatePatch(action, trigger.entity, tenantId);
        projectWorkflowFields(trigger.entity, context, patch, projection);
      }
      if (targets) await projectWorkflowDealMove(action, targets, tenantId, trigger.entity, context, projection);
      actions.push(ready);
    }
    catch (error) { actions.push({ type: action.type, valid: false, status: 'failed', message: safeWorkflowError(error) }); stoppedReason = 'An earlier action needs attention. Later actions would be skipped.'; }
  }
  await validateConditionReferences(draft, tenantId);
  const rules = draft.conditions?.conditions ?? [];
  return { trigger: { type: draft.trigger, matched: !triggerReason, requiresEvent: !draft.trigger.endsWith('.created'),
    ...(stageHistoryId ? { stageHistoryId, eventId } : {}), ...(triggerReason ? { reason: triggerReason } : {}) }, conditions: { total: rules.length,
    passed: rules.filter(rule => evaluateRule(rule, conditionContext)).length, matched: conditionsMatch },
    actions, valid: !definitionIssues.length && !transitionIssue && !triggerReason && draft.actions.some(action => action.enabled !== false) && actions.every(action => action.valid) };
}

export async function validateDraft(tenantId: string, userId: string, input: unknown) {
  requireScope(tenantId);
  const parsed = WorkflowValidationSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Review the workflow.');
  const { workflowId, ...draft } = parsed.data;
  const existing = workflowId ? await getWorkflowById(workflowId, tenantId) : null;
  if (workflowId && (!existing || existing.isArchived)) throw new NotFoundError('Workflow');
  await assertAssignmentReferencePermissions(draft, tenantId, userId);
  await validateWorkflow(draft, tenantId, existing && existing.status !== 'DRAFT' ? existing.conditions : undefined);
  await assertWorkflowPermissions(draft, tenantId, userId, 'workflows.execute');
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
  const copy = await repo.createWorkflow(tenantId, sanitizeDraft(draft), undefined, userId);
  await writeAuditLog({ tenantId, userId, action: 'workflow.duplicated', entityType: 'Workflow', entityId: copy.id, metadata: { sourceId: id } });
  return copy;
}


function workingCopyResponse(workflow: Awaited<ReturnType<typeof repo.findWorkflowById>>) {
  if (!workflow) throw new NotFoundError('Workflow');
  const definition = WorkflowDraftSchema.safeParse(workflow.draftDefinition);
  return { ...workflow, ...(definition.success ? definition.data : {}), isActive: workflow.isActive, status: workflow.status, draftDefinition: definition.success ? definition.data : null };
}
export async function saveWorkflowDraft(id: string, tenantId: string, userId: string, input: unknown) {
  requireScope(tenantId);
  const { draft, expectedDraftRevision, expectedVersion } = WorkflowRevisionWriteSchema.parse(input);
  const existing = await getWorkflowById(id, tenantId);
  if (existing.isArchived) throw new ValidationError('Archived workflows cannot be edited.');
  if (!findTrigger(draft.trigger)) throw new ValidationError('Choose a supported trigger.');
  await assertAssignmentReferencePermissions(draft, tenantId, userId);
  // Drafts may retain incomplete setup, but cannot introduce a protected role target.
  const roleIds = draft.actions.flatMap(action => {
    if (!['create_task', 'assign_owner'].includes(action.type)) return [];
    const target = WorkflowAssignmentTargetSchema.safeParse(workflowAssignmentTarget(action));
    return target.success && target.data.type === 'role' ? [target.data.id] : [];
  });
  if (roleIds.length && await prisma.roleDefinition.findFirst({ where: { tenantId, id: { in: roleIds }, name: Role.CLIENT_ADMIN }, select: { id: true } })) {
    throw new ValidationError('Client Admin cannot be assigned by workflows. Choose another role.');
  }
  const sanitized = sanitizeDraft({ ...draft, isActive: false }, existing.conditions);
  return prisma.$transaction(async tx => {
    const changed = await tx.workflow.updateMany({ where: { id, ...await creatorWhere(tenantId, tx, 'Workflow'), isArchived: false, draftRevision: expectedDraftRevision, version: expectedVersion },
      data: { draftDefinition: sanitized as unknown as Prisma.InputJsonValue, draftRevision: { increment: 1 } } });
    if (!changed.count) throw new ConflictError('This workflow changed in another editor. Reload before saving your draft.');
    await tx.auditLog.create({ data: { tenantId, userId, action: 'workflow.draft_saved', entityType: 'Workflow', entityId: id } });
    return workingCopyResponse(await tx.workflow.findFirst({ where: { id, tenantId } }));
  });
}
export async function publishWorkflowDraft(id: string, tenantId: string, userId: string, input: unknown) {
  requireScope(tenantId);
  const { draft, expectedDraftRevision, expectedVersion } = WorkflowRevisionWriteSchema.parse(input);
  const existing = await getWorkflowById(id, tenantId);
  if (existing.isArchived) throw new ValidationError('Archived workflows cannot be published.');
  const active = sanitizeDraft({ ...draft, isActive: true }, existing.conditions);
  if (!(await getWorkflowNameAvailability(tenantId, active.name, id)).available) throw new ConflictError('A workflow with this name already exists.');
  if ((await accountWorkflowRetirementReferences(active, tenantId)).length || retiredContactReferences([active.conditions, active.actions], findTrigger(active.trigger)?.entity).length) throw new ValidationError('Repair retired workflow references before publishing.');
  await assertAssignmentReferencePermissions(active, tenantId, userId);
  await validateWorkflow(active, tenantId, existing.conditions);
  await assertWorkflowPermissions(active, tenantId, userId);
  return prisma.$transaction(async tx => {
    const published = await tx.workflowPublication.findFirst({ where: { workflowId: id, tenantId }, select: { id: true } });
    const version = published ? expectedVersion + 1 : expectedVersion;
    const changed = await tx.workflow.updateMany({ where: { id, ...await creatorWhere(tenantId, tx, 'Workflow'), isArchived: false, version: expectedVersion, draftRevision: expectedDraftRevision },
      data: { name: active.name, description: active.description ?? null, trigger: active.trigger, conditions: active.conditions == null ? Prisma.DbNull : active.conditions as unknown as Prisma.InputJsonValue,
        actions: active.actions as unknown as Prisma.InputJsonValue, isActive: true, status: 'ACTIVE', activatedById: userId, version,
        draftDefinition: Prisma.DbNull, draftRevision: { increment: 1 } } });
    if (!changed.count) throw new ConflictError('This workflow changed in another editor. Reload before publishing.');
    await tx.workflowPublication.create({ data: { tenantId, workflowId: id, version, definition: active as unknown as Prisma.InputJsonValue, activatedById: userId } });
    await tx.auditLog.create({ data: { tenantId, userId, action: 'workflow.published', entityType: 'Workflow', entityId: id, changeset: { after: { version } } } });
    return workingCopyResponse(await tx.workflow.findFirst({ where: { id, tenantId } }));
  }, { isolationLevel: 'Serializable' }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictError('This workflow changed in another editor. Reload before publishing.');
    throw error;
  });
}
export async function workflowPublications(id: string, tenantId: string) {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  return prisma.workflowPublication.findMany({ where: { tenantId, workflowId: id }, orderBy: { version: 'desc' }, select: { version: true, createdAt: true, activatedById: true, definition: true } });
}
export async function restoreWorkflowPublication(id: string, tenantId: string, userId: string, version: unknown, input: unknown) {
  requireScope(tenantId);
  await getWorkflowById(id, tenantId);
  const target = z.coerce.number().int().min(1).parse(version), tokens = WorkflowRevisionTokenSchema.parse(input);
  const revision = await prisma.workflowPublication.findFirst({ where: { tenantId, workflowId: id, version: target } });
  if (!revision) throw new NotFoundError('Published workflow version');
  return saveWorkflowDraft(id, tenantId, userId, { ...tokens, draft: WorkflowDraftSchema.parse(revision.definition) });
}

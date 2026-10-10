import { compatibleWorkflow, supportedChangedFields } from './workflow-fields';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WorkflowDraftSchema, CRM_STATUSES, type WorkflowDraft } from '@leadcrm/shared';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import * as repo from './workflows.repository';
import { findTrigger } from '../triggers/trigger-catalog';
import { evaluateCondition } from './workflow-conditions';
import { dispatchAction, safeWorkflowError } from '../actions/action-dispatcher';
import { assertWorkflowPermissions } from '../actions/action-permissions';
import { validateWorkflow } from './workflow-validation';
export { evaluateCondition } from './workflow-conditions';

const chain = new AsyncLocalStorage<ReadonlySet<string>>();
export interface WorkflowFireParams {
  triggerType: string; entityType: string; entityId: string; tenantId: string;
  actorId?: string; eventId?: string; context: Record<string, unknown>;
}
export async function fireWorkflowTrigger(params: WorkflowFireParams): Promise<void> {
  const scope = tenantContext.getStore();
  if (!scope || scope.tenantId !== params.tenantId) throw new ValidationError('A matching CRM tenant context is required for automation.');
  const trigger = findTrigger(params.triggerType);
  if (!trigger) throw new ValidationError('Unsupported workflow trigger.');
  if (trigger.entity !== params.entityType) throw new ValidationError('Trigger record type does not match.');
  if (params.triggerType.endsWith('.updated')) {
    const fields = await supportedChangedFields(trigger.entity, params.context['event.changedFields'], params.tenantId);
    if (!fields.length) return;
    params = { ...params, context: { ...params.context, 'event.changedFields': fields } };
  }
  if (['deal.stage_changed', 'deal.closed_won', 'deal.closed_lost'].includes(params.triggerType) &&
    (typeof params.context['event.previousStageId'] !== 'string' || typeof params.context['event.newStageId'] !== 'string' || params.context['event.previousStageId'] === params.context['event.newStageId'])) return;
  const context = await repo.entityContext(trigger.entity, params.entityId, params.tenantId);
  if (!context) throw new NotFoundError('Triggering record');
  // Only event metadata is accepted from emitters; saved record values remain authoritative.
  for (const key of ['event.previousStageId', 'event.newStageId', 'event.previousStatus', 'event.newStatus', 'event.changedFields']) if (key in params.context) context[key] = params.context[key];
  if (context['event.newStageId'] && context['event.newStageId'] !== context['deal.stageId']) return;
  if (params.triggerType.endsWith('.status_changed')) {
    const previous = params.context['event.previousStatus'], next = params.context['event.newStatus'];
    if (!CRM_STATUSES.includes(previous as never) || !CRM_STATUSES.includes(next as never) || previous === next || next !== context[trigger.entity + '.status']) return;
  }
  const eventId = params.eventId ?? (params.triggerType.endsWith('.created') ? `${params.triggerType}:${params.entityId}` : undefined);
  if (!eventId || eventId.length > 500) throw new ValidationError('A stable event identifier is required for automation.');
  const actorId = params.actorId;
  const actorAvailable = !!actorId && !!await repo.findActor(actorId, params.tenantId);
  const visited = chain.getStore() ?? new Set<string>();
  if (visited.size >= 10) return;
  const workflows = await repo.activeWorkflows(params.tenantId, params.triggerType);
  for (const workflow of workflows) {
    if (visited.has(workflow.id)) continue;
    await chain.run(new Set([...visited, workflow.id]), async () => {
      const run = await repo.startRun({ tenantId: params.tenantId, workflowId: workflow.id, triggerType: params.triggerType,
        workflowVersion: workflow.version, definitionSnapshot: { name: workflow.name, description: workflow.description, trigger: workflow.trigger,
          conditions: workflow.conditions, actions: workflow.actions, isActive: workflow.isActive },
        entityType: trigger.entity, entityId: params.entityId, eventId, recordName: String(context[`${trigger.entity}.title`] ?? context[`${trigger.entity}.name`] ?? `${context[`${trigger.entity}.firstName`] ?? ''} ${context[`${trigger.entity}.lastName`] ?? ''}`).trim().slice(0, 255) });
      if (!run) return;
      let status = 'completed';
      let errorMessage: string | undefined;
      let recordedSteps = 0;
      let pendingStepId: string | undefined;
      try {
        if (!actorAvailable) throw new ValidationError('Workflow dispatch skipped: no active, authorized event actor.');
        const parsed = WorkflowDraftSchema.safeParse(await compatibleWorkflow({ name: workflow.name, description: workflow.description, trigger: workflow.trigger,
          conditions: workflow.conditions, actions: workflow.actions, isActive: workflow.isActive }, params.tenantId));
        if (!parsed.success) throw new ValidationError('This workflow uses an invalid configuration. Edit and save it before activating.');
        const draft: WorkflowDraft = parsed.data;
        await validateWorkflow(draft, params.tenantId, workflow.conditions);
        if (!workflow.activatedById) throw new ValidationError('Reactivate this workflow to confirm its author permissions.');
        await assertWorkflowPermissions(draft, params.tenantId, workflow.activatedById);
        if (draft.conditions && !evaluateCondition(draft.conditions, context)) status = 'skipped';
        if (params.triggerType === 'deal.stage_changed' && context['deal.isQualified'] === true &&
          (context['deal.hasEverBeenWon'] !== false || context['deal.wonHistoryVerified'] !== true)) {
          status = 'skipped';
          errorMessage = context['deal.hasEverBeenWon'] ? 'This deal previously reached Won.' : 'This deal’s earlier stage history needs verification.';
        }
        for (let index = 0; index < draft.actions.length; index++) {
          const action = draft.actions[index];
          const current = await repo.findWorkflowById(workflow.id, params.tenantId);
          if (!current?.isActive || current.status !== 'ACTIVE' || current.isArchived || current.updatedAt.getTime() !== workflow.updatedAt.getTime()) status = status === 'failed' ? status : 'skipped';
          const freshContext = await repo.entityContext(trigger.entity, params.entityId, params.tenantId);
          // A stage follow-up belongs to this entry into the stage. Do not continue after moving away.
          if (status !== 'failed' && params.triggerType === 'deal.stage_changed' && (!freshContext || freshContext['deal.stageId'] !== context['event.newStageId'])) status = 'skipped';
          if (status !== 'failed' && freshContext && draft.conditions?.conditions.some(rule => rule.field === 'deal.hasEverBeenWon' && rule.value === false) &&
            (freshContext['deal.hasEverBeenWon'] !== false || freshContext['deal.wonHistoryVerified'] !== true)) status = 'skipped';
          if (status !== 'completed' || action.enabled === false) {
            await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action.type, status: 'skipped',
              ...(action.enabled === false ? { output: { reason: 'Action disabled' } } : {}) });
            recordedSteps++;
            continue;
          }
          await assertWorkflowPermissions(draft, params.tenantId, workflow.activatedById);
          const step = await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action.type, status: 'running' });
          pendingStepId = step.id;
          const result = freshContext ? await dispatchAction(action, freshContext, params.tenantId, workflow.activatedById, { workflowId: workflow.id, actionIndex: index })
            : { success: false, error: 'The triggering record is no longer available.' };
          await repo.finishExecutionStep(step.id, params.tenantId, { status: result.success ? 'success' : 'failed', output: result.output, error: result.error });
          pendingStepId = undefined;
          recordedSteps++;
          if (!result.success) { status = 'failed'; errorMessage = result.error; }
        }
      } catch (error) {
        status = 'failed'; errorMessage = safeWorkflowError(error);
        if (pendingStepId) await repo.finishExecutionStep(pendingStepId, params.tenantId, { status: 'failed', error: 'Action outcome requires review. Check CRM records and delivery history before any replay.' });
        else if (!recordedSteps) await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id,
          stepIndex: -1, actionType: 'validation', status: 'failed', error: errorMessage });
        const actions = Array.isArray(workflow.actions) ? workflow.actions : [];
        for (let index = recordedSteps + (pendingStepId ? 1 : 0); index < actions.length; index++) {
          const action = actions[index] as { type?: string };
          await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action?.type ?? 'unknown', status: 'skipped' });
        }
      }
      await repo.updateExecutionRun(run.id, params.tenantId, { status, errorMessage, completedAt: new Date() });
      console.info('[Workflow]', { workflowId: workflow.id, executionId: run.id, trigger: params.triggerType, status, durationMs: Date.now() - run.startedAt.getTime() });
      if (actorAvailable) await repo.recordRunActivity(params.tenantId, actorId!, trigger.entity, params.entityId, workflow.id, run.id, workflow.name, status);
    });
  }
}

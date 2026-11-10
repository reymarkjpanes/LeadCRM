import { compatibleWorkflow, supportedChangedFields, accountWorkflowRetirementReferences } from './workflow-fields';
import { runAuthorizedWorkflow, assertCrmRecordRead, lockWorkflowCrmRecord } from '../../crm/access/crm-record-access.service';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma, Workflow, WorkflowExecutionRun } from '@prisma/client';
import prisma from '../../../config/database.config';
import { workflowChain as chain, workflowLease } from './workflow-dispatch-context';
import { fenceWorkflowLease, isWorkflowLeaseLost, workflowLeaseWrite } from './workflow-lease';
import { interruptWorkflowEvidence } from './workflow-interruption';
import { WorkflowDraftSchema, WorkflowActionSchema, normalizeSavedWorkflowAssignment, parseStoredCrmStatus, WORKFLOW_MODULES, ACCOUNT_RETIREMENT_REASON, workflowActionPolicyIssues, type WorkflowDraft } from '@leadcrm/shared';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import * as repo from './workflows.repository';
import { findTrigger } from '../triggers/trigger-catalog';
import { evaluateCondition } from './workflow-conditions';
import { dispatchAction, safeWorkflowError, type ActionResult } from '../actions/action-dispatcher';
import { isStageEvent, workflowStageEvent, assertCurrentStageEntry, isSupersededStageEntry, claimStageActions } from './workflow-stage-entry';
import { assertWorkflowPermissions } from '../actions/action-permissions';
import { validateConditionReferences, validateWorkflow } from './workflow-validation';
import { assertWorkflowActionAdmission, isWorkflowAdmissionSkipped } from './workflow-admission';
import { isStaleWorkflowAction, readWorkflowDealStage, skipStaleWorkflowAction, workflowWriteFields, type WorkflowActionGuard, type WorkflowFreshnessEvidence } from './workflow-freshness';
export { evaluateCondition } from './workflow-conditions';

export interface WorkflowFireParams {
  triggerType: string; entityType: string; entityId: string; tenantId: string;
  actorId?: string; eventId?: string; context: Record<string, unknown>;
}
type PreparedWorkflow = { workflow: Workflow; run: WorkflowExecutionRun; leaseId: string; eventContext?: Record<string, unknown>; freshness?: WorkflowFreshnessEvidence };
export function fireWorkflowTrigger(params: WorkflowFireParams, prepared?: PreparedWorkflow): Promise<void> {
  return prepared ? workflowLease.run({ tenantId: params.tenantId, executionId: prepared.run.id, leaseId: prepared.leaseId }, () => executeWorkflowTrigger(params, prepared))
    : executeWorkflowTrigger(params);
}
async function executeWorkflowTrigger(params: WorkflowFireParams, prepared?: PreparedWorkflow): Promise<void> {
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
  const currentContext = await repo.entityContext(trigger.entity, params.entityId, params.tenantId);
  if (!currentContext && !prepared) throw new NotFoundError('Triggering record');
  const context = { ...(prepared?.eventContext ?? currentContext ?? { [`${trigger.entity}.id`]: params.entityId }) };
  // Only event metadata is accepted from emitters; saved record values remain authoritative.
  for (const key of ['event.previousStageId', 'event.newStageId', 'event.stageHistoryId', 'event.previousStatus', 'event.newStatus', 'event.changedFields', 'event.originDealId', 'event.continuationSourceId', 'event.continuationUpdateId']) if (key in params.context) context[key] = params.context[key];
  if (params.triggerType.endsWith('.status_changed')) {
    const previous = parseStoredCrmStatus(params.context['event.previousStatus']), next = parseStoredCrmStatus(params.context['event.newStatus']);
    context['event.previousStatus'] = previous; context['event.newStatus'] = next;
    if (!previous || !next || previous === next || !prepared && next !== currentContext?.[trigger.entity + '.status']) return;
  }
  const eventId = params.eventId ?? (params.triggerType.endsWith('.created') ? `${params.triggerType}:${params.entityId}` : undefined);
  if (!eventId || eventId.length > 500) throw new ValidationError('A stable event identifier is required for automation.');
  const actorId = params.actorId;
  const actorAvailable = !!actorId && !!await repo.findActor(actorId, params.tenantId);
  const visited = chain.getStore() ?? new Set<string>();
  if (visited.size >= 10) return;
  const workflows = prepared ? [prepared.workflow] : await repo.activeWorkflows(params.tenantId, params.triggerType);
  for (const workflow of workflows) {
    if (visited.has(workflow.id)) continue;
    if ((await accountWorkflowRetirementReferences(workflow, params.tenantId)).length) {
      await prisma.workflow.updateMany({ where: { id: workflow.id, tenantId: params.tenantId, version: workflow.version, isActive: true }, data: { isActive: false, status: 'PAUSED', version: { increment: 1 } } });
      if (prepared) await repo.updateExecutionRun(prepared.run.id, params.tenantId, { status: 'skipped', completedAt: new Date(), errorMessage: ACCOUNT_RETIREMENT_REASON });
      continue;
    }
    await chain.run(new Set([...visited, workflow.id]), async () => {
      const actions = Array.isArray(workflow.actions) ? workflow.actions.map(action => {
        const parsed = WorkflowActionSchema.safeParse(action);
        return parsed.success ? normalizeSavedWorkflowAssignment(parsed.data) as Prisma.JsonObject : action;
      }) : workflow.actions;
      const run = prepared?.run ?? await repo.startRun({ tenantId: params.tenantId, workflowId: workflow.id, triggerType: params.triggerType,
        workflowVersion: workflow.version, definitionSnapshot: { name: workflow.name, description: workflow.description, trigger: workflow.trigger,
          conditions: workflow.conditions, actions, isActive: workflow.isActive },
        entityType: trigger.entity, entityId: params.entityId, eventId, recordName: String(context[`${trigger.entity}.title`] ?? context[`${trigger.entity}.name`] ?? `${context[`${trigger.entity}.firstName`] ?? ''} ${context[`${trigger.entity}.lastName`] ?? ''}`).trim().slice(0, 255) });
      if (!run) return;
      let status = 'completed';
      let errorMessage: string | undefined;
      let recordedSteps = 0;
      let pendingStepId: string | undefined;
      let predicateBaseline: Record<string, unknown> | undefined;
      const expectedWrites = { ...context };
      const relatedStages = new Map((prepared?.freshness?.relatedStages ?? []).map(deal => [deal.id, deal]));
      const stageHistoryId = isStageEvent(params.triggerType)
        ? String(context['event.stageHistoryId'] ?? (eventId.startsWith(`${params.triggerType}:`) ? eventId.slice(params.triggerType.length + 1) : '')) : undefined;
      try {
        // The read adapter may attach repair metadata; it is not a definition field.
        const parsed = WorkflowDraftSchema.strip().safeParse(await compatibleWorkflow({ name: workflow.name, description: workflow.description, trigger: workflow.trigger,
          conditions: workflow.conditions, actions: workflow.actions, isActive: workflow.isActive }, params.tenantId));
        if (!parsed.success) throw new ValidationError('This workflow uses an invalid configuration. Edit and save it before activating.');
        const draft: WorkflowDraft = parsed.data;
        const policyIssues = workflowActionPolicyIssues(draft);
        if (policyIssues.length) {
          await prisma.workflow.updateMany({ where: { id: workflow.id, tenantId: params.tenantId, version: workflow.version, isActive: true }, data: { isActive: false, status: 'PAUSED' } });
          throw new ValidationError(`${policyIssues[0]} This workflow was paused for repair; no actions were performed.`);
        }
        if (stageHistoryId !== undefined) {
          const recorded = await workflowStageEvent(params.tenantId, params.entityId, params.triggerType, stageHistoryId);
          const continuation = context['event.continuationSourceId'];
          const expectedEventId = continuation ? `${recorded.eventId}:updated:${context['event.continuationUpdateId']}` : recorded.eventId;
          if (expectedEventId !== eventId || continuation && !prepared) throw new ValidationError('The workflow event identifier does not match its recorded stage transition.');
          Object.assign(context, recorded.context);
          try { await assertCurrentStageEntry(params.tenantId, params.entityId, stageHistoryId); }
          catch (error) { if (!isSupersededStageEntry(error)) throw error; status = 'skipped'; errorMessage = error.message; }
        }
        await validateConditionReferences(draft, params.tenantId);
        if (status === 'completed' && draft.conditions && !evaluateCondition(draft.conditions, context)) {
          status = 'skipped';
          errorMessage = 'Workflow conditions did not match the triggering event.';
        }
        if (status === 'completed') {
          if (!actorAvailable) throw new ValidationError('Workflow dispatch skipped: no active, authorized event actor.');
          await validateWorkflow(draft, params.tenantId, workflow.conditions);
          if (!workflow.activatedById) throw new ValidationError('Reactivate this workflow to confirm its author permissions.');
          await assertWorkflowPermissions(draft, params.tenantId, workflow.activatedById);
        }
        const module = WORKFLOW_MODULES[trigger.entity];
        const admission = { id: workflow.id, tenantId: params.tenantId, ...(context['event.continuationSourceId'] ? { version: workflow.version } : {}) };
        const event = Object.fromEntries(Object.entries(context).filter(([key]) => key.startsWith('event.')));
        const predicateKeys = new Set(draft.conditions?.conditions.map(rule => rule.field) ?? []);
        if (predicateKeys.has('deal.hasEverBeenWon')) predicateKeys.add('deal.wonHistoryVerified');
        const checkSource = async (fresh: Record<string, unknown>, tx: Prisma.TransactionClient, baseline = predicateBaseline,
          ownChanges?: Record<string, unknown>) => {
          if (stageHistoryId) await assertCurrentStageEntry(params.tenantId, params.entityId, String(expectedWrites['internal.stageHistoryId'] ?? stageHistoryId), tx);
          if (params.triggerType.endsWith('.status_changed')) {
            const key = `${trigger.entity}.status`;
            const expected = { ...expectedWrites, ...ownChanges };
            if (fresh[key] !== (baseline ? expected[key] : event['event.newStatus']) ||
                'internal.statusChangedAt' in expected && fresh['internal.statusChangedAt'] !== expected['internal.statusChangedAt']) {
              skipStaleWorkflowAction('A newer status transition superseded this workflow event.');
            }
          }
          if (params.triggerType === 'deal.stage_changed' && !predicateBaseline && fresh['deal.isQualified'] === true &&
              (fresh['deal.hasEverBeenWon'] !== false || fresh['deal.wonHistoryVerified'] !== true)) {
            skipStaleWorkflowAction(fresh['deal.hasEverBeenWon'] ? 'This deal previously reached Won.' : 'This deal’s earlier stage history needs verification.');
          }
          const expectedPredicates = baseline && { ...baseline, ...ownChanges };
          if (draft.conditions && (!expectedPredicates || [...predicateKeys].some(key => !isDeepStrictEqual(expectedPredicates[key], fresh[key]))) &&
              !evaluateCondition(draft.conditions, fresh)) skipStaleWorkflowAction('Current record values no longer match the workflow conditions.');
        };
        const readSource = async (tx: Prisma.TransactionClient) => {
          await assertCrmRecordRead(tx, module, params.entityId);
          const source = await repo.entityContext(trigger.entity, params.entityId, params.tenantId, tx);
          return source ? { ...source, ...event } : skipStaleWorkflowAction('The triggering record is no longer available.');
        };
        for (let index = 0; index < draft.actions.length; index++) {
          await fenceWorkflowLease();
          const action = draft.actions[index];
          if (status !== 'completed' || action.enabled === false) {
            await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action.type, status: 'skipped',
              output: { reason: action.enabled === false ? 'Action disabled' : errorMessage ?? 'Earlier action stopped execution.' } });
            recordedSteps++;
            continue;
          }
          let freshContext: Record<string, unknown>;
          try {
            await workflowLeaseWrite(tx => assertWorkflowActionAdmission(tx, admission));
            if (!currentContext) skipStaleWorkflowAction('The triggering record is no longer available.');
            freshContext = await runAuthorizedWorkflow(params.tenantId, run.id, () => readSource(prisma), workflow.activatedById!);
            await checkSource(freshContext, prisma);
          } catch (error) {
            if (!isWorkflowAdmissionSkipped(error) && !isStaleWorkflowAction(error) && !isSupersededStageEntry(error)) throw error;
            status = 'skipped'; errorMessage = error.message;
            await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action.type, status: 'skipped', output: { reason: errorMessage } });
            recordedSteps++; continue;
          }
          await assertWorkflowPermissions(draft, params.tenantId, workflow.activatedById!);
          let admittedSource = freshContext;
          const guard: WorkflowActionGuard = {
            admit: async (tx, options) => {
              if (!await lockWorkflowCrmRecord(tx, module, params.tenantId, params.entityId)) skipStaleWorkflowAction('The triggering record is no longer available.');
              const fresh = await readSource(tx);
              const afterOwnWrite = options?.ownChanges && Object.keys(options.ownChanges).length > 0;
              await checkSource(fresh, tx, afterOwnWrite ? admittedSource : predicateBaseline, options?.ownChanges);
              const fields = workflowWriteFields(action, trigger.entity);
              if (fields.some(key => !isDeepStrictEqual(fresh[key], Object.prototype.hasOwnProperty.call(expectedWrites, key) ? expectedWrites[key] : freshContext[key]))) {
                skipStaleWorkflowAction('A newer change to the action target was preserved.');
              }
              if (options?.preparedInput && Object.keys(freshContext).some(key => !isDeepStrictEqual(freshContext[key], fresh[key]))) {
                skipStaleWorkflowAction('The record changed while preparing the action.');
              }
              if (options?.dealId) {
                const direct = trigger.entity === 'deal';
                if (!direct && !await lockWorkflowCrmRecord(tx, 'deals', params.tenantId, options.dealId)) skipStaleWorkflowAction('The target Deal is no longer available.');
                const target = await readWorkflowDealStage(tx, params.tenantId, options.dealId);
                const expected = direct ? { id: params.entityId, stageId: expectedWrites['deal.stageId'], pipelineId: expectedWrites['deal.pipelineId'],
                  currentStageHistoryId: Object.prototype.hasOwnProperty.call(expectedWrites, 'internal.stageHistoryId') ? expectedWrites['internal.stageHistoryId'] : freshContext['internal.stageHistoryId'] }
                  : relatedStages.get(options.dealId);
                if (!target || expected && (target.stageId !== expected.stageId || target.pipelineId !== expected.pipelineId || target.currentStageHistoryId !== expected.currentStageHistoryId) ||
                    !expected && (prepared?.freshness?.relatedStages !== undefined || prepared && target.stageChangedAt && target.stageChangedAt > run.startedAt)) {
                  skipStaleWorkflowAction('A newer stage or pipeline change to the target Deal was preserved.');
                }
              }
              await assertWorkflowActionAdmission(tx, admission);
              if (stageHistoryId && !await claimStageActions(tx, params.tenantId, workflow.id, stageHistoryId, params.triggerType, run.id,
                typeof context['event.continuationSourceId'] === 'string' ? context['event.continuationSourceId'] : undefined,
                typeof context['event.continuationUpdateId'] === 'string' ? context['event.continuationUpdateId'] : undefined)) {
                skipStaleWorkflowAction('Actions already started for this stage entry.');
              }
              admittedSource = fresh;
              return fresh;
            },
            changes: async (tx, before) => {
              const after = await repo.entityContext(trigger.entity, params.entityId, params.tenantId, tx);
              return Object.fromEntries(Object.entries(after ?? {}).filter(([key, value]) => !isDeepStrictEqual(before[key], value)));
            },
          };
          const step = await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action.type, status: 'running' });
          pendingStepId = step.id;
          await workflowLeaseWrite(tx => tx.workflowExecutionStep.update({ where: { id: step.id, tenantId: params.tenantId }, data: { resolvedInput: JSON.parse(JSON.stringify({ version: 1, action, context: freshContext })) } }));
          const result: ActionResult = await runAuthorizedWorkflow(params.tenantId, run.id, () => dispatchAction(action, freshContext, params.tenantId, workflow.activatedById!, { workflowId: workflow.id, actionIndex: index, stepId: step.id, guard }), workflow.activatedById!);
          if (result.success) {
            predicateBaseline = { ...admittedSource, ...result.sourceChanges };
            Object.assign(expectedWrites, result.sourceChanges);
            for (const target of result.movedStages ?? []) relatedStages.set(target.id, target);
          }
          await repo.finishExecutionStep(step.id, params.tenantId, { status: result.success ? 'success' : result.skipped ? 'skipped' : 'failed', output: result.output, error: result.error });
          pendingStepId = undefined;
          recordedSteps++;
          if (!result.success) { status = result.skipped ? 'skipped' : result.output?.outcomeUnknown ? 'interrupted' : 'failed'; errorMessage = result.error ?? (typeof result.output?.reason === 'string' ? result.output.reason : undefined); }
        }
      } catch (error) {
        if (isWorkflowLeaseLost(error)) return; // The recovery worker owns the interrupted outcome.
        status = pendingStepId ? 'interrupted' : 'failed'; errorMessage = safeWorkflowError(error);
        if (pendingStepId) await repo.finishExecutionStep(pendingStepId, params.tenantId, { status: 'failed', error: 'Action outcome requires review. Check CRM records and delivery history before any replay.' });
        else if (!recordedSteps) await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id,
          stepIndex: -1, actionType: 'validation', status: 'failed', error: errorMessage });
        const actions = Array.isArray(workflow.actions) ? workflow.actions : [];
        for (let index = recordedSteps + (pendingStepId ? 1 : 0); index < actions.length; index++) {
          const action = actions[index] as { type?: string };
          await repo.createExecutionStep({ tenantId: params.tenantId, executionId: run.id, stepIndex: index, actionType: action?.type ?? 'unknown', status: 'skipped' });
        }
      }
      if (prepared) {
        try {
          await workflowLeaseWrite(async tx => {
            if (status === 'interrupted') await interruptWorkflowEvidence(tx, run);
            const completed = await tx.workflowExecutionRun.updateMany({ where: { id: run.id, tenantId: params.tenantId, status: 'running', leaseId: prepared.leaseId, leaseUntil: { gt: new Date() } }, data: { status, errorMessage, completedAt: new Date() } });
            if (!completed.count) return;
            if (actorAvailable) await repo.recordRunActivity(params.tenantId, actorId!, trigger.entity, params.entityId, workflow.id, run.id, workflow.name, status, tx);
          });
        } catch (error) { if (isWorkflowLeaseLost(error)) return; throw error; }
      } else {
        await repo.updateExecutionRun(run.id, params.tenantId, { status, errorMessage, completedAt: new Date() });
        if (actorAvailable) await repo.recordRunActivity(params.tenantId, actorId!, trigger.entity, params.entityId, workflow.id, run.id, workflow.name, status);
      }
      console.info('[Workflow]', { workflowId: workflow.id, executionId: run.id, trigger: params.triggerType, status, durationMs: Date.now() - run.startedAt.getTime() });
    });
  }
}

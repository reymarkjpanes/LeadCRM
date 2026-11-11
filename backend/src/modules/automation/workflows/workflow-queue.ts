import { randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { accountWorkflowRetirementReferences, compatibleWorkflow } from './workflow-fields';
import { ACCOUNT_RETIREMENT_REASON, WorkflowConditionSchema, WorkflowDraftSchema, workflowDefinitionIssues } from '@leadcrm/shared';
import { Prisma, type Workflow } from '@prisma/client';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { workflowChain } from './workflow-dispatch-context';
import type { WorkflowFireParams } from './workflow.engine';
import { findTrigger } from '../triggers/trigger-catalog';
import { ValidationError } from '../../../shared/errors/http-error';
import { entityContext } from './workflows.repository';
import { workflowStageEvent } from './workflow-stage-entry';
import { evaluateCondition } from './workflow-conditions';
import { interruptWorkflowRun } from './workflow-interruption';
import { markWorkflowQueued, registerWorkflowWake } from '../../crm/leads/sales-context';
import { assertWorkflowActionAdmission, isWorkflowAdmissionSkipped } from './workflow-admission';
import { captureWorkflowFreshness, type WorkflowFreshnessEvidence } from './workflow-freshness';
import { preparationAttempts, preparationContext, preparationFailure, preparationRetryAt, WORKFLOW_PREPARATION_ATTEMPTS } from './workflow-preparation';
import { workflowWorkerStarted, workflowWorkerDraining, workflowWorkerStopped, workflowWorkerSweep } from './workflow-worker-status';

const metadata = ['event.previousStageId', 'event.newStageId', 'event.stageHistoryId', 'event.previousStatus', 'event.newStatus', 'event.changedFields', 'event.originDealId', 'event.continuationSourceId', 'event.continuationUpdateId'];

function workflowSnapshot(workflow: Workflow) {
  const { name, description, trigger, conditions, actions, isActive } = workflow;
  return { name, description, trigger, conditions, actions, isActive };
}

async function failPreparation(tx: Prisma.TransactionClient, run: { id: string; tenantId: string }, where: Prisma.WorkflowExecutionRunWhereInput,
  errorMessage: string, dispatchContext: Prisma.InputJsonObject) {
  const failed = await tx.workflowExecutionRun.updateMany({ where, data: { status: 'failed', completedAt: new Date(), errorMessage,
    dispatchContext, leaseId: null, leaseUntil: null } });
  if (failed.count) await tx.workflowExecutionStep.createMany({ data: [{ tenantId: run.tenantId, executionId: run.id,
    stepIndex: -1, actionType: 'validation', status: 'failed', error: errorMessage }], skipDuplicates: true });
  return failed.count;
}

/** Snapshot the recipients in the source transaction. A replay never discovers new workflows. */
export async function enqueueWorkflowTrigger(tx: Prisma.TransactionClient, params: WorkflowFireParams, onlyWorkflowId?: string) {
  if (tenantContext.getStore()?.tenantId !== params.tenantId) throw new ValidationError('A matching CRM tenant context is required for automation.');
  const trigger = findTrigger(params.triggerType);
  if (!trigger || trigger.entity !== params.entityType) throw new ValidationError('Unsupported workflow trigger.');
  const eventId = params.eventId ?? (params.triggerType.endsWith('.created') ? `${params.triggerType}:${params.entityId}` : undefined);
  if (!eventId || eventId.length > 500) throw new ValidationError('A stable event identifier is required for automation.');
  const ancestry = [...(workflowChain.getStore() ?? [])];
  if (ancestry.length >= 10) return;
  const context = Object.fromEntries(Object.entries(params.context).filter(([key]) => metadata.includes(key)));
  const workflows = await tx.workflow.findMany({ where: { tenantId: params.tenantId, ...(onlyWorkflowId ? { id: onlyWorkflowId } : {}), trigger: params.triggerType, isActive: true, status: 'ACTIVE', isArchived: false }, orderBy: { id: 'asc' } });
  if (!workflows.length) return;
  const savedContext = await entityContext(trigger.entity, params.entityId, params.tenantId, tx);
  if (!savedContext) throw new ValidationError('The triggering CRM record is unavailable.');
  const eventContext = JSON.parse(JSON.stringify({ ...savedContext, ...context })) as Prisma.InputJsonObject;
  const recordName = String(eventContext[`${trigger.entity}.title`] ?? eventContext[`${trigger.entity}.name`] ??
    `${eventContext[`${trigger.entity}.firstName`] ?? ''} ${eventContext[`${trigger.entity}.lastName`] ?? ''}`).trim().slice(0, 255);
  for (const workflow of workflows) {
    if ((await accountWorkflowRetirementReferences(workflow, params.tenantId, tx)).length) {
      await tx.workflow.updateMany({ where: { id: workflow.id, tenantId: params.tenantId, version: workflow.version, isActive: true, isArchived: false },
        data: { isActive: false, status: 'PAUSED', version: { increment: 1 } } });
      continue;
    }
    if (ancestry.includes(workflow.id)) continue;
    const triggerId = randomUUID();
    // PostgreSQL uniqueness errors abort transactions: use ON CONFLICT, never catch-and-continue.
    const inserted = await tx.workflowTriggerRecord.createMany({ data: [{ id: triggerId, tenantId: params.tenantId, workflowId: workflow.id, triggerType: params.triggerType, entityType: params.entityType, entityId: params.entityId, eventId, payload: { queueVersion: 1, recordName } }], skipDuplicates: true });
    if (!inserted.count) continue;
    const freshness = await captureWorkflowFreshness(tx, params, workflow, eventContext);
    await tx.workflowExecutionRun.create({ data: { tenantId: params.tenantId, workflowId: workflow.id, triggerId, entityType: params.entityType, entityId: params.entityId,
      status: 'queued', workflowVersion: workflow.version,
      definitionSnapshot: workflowSnapshot(workflow),
      dispatchContext: { version: 1, actorId: params.actorId ?? null, activatedById: workflow.activatedById, ancestry, context, eventContext, freshness } as Prisma.InputJsonValue,
    } });
    markWorkflowQueued(tx);
  }
}

/** A later field save can satisfy a still-current stage entry, never a historical one. */
export async function enqueueStageConditionContinuations(tx: Prisma.TransactionClient, params: WorkflowFireParams) {
  if (params.triggerType !== 'deal.updated' || !Array.isArray(params.context['event.changedFields'])) return;
  const deal = await tx.deal.findFirst({ where: { tenantId: params.tenantId, id: params.entityId, isArchived: false, deletedAt: null }, select: { currentStageHistoryId: true } });
  if (!deal?.currentStageHistoryId) return;
  // The update emitted with this stage entry already contributed to its snapshot.
  if (params.eventId === `deal.updated:${deal.currentStageHistoryId}`) return;
  const sources = await tx.workflowTriggerRecord.findMany({ where: { tenantId: params.tenantId, entityId: params.entityId, triggerType: 'deal.stage_changed', eventId: `deal.stage_changed:${deal.currentStageHistoryId}` }, include: { workflow: true, runs: { include: { steps: true } } } });
  if (!sources.length) return;
  const recorded = await workflowStageEvent(params.tenantId, params.entityId, 'deal.stage_changed', deal.currentStageHistoryId, tx);
  let currentContext: Record<string, unknown> | undefined;
  for (const source of sources) {
    const { workflow } = source, execution = source.runs[0];
    if (!execution || !workflow.isActive || workflow.status !== 'ACTIVE' || workflow.isArchived || workflow.version !== execution.workflowVersion || !['queued', 'running', 'skipped'].includes(execution.status)) continue;
    if (execution.steps.some(step => step.status !== 'skipped')) continue;
    if (source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload) && source.payload.stageActionRunId) continue;
    const draft = await compatibleWorkflow({ trigger: workflow.trigger, conditions: workflow.conditions, actions: workflow.actions }, params.tenantId, tx);
    const conditions = WorkflowConditionSchema.safeParse(draft.conditions);
    if (!conditions.success || !conditions.data.conditions.some(rule => rule.field.startsWith('deal.') && (params.context['event.changedFields'] as unknown[]).includes(rule.field.slice(5)))) continue;
    const dispatch = execution.dispatchContext as { eventContext?: Record<string, unknown> } | null;
    if (!dispatch?.eventContext || evaluateCondition(conditions.data, dispatch.eventContext)) continue;
    if (!currentContext) {
      const savedContext = await entityContext('deal', params.entityId, params.tenantId, tx);
      if (!savedContext || savedContext['internal.stageHistoryId'] !== deal.currentStageHistoryId) return;
      currentContext = { ...savedContext, ...recorded.context };
    }
    if (!evaluateCondition(conditions.data, currentContext)) continue;
    await enqueueWorkflowTrigger(tx, { ...params, triggerType: 'deal.stage_changed', eventId: `${recorded.eventId}:updated:${params.eventId}`,
      context: { ...recorded.context, 'event.continuationSourceId': source.id, 'event.continuationUpdateId': params.eventId } }, workflow.id);
  }
}

export async function dispatchQueuedWorkflows(dealStageWorkflowId?: string) {
  const now = new Date();
  let progressed = false;
  // Scope by the saved definition so an edit cannot enable additional actions
  // on the limited worker. Leave other runs for the regular worker.
  const scope: Prisma.WorkflowExecutionRunWhereInput = dealStageWorkflowId ? {
    workflowId: dealStageWorkflowId,
    entityType: 'deal',
    AND: [
      { definitionSnapshot: { path: ['trigger'], equals: 'deal.updated' } },
      { definitionSnapshot: { path: ['actions', '0', 'type'], equals: 'move_deal_stage' } },
      { definitionSnapshot: { path: ['actions', '1'], equals: Prisma.DbNull } },
    ],
  } : {};
  // Historical runs have null context and can never be mistaken for recoverable work.
  const abandonedQueued: Prisma.WorkflowExecutionRunWhereInput = { status: 'queued', dispatchStartedAt: { not: null },
    OR: [{ leaseId: null }, { leaseUntil: null }, { leaseUntil: { lte: now } }] };
  const expired = await prisma.workflowExecutionRun.findMany({ where: { ...scope, dispatchContext: { not: Prisma.DbNull }, dispatchStartedAt: { not: null },
    OR: [{ status: 'running', leaseUntil: { lt: now } }, abandonedQueued] }, select: { id: true, tenantId: true, status: true }, take: 50 });
  for (const run of expired) await tenantContext.run({ tenantId: run.tenantId }, () => prisma.$transaction(async tx => {
    await interruptWorkflowRun(tx, run, run.status === 'queued' ? abandonedQueued : { status: 'running', leaseUntil: { lt: now } }, now,
      run.status === 'queued' ? 'A queued execution already has a dispatch marker. Review CRM and delivery history; automatic replay is disabled.' : undefined);
  }));
  const due = await prisma.workflowExecutionRun.findMany({ where: { ...scope, status: 'queued', dispatchContext: { not: Prisma.DbNull }, dispatchStartedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: 10, include: { trigger: true } });
  for (const item of due) await tenantContext.run({ tenantId: item.tenantId }, async () => {
    const leaseId = randomUUID();
    const previousAttempts = preparationAttempts(item.dispatchContext);
    const attempts = Math.min(previousAttempts + 1, WORKFLOW_PREPARATION_ATTEMPTS);
    const claimedContext = preparationContext(item.dispatchContext, attempts);
    const context = item.dispatchContext as { version?: number; actorId?: string; activatedById?: string; ancestry?: string[]; context?: Record<string, unknown>; eventContext?: Record<string, unknown>; freshness?: WorkflowFreshnessEvidence };
    let claimed = false;
    try {
      // Attempt evidence and the lease commit together, including a crash before admission.
      const claim = await prisma.$transaction(async tx => {
        const changed = await tx.workflowExecutionRun.updateMany({ where: { id: item.id, tenantId: item.tenantId,
          status: 'queued', dispatchStartedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
          data: { leaseId, leaseUntil: new Date(Date.now() + 300000), dispatchContext: claimedContext } });
        if (!changed.count) return { count: 0, priorSteps: false, interrupted: false };
        // Normal queued work has no steps: admission commits its marker before any step exists.
        const priorSteps = await tx.workflowExecutionStep.count({ where: { executionId: item.id, tenantId: item.tenantId } }) > 0;
        const interrupted = priorSteps && await interruptWorkflowRun(tx, item, { leaseId, status: 'queued', dispatchStartedAt: null }, new Date(),
          'This queued execution contains prior action evidence. Review CRM and delivery history; automatic replay is disabled.');
        return { count: changed.count, priorSteps, interrupted };
      });
      if (!claim.count) return;
      claimed = true;
      if (claim.priorSteps) { if (claim.interrupted) progressed = true; return; }
      if (previousAttempts >= WORKFLOW_PREPARATION_ATTEMPTS) {
        const failed = await prisma.$transaction(tx => failPreparation(tx, item, { id: item.id, tenantId: item.tenantId, leaseId,
          status: 'queued', dispatchStartedAt: null }, 'Workflow preparation attempts were exhausted before dispatch. No actions were started.', claimedContext));
        if (failed) {
          progressed = true;
          console.info('[Workflow]', { event: 'preparation_failed', executionId: item.id, attempts, failureClass: 'ATTEMPTS_EXHAUSTED' });
        }
        return;
      }
      const workflow = await prisma.workflow.findFirst({ where: { id: item.workflowId, tenantId: item.tenantId } });
      if (workflow && (await accountWorkflowRetirementReferences(workflow, item.tenantId)).length) {
        await prisma.workflow.updateMany({ where: { id: workflow.id, tenantId: item.tenantId, version: workflow.version, isActive: true }, data: { isActive: false, status: 'PAUSED', version: { increment: 1 } } });
        await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: 'queued' }, data: { status: 'skipped', completedAt: new Date(), errorMessage: ACCOUNT_RETIREMENT_REASON, leaseId: null, leaseUntil: null } });
        progressed = true;
        return;
      }
      if (context.version !== 1 || !workflow || !workflow.isActive || workflow.isArchived || workflow.status !== 'ACTIVE') {
        await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: 'queued' }, data: { status: 'skipped', completedAt: new Date(), errorMessage: 'The saved workflow authorization or definition changed after this event.', leaseId: null, leaseUntil: null } });
        progressed = true;
        return;
      }
      const snapshot = item.definitionSnapshot && typeof item.definitionSnapshot === 'object' && !Array.isArray(item.definitionSnapshot) ? item.definitionSnapshot : null;
      if (!snapshot || !context.activatedById) throw new ValidationError('Published workflow snapshot is unavailable.');
      const captured = { ...workflow, ...snapshot, id: workflow.id, tenantId: item.tenantId, version: item.workflowVersion ?? workflow.version, activatedById: context.activatedById } as typeof workflow;
      const normalized = await compatibleWorkflow(captured, item.tenantId);
      const parsed = WorkflowDraftSchema.strip().safeParse(normalized);
      const issue = parsed.success ? workflowDefinitionIssues(parsed.data)[0] : 'This workflow uses an invalid configuration. Edit and publish it to repair it.';
      if (!parsed.success || issue) {
        const samePublication = item.workflowVersion === workflow.version && context.activatedById === workflow.activatedById &&
          isDeepStrictEqual(snapshot, workflowSnapshot(workflow));
        const failed = await prisma.$transaction(async tx => {
          const count = await failPreparation(tx, item, { id: item.id, tenantId: item.tenantId, leaseId,
            status: 'queued', dispatchStartedAt: null, leaseUntil: { gt: new Date() } }, `${issue} No actions were started.`, claimedContext);
          if (count && samePublication) {
            await tx.workflow.updateMany({ where: { id: workflow.id, tenantId: item.tenantId,
              version: workflow.version, draftRevision: workflow.draftRevision, updatedAt: workflow.updatedAt, activatedById: workflow.activatedById,
              status: 'ACTIVE', isActive: true, isArchived: false },
            data: { isActive: false, status: 'PAUSED' } });
          }
          return count;
        });
        if (failed) progressed = true;
        return;
      }
      const { fireWorkflowTrigger } = await import('./workflow.engine.js');
      const admission = await prisma.$transaction(async tx => {
        const where = { id: item.id, tenantId: item.tenantId, leaseId, status: 'queued', dispatchStartedAt: null, leaseUntil: { gt: new Date() } };
        try {
          await assertWorkflowActionAdmission(tx, { id: workflow.id, tenantId: item.tenantId,
            version: context.context?.['event.continuationSourceId'] ? item.workflowVersion ?? workflow.version : undefined });
        } catch (error) {
          if (!isWorkflowAdmissionSkipped(error)) throw error;
          const skipped = await tx.workflowExecutionRun.updateMany({ where, data: { status: 'skipped', completedAt: new Date(), errorMessage: error.message, leaseId: null, leaseUntil: null } });
          return skipped.count ? 'skipped' : 'unclaimed';
        }
        const started = await tx.workflowExecutionRun.updateMany({ where, data: { status: 'running', dispatchStartedAt: new Date(), errorMessage: null } });
        return started.count ? 'started' : 'unclaimed';
      });
      if (admission !== 'unclaimed') progressed = true;
      if (admission !== 'started') return;
      await workflowChain.run(new Set(context.ancestry ?? []), () => fireWorkflowTrigger({ tenantId: item.tenantId, actorId: context.actorId, triggerType: item.trigger.triggerType, entityType: item.entityType, entityId: item.entityId, eventId: item.trigger.eventId!, context: context.context ?? {} }, { workflow: captured, draft: parsed.data, run: item, leaseId, eventContext: context.eventContext, freshness: context.freshness }));
      await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: 'running', leaseUntil: { gt: new Date() } }, data: { status: 'skipped', completedAt: new Date(), errorMessage: 'The triggering state changed before dispatch.' } });
      await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: { not: 'running' } }, data: { leaseId: null, leaseUntil: null } });
    } catch (error) {
      const failure = preparationFailure(error);
      let event: 'preparation_deferred' | 'preparation_failed' | undefined;
      let retryAt: Date | undefined;
      const changed = await prisma.$transaction(async tx => {
        // Read persisted state through conditional writes: the dispatch marker's
        // acknowledgement may have been lost even though the write committed.
        const undispatched = {
          id: item.id, tenantId: item.tenantId, leaseId, status: 'queued', dispatchStartedAt: null,
        };
        const evidence = preparationContext(item.dispatchContext, attempts, failure.failureClass);
        if (failure.retryable && attempts < WORKFLOW_PREPARATION_ATTEMPTS) {
          retryAt = preparationRetryAt(attempts);
          const deferred = await tx.workflowExecutionRun.updateMany({ where: undispatched, data: { leaseId: null, leaseUntil: retryAt,
            errorMessage: 'Workflow preparation was deferred after a temporary infrastructure failure. No actions have started.', dispatchContext: evidence } });
          if (deferred.count) {
            event = 'preparation_deferred';
            return true;
          }
        } else if (await failPreparation(tx, item, undispatched, attempts >= WORKFLOW_PREPARATION_ATTEMPTS
          ? 'Workflow preparation failed after five attempts. No actions were started.'
          : 'Workflow preparation failed before dispatch. No actions were started.', evidence)) {
          event = 'preparation_failed';
          return true;
        }
        return interruptWorkflowRun(tx, item, { leaseId, status: 'running', dispatchStartedAt: { not: null } });
      });
      // A rolled-back/unacknowledged claim may leave no owned row to update.
      // Surface that infrastructure failure instead of reporting a healthy sweep.
      if (!changed && !claimed) throw error;
      if (changed) progressed = true;
      if (changed && event) console.info('[Workflow]', { event, executionId: item.id, attempts, retryAt: retryAt?.toISOString(), failureClass: failure.failureClass });
    }
  });
  // Preparation failures remain queued for recovery rather than spinning here.
  return due.length === 10 && progressed;
}

export function startWorkflowScheduler(dealStageWorkflowId?: string) {
  workflowWorkerStarted(!!dealStageWorkflowId);
  let stopping = false;
  let requested = false;
  let pending: Promise<void> | undefined;
  // Capture startup context, not the request/transaction/lease issuing a wake.
  const resource = new AsyncResource('WorkflowWorker');
  const tick = resource.bind(() => {
    if (stopping) return;
    requested = true;
    if (pending) return;
    pending = Promise.resolve().then(async () => {
      let more: boolean;
      do {
        requested = false;
        more = await dispatchQueuedWorkflows(dealStageWorkflowId);
        workflowWorkerSweep(true);
      } while (!stopping && (requested || more));
    }).catch(error => {
      workflowWorkerSweep(false);
      console.error('[Workflow] Queue tick failed', { failureClass: preparationFailure(error).failureClass });
    })
      .finally(() => { pending = undefined; if (requested && !stopping) tick(); });
  });
  const unregister = registerWorkflowWake(tick);
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
  return async () => { stopping = true; workflowWorkerDraining(); unregister(); clearInterval(timer); await pending; workflowWorkerStopped(); resource.emitDestroy(); };
}

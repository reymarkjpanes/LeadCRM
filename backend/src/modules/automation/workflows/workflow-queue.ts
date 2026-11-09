import { randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { accountWorkflowRetirementReferences } from './workflow-fields';
import { ACCOUNT_RETIREMENT_REASON, WorkflowConditionSchema } from '@leadcrm/shared';
import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { workflowChain } from './workflow-dispatch-context';
import type { WorkflowFireParams } from './workflow.engine';
import { findTrigger } from '../triggers/trigger-catalog';
import { ValidationError } from '../../../shared/errors/http-error';
import { entityContext } from './workflows.repository';
import { compatibleWorkflow } from './workflow-fields';
import { workflowStageEvent } from './workflow-stage-entry';
import { evaluateCondition } from './workflow-conditions';
import { interruptWorkflowRun } from './workflow-interruption';
import { markWorkflowQueued, registerWorkflowWake } from '../../crm/leads/sales-context';

const metadata = ['event.previousStageId', 'event.newStageId', 'event.stageHistoryId', 'event.previousStatus', 'event.newStatus', 'event.changedFields', 'event.originDealId', 'event.continuationSourceId', 'event.continuationUpdateId'];

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
      await tx.workflow.update({ where: { id: workflow.id, tenantId: params.tenantId }, data: { isActive: false, status: 'PAUSED', version: { increment: 1 } } });
      continue;
    }
    if (ancestry.includes(workflow.id)) continue;
    const triggerId = randomUUID();
    // PostgreSQL uniqueness errors abort transactions: use ON CONFLICT, never catch-and-continue.
    const inserted = await tx.workflowTriggerRecord.createMany({ data: [{ id: triggerId, tenantId: params.tenantId, workflowId: workflow.id, triggerType: params.triggerType, entityType: params.entityType, entityId: params.entityId, eventId, payload: { queueVersion: 1, recordName } }], skipDuplicates: true });
    if (!inserted.count) continue;
    await tx.workflowExecutionRun.create({ data: { tenantId: params.tenantId, workflowId: workflow.id, triggerId, entityType: params.entityType, entityId: params.entityId,
      status: 'queued', workflowVersion: workflow.version,
      definitionSnapshot: { name: workflow.name, description: workflow.description, trigger: workflow.trigger, conditions: workflow.conditions, actions: workflow.actions, isActive: workflow.isActive },
      dispatchContext: { version: 1, actorId: params.actorId ?? null, activatedById: workflow.activatedById, ancestry, context, eventContext } as Prisma.InputJsonValue,
    } });
    markWorkflowQueued(tx);
  }
}

/** A later field save can satisfy a still-current stage entry, never a historical one. */
export async function enqueueStageConditionContinuations(tx: Prisma.TransactionClient, params: WorkflowFireParams) {
  if (params.triggerType !== 'deal.updated' || !Array.isArray(params.context['event.changedFields'])) return;
  const deal = await tx.deal.findFirst({ where: { tenantId: params.tenantId, id: params.entityId, isArchived: false, deletedAt: null }, select: { currentStageHistoryId: true } });
  if (!deal?.currentStageHistoryId) return;
  const sources = await tx.workflowTriggerRecord.findMany({ where: { tenantId: params.tenantId, entityId: params.entityId, triggerType: 'deal.stage_changed', eventId: `deal.stage_changed:${deal.currentStageHistoryId}` }, include: { workflow: true, runs: { include: { steps: true } } } });
  if (!sources.length) return;
  const recorded = await workflowStageEvent(params.tenantId, params.entityId, 'deal.stage_changed', deal.currentStageHistoryId, tx);
  for (const source of sources) {
    const { workflow } = source, execution = source.runs[0];
    if (!execution || !workflow.isActive || workflow.status !== 'ACTIVE' || workflow.isArchived || workflow.version !== execution.workflowVersion || !['queued', 'running', 'skipped'].includes(execution.status)) continue;
    if (execution.steps.some(step => step.status !== 'skipped')) continue;
    if (source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload) && source.payload.stageActionRunId) continue;
    const draft = await compatibleWorkflow({ trigger: workflow.trigger, conditions: workflow.conditions, actions: workflow.actions }, params.tenantId);
    const conditions = WorkflowConditionSchema.safeParse(draft.conditions);
    if (!conditions.success || !conditions.data.conditions.some(rule => rule.field.startsWith('deal.') && (params.context['event.changedFields'] as unknown[]).includes(rule.field.slice(5)))) continue;
    const dispatch = execution.dispatchContext as { eventContext?: Record<string, unknown> } | null;
    if (!dispatch?.eventContext || evaluateCondition(conditions.data, dispatch.eventContext)) continue;
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
  const expired = await prisma.workflowExecutionRun.findMany({ where: { ...scope, status: 'running', dispatchContext: { not: Prisma.DbNull }, dispatchStartedAt: { not: null }, leaseUntil: { lt: now } }, select: { id: true, tenantId: true }, take: 50 });
  for (const run of expired) await tenantContext.run({ tenantId: run.tenantId }, () => prisma.$transaction(async tx => {
    await interruptWorkflowRun(tx, run, { status: 'running', leaseUntil: { lt: now } }, now);
  }));
  const due = await prisma.workflowExecutionRun.findMany({ where: { ...scope, status: 'queued', dispatchContext: { not: Prisma.DbNull }, dispatchStartedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: 10, include: { trigger: true } });
  for (const item of due) await tenantContext.run({ tenantId: item.tenantId }, async () => {
    const leaseId = randomUUID();
    const claim = await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, tenantId: item.tenantId, status: 'queued', dispatchStartedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseId, leaseUntil: new Date(Date.now() + 300000) } });
    if (!claim.count) return;
    const context = item.dispatchContext as { version?: number; actorId?: string; activatedById?: string; ancestry?: string[]; context?: Record<string, unknown>; eventContext?: Record<string, unknown> };
    try {
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
      if (!(await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: 'queued', dispatchStartedAt: null, leaseUntil: { gt: new Date() } }, data: { status: 'running', dispatchStartedAt: new Date() } })).count) return;
      progressed = true;
      const snapshot = item.definitionSnapshot && typeof item.definitionSnapshot === 'object' && !Array.isArray(item.definitionSnapshot) ? item.definitionSnapshot : null;
      if (!snapshot || !context.activatedById) throw new ValidationError('Published workflow snapshot is unavailable.');
      const captured = { ...workflow, ...snapshot, id: workflow.id, tenantId: item.tenantId, version: item.workflowVersion ?? workflow.version, activatedById: context.activatedById } as typeof workflow;
      const { fireWorkflowTrigger } = await import('./workflow.engine.js');
      await workflowChain.run(new Set(context.ancestry ?? []), () => fireWorkflowTrigger({ tenantId: item.tenantId, actorId: context.actorId, triggerType: item.trigger.triggerType, entityType: item.entityType, entityId: item.entityId, eventId: item.trigger.eventId!, context: context.context ?? {} }, { workflow: captured, run: item, leaseId, eventContext: context.eventContext }));
      await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: 'running', leaseUntil: { gt: new Date() } }, data: { status: 'skipped', completedAt: new Date(), errorMessage: 'The triggering state changed before dispatch.' } });
      await prisma.workflowExecutionRun.updateMany({ where: { id: item.id, leaseId, status: { not: 'running' } }, data: { leaseId: null, leaseUntil: null } });
    } catch {
      await prisma.$transaction(async tx => {
        // Read persisted state through conditional writes: the dispatch marker's
        // acknowledgement may have been lost even though the write committed.
        const undispatched = await tx.workflowExecutionRun.updateMany({ where: {
          id: item.id, tenantId: item.tenantId, leaseId, status: 'queued', dispatchStartedAt: null,
        }, data: { leaseId: null, leaseUntil: null } });
        if (undispatched.count) return; // The next bounded tick may safely retry preparation.
        await interruptWorkflowRun(tx, item, { leaseId, status: 'running', dispatchStartedAt: { not: null } });
      });
    }
  });
  // Preparation failures remain queued for recovery rather than spinning here.
  return due.length === 10 && progressed;
}

export function startWorkflowScheduler(dealStageWorkflowId?: string) {
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
      } while (!stopping && (requested || more));
    }).catch(error => console.error('[Workflow] Queue tick failed', { failureClass: error instanceof Error ? error.name : 'UnknownError' }))
      .finally(() => { pending = undefined; if (requested && !stopping) tick(); });
  });
  const unregister = registerWorkflowWake(tick);
  const timer = setInterval(tick, 30000);
  timer.unref();
  tick();
  return async () => { stopping = true; unregister(); clearInterval(timer); await pending; resource.emitDestroy(); };
}

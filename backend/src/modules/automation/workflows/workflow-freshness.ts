import type { Prisma, Workflow } from '@prisma/client';
import { WorkflowActionSchema, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';
import { crmActor } from '../../crm/access/crm-record-access.service';
import type { WorkflowFireParams } from './workflow.engine';

const stageEvidenceSelect = { id: true, pipelineId: true, stageId: true, currentStageHistoryId: true } as const;
export type DealStageEvidence = Prisma.DealGetPayload<{ select: typeof stageEvidenceSelect }>;
export type WorkflowFreshnessEvidence = { relatedStages?: DealStageEvidence[] };
export type WorkflowActionGuard = {
  admit: (tx: Prisma.TransactionClient, options?: { dealId?: string; preparedInput?: boolean; ownChanges?: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  changes: (tx: Prisma.TransactionClient, before: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/** Only stage identity is needed for related Deals. CRM field values are already in eventContext. */
export async function captureWorkflowFreshness(tx: Prisma.TransactionClient, params: WorkflowFireParams, workflow: Workflow,
  eventContext: Record<string, unknown>): Promise<WorkflowFreshnessEvidence> {
  const entity = params.entityType;
  if ((entity !== 'lead' && entity !== 'contact') || eventContext['event.originDealId'] === null || !Array.isArray(workflow.actions)) return {};
  const stageIds = workflow.actions.flatMap(value => {
    const action = WorkflowActionSchema.safeParse(value);
    return action.success && action.data.enabled !== false && action.data.type === 'move_deal_stage' &&
      typeof action.data.config.stageId === 'string' ? [action.data.config.stageId] : [];
  });
  if (!stageIds.length) return {};
  const stages = await tx.stage.findMany({ where: { tenantId: params.tenantId, id: { in: stageIds } }, select: { pipelineId: true } });
  const tenantId = params.tenantId;
  // The publisher's read grants are checked at dispatch. Event capture must not depend on the manual actor's Deal visibility.
  return { relatedStages: await crmActor.exit(async () => await tx.deal.findMany({ where: { tenantId, isArchived: false, deletedAt: null,
    pipelineId: { in: stages.map(stage => stage.pipelineId) },
    ...(typeof eventContext['event.originDealId'] === 'string' ? { id: eventContext['event.originDealId'] } : {}),
    ...(entity === 'lead' ? { leadDeals: { some: { tenantId, leadId: params.entityId } } }
      : { contactDeals: { some: { tenantId, contactId: params.entityId } } }),
  }, select: stageEvidenceSelect })) };
}

export async function readWorkflowDealStage(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  return tx.deal.findFirst({ where: { tenantId, id, isArchived: false, deletedAt: null },
    select: { ...stageEvidenceSelect, stageChangedAt: true } });
}

export function workflowWriteFields(action: WorkflowAction, entity: WorkflowEntity): string[] {
  if (action.type === 'assign_owner') return [`${entity}.assignedUserId`];
  if (action.type !== 'update_field') return [];
  const field = String(action.config.field);
  return [`${entity}.${field}`, ...(field === 'status' ? ['internal.statusChangedAt'] : []),
    ...(entity === 'contact' && field === 'productInterestIds' ? ['contact.productInterestOther'] : [])];
}

export function skipStaleWorkflowAction(message: string): never {
  throw new AppError(message, 409, 'WORKFLOW_ACTION_STALE');
}

export function isStaleWorkflowAction(error: unknown): error is AppError {
  return error instanceof AppError && error.code === 'WORKFLOW_ACTION_STALE';
}

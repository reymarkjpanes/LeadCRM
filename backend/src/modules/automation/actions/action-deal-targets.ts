import { workflowLossReason, DEFAULT_CLOSING_FIELDS, isClosedWonField, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import { validateDealStageMove } from '../../crm/deals/deals.service';
import { readConfiguredFields, validateClosingRequirements } from '../../crm/closing-requirements/closing-requirements.repository';
import type { DealStageValidationState, RelatedDealMoveGuard } from '../../crm/deals/deal-lifecycle';

/** In-memory dry-run state only; execution always reads its transactional targets. */
export type WorkflowDealProjection = Map<string, DealStageValidationState>;
export async function loadWorkflowDealProjection(tenantId: string, id: string, projection: WorkflowDealProjection) {
  const previous = projection.get(id);
  if (previous) return previous;
  const deal = await prisma.deal.findFirst({ where: { tenantId, id, isArchived: false, deletedAt: null }, include: { stage: true } });
  if (!deal) throw new NotFoundError('Deal');
  projection.set(id, deal);
  return deal;
}

export async function relatedDealMoveGuard(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>): Promise<RelatedDealMoveGuard | undefined> {
  if (entity === 'deal') return undefined;
  if (entity !== 'lead' && entity !== 'contact') throw new ValidationError('Choose a Lead, Contact or Deal trigger.');
  const stage = await prisma.stage.findFirst({ where: { tenantId, id: String(action.config.stageId) } });
  if (!stage) throw new NotFoundError('Stage');
  return { pipelineId: stage.pipelineId, related: { entity, id: String(context[`${entity}.id`]) },
    ...(action.config.currentStageId ? { currentStageId: String(action.config.currentStageId) } : {}),
    ...(action.config.productInterestId ? { productInterestId: String(action.config.productInterestId) } : {}),
  };
}

/** Resolve from persisted tenant-owned relationships; never inject another triggering entity. */
export async function resolveDealTargets(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>, projection?: WorkflowDealProjection) {
  if (entity === 'deal') {
    const id = String(context['deal.id']);
    if (projection) await loadWorkflowDealProjection(tenantId, id, projection);
    return [id];
  }
  if (entity !== 'lead' && entity !== 'contact') throw new ValidationError('Choose a Lead, Contact or Deal trigger.');
  // Customer-only replies have no Deal target; ordinary customer workflows omit this key.
  if (context['event.originDealId'] === null) return [];
  const stage = await prisma.stage.findFirst({ where: { tenantId, id: String(action.config.stageId) } });
  if (!stage) throw new NotFoundError('Stage');
  const relation = entity === 'lead' ? { leadDeals: { some: { tenantId, leadId: String(context['lead.id']) } } }
    : { contactDeals: { some: { tenantId, contactId: String(context['contact.id']) } } };
  const deals = await prisma.deal.findMany({ where: { tenantId, isArchived: false, deletedAt: null, pipelineId: stage.pipelineId,
    ...(typeof context['event.originDealId'] === 'string' ? { id: context['event.originDealId'] } : {}),
    ...(!projection ? { stage: { isWon: false, isLost: false } } : {}), ...relation,
    ...(!projection && action.config.currentStageId ? { stageId: String(action.config.currentStageId) } : {}),
    ...(action.config.productInterestId ? { productInterestId: String(action.config.productInterestId) } : {}),
  }, select: { id: true }, orderBy: { id: 'asc' } });
  const ids: string[] = [];
  for (const deal of deals) {
    const projected = projection && await loadWorkflowDealProjection(tenantId, deal.id, projection);
    if (!projected || !projected.stage.isWon && !projected.stage.isLost && (!action.config.currentStageId || projected.stageId === action.config.currentStageId)) ids.push(deal.id);
  }
  if (ids.length > 1 && action.config.targetMode !== 'all_matching') throw new ValidationError('Multiple related Deals match. Add Product or current-stage filters, or explicitly select All matching related Deals.');
  return ids;
}

export async function validateDealTargets(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>, projection?: WorkflowDealProjection) {
  const ids = await resolveDealTargets(action, entity, tenantId, context, projection);
  for (const id of ids) {
    const projected = projection?.get(id);
    const stage = await validateDealStageMove(id, tenantId, { stageId: String(action.config.stageId), lostReason: workflowLossReason(action.config) }, { optionalLossReason: true }, projected);
    if (stage.isWon) {
      const deal = projected ?? await prisma.deal.findFirstOrThrow({ where: { tenantId, id }, include: { stage: true } });
      if (deal.stageId !== stage.id) {
        const configured = await readConfiguredFields(prisma, tenantId);
        const fields = (configured.length ? configured : DEFAULT_CLOSING_FIELDS).filter(field => field.active && isClosedWonField(field));
        await validateClosingRequirements(prisma, tenantId, deal, fields);
      }
    }
  }
  return ids;
}

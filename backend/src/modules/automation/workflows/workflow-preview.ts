import { workflowLossReason, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { NotFoundError } from '../../../shared/errors/http-error';
import { dealStageStatus, isQualifiedStage } from '../../crm/deals/deal-lifecycle';
import type { WorkflowDealProjection } from '../actions/action-deal-targets';
export { loadWorkflowDealProjection } from '../actions/action-deal-targets';

export function projectWorkflowFields(entity: WorkflowEntity, context: Record<string, unknown>, patch: Record<string, unknown>, projection: WorkflowDealProjection) {
  const deal = entity === 'deal' && projection.get(String(context['deal.id']));
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'customFieldValues') {
      for (const [id, customValue] of Object.entries(value as Record<string, unknown>)) context[`${entity}.customFieldValues.${id}`] = customValue;
    } else {
      context[`${entity}.${field === 'productInterest' ? 'productInterestIds' : field}`] = value;
      if (entity === 'deal' && (field === 'leadIds' || field === 'contactIds') && Array.isArray(value)) {
        const primaryField = field === 'leadIds' ? 'leadId' : 'contactId';
        const primaryId = value[0] ?? null;
        context[`deal.${primaryField}`] = primaryId;
        if (deal) deal[primaryField] = primaryId;
      }
    }
  }
  if (deal) Object.assign(deal, patch);
}

/** Validation already used these projected records through the ordinary stage validators. */
export async function projectWorkflowDealMove(action: WorkflowAction, ids: string[], tenantId: string, entity: WorkflowEntity,
  context: Record<string, unknown>, projection: WorkflowDealProjection) {
  if (!ids.length) return;
  const stage = await prisma.stage.findFirst({ where: { tenantId, id: String(action.config.stageId) } });
  if (!stage) throw new NotFoundError('Stage');
  const now = new Date();
  for (const id of ids) {
    const deal = projection.get(id);
    if (!deal) throw new NotFoundError('Deal');
    if (deal.stageId === stage.id) continue;
    const won = deal.hasEverBeenWon || !!deal.wonConfirmedAt || deal.stage.isWon || stage.isWon;
    Object.assign(deal, { stage, stageId: stage.id, engagementStatus: dealStageStatus(stage, deal.engagementStatus),
      hasEverBeenWon: won, ...(won ? { wonHistoryVerified: true } : {}), ...(isQualifiedStage(stage) ? { priority: 'HIGH' } : {}),
      closedAt: stage.isWon || stage.isLost ? now : null, lostReason: stage.isLost ? workflowLossReason(action.config) ?? null : null });
    if (entity === 'deal') Object.assign(context, {
      'deal.stageId': deal.stageId, 'deal.stageName': stage.name, 'deal.isQualified': isQualifiedStage(stage),
      'deal.engagementStatus': deal.engagementStatus, 'deal.priority': deal.priority,
      'deal.hasEverBeenWon': deal.hasEverBeenWon, 'deal.wonHistoryVerified': deal.wonHistoryVerified,
      'deal.closedAt': deal.closedAt?.toISOString().slice(0, 10) ?? null, 'deal.lostReason': deal.lostReason,
    });
  }
}

import { DEFAULT_CLOSING_FIELDS, type ClosingField, type ClosingValues, type WorkflowAction, type WorkflowEntity } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { ValidationError, NotFoundError } from '../../../shared/errors/http-error';
import { validateDealStageMove } from '../../crm/deals/deals.service';
import { validateValues } from '../../crm/closing-requirements/closing-requirements.repository';

/** Resolve from persisted tenant-owned relationships; never inject another triggering entity. */
export async function resolveDealTargets(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  if (entity === 'deal') return [String(context['deal.id'])];
  if (entity !== 'lead' && entity !== 'contact') throw new ValidationError('Choose a Lead, Contact or Deal trigger.');
  const stage = await prisma.stage.findFirst({ where: { tenantId, id: String(action.config.stageId) } });
  if (!stage) throw new NotFoundError('Stage');
  const relation = entity === 'lead' ? { leadDeals: { some: { tenantId, leadId: String(context['lead.id']) } } }
    : { contactDeals: { some: { tenantId, contactId: String(context['contact.id']) } } };
  const deals = await prisma.deal.findMany({ where: { tenantId, isArchived: false, deletedAt: null, pipelineId: stage.pipelineId,
    stage: { isWon: false, isLost: false }, ...relation,
    ...(action.config.currentStageId ? { stageId: String(action.config.currentStageId) } : {}),
    ...(action.config.productInterestId ? { productInterestId: String(action.config.productInterestId) } : {}),
  }, select: { id: true }, orderBy: { id: 'asc' } });
  if (deals.length > 1 && action.config.targetMode !== 'all_matching') throw new ValidationError('Multiple related Deals match. Add Product or current-stage filters, or explicitly select All matching related Deals.');
  return deals.map(deal => deal.id);
}

export async function validateDealTargets(action: WorkflowAction, entity: WorkflowEntity, tenantId: string, context: Record<string, unknown>) {
  const ids = await resolveDealTargets(action, entity, tenantId, context);
  for (const id of ids) {
    const stage = await validateDealStageMove(id, tenantId, { stageId: String(action.config.stageId), lostReason: String(action.config.lostReason ?? '') });
    if (stage.isWon) {
      const deal = await prisma.deal.findFirstOrThrow({ where: { tenantId, id }, include: { stage: true } });
      if (deal.stageId !== stage.id) {
        if (deal.stage.name.trim().toLowerCase() !== 'qualified') throw new ValidationError('Deal must be Qualified before completing Closed Won requirements.');
        const rows = await prisma.closingFieldDefinition.findMany({ where: { tenantId } });
        const fields = rows.length ? rows.map(row => row.definition as unknown as ClosingField) : DEFAULT_CLOSING_FIELDS;
        const errors = await validateValues(prisma, tenantId, deal.id, fields.filter(field => field.active && field.required), deal.closingValues as ClosingValues);
        if (Object.keys(errors).length) throw new ValidationError('Complete all required Closed Won requirements before closing this Deal.');
      }
    }
  }
  return ids;
}

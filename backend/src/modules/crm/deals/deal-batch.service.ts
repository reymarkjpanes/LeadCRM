import { createHash } from 'node:crypto';
import type { BatchFiles } from '../closing-requirements/custom-field-values.repository';
import { CreateDealBatchSchema, productDealTitle } from '@leadcrm/shared';
import { ConflictError, ValidationError } from '../../../shared/errors/http-error';
import { resolveProducts, salesTransaction, validateSalesOwner } from '../leads/lead-automation.service';
import * as repo from './deals.repository';
import { participantOrder, withDealParticipants } from './deal-participants';
import { fireDealCreated } from '../../automation/triggers/triggers.service';

export async function createDealBatch(tenantId: string, actorId: string, input: unknown) {
  const dto = CreateDealBatchSchema.parse(input);
  const requestHash = createHash('sha256').update(JSON.stringify({ actorId, ...dto, productInterestIds: [...dto.productInterestIds].sort() })).digest('hex');
  const result = await salesTransaction(async tx => {
    const previous = await tx.dealCreationReceipt.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } } });
    if (previous) {
      if (previous.requestHash !== requestHash || previous.actorId !== actorId) throw new ConflictError('This request key belongs to a different submission. Start a new Deal form.');
      const deals = await Promise.all(previous.dealIds.map(id => tx.deal.findFirstOrThrow({ where: { id, tenantId }, include: {
        stage: true, pipeline: true, organization: true, assignedUser: { select: { id: true, firstName: true, lastName: true } },
        leadDeals: { orderBy: participantOrder, include: { lead: true } }, contactDeals: { orderBy: participantOrder, include: { contact: true } },
      } })));
      return { deals: deals.map(withDealParticipants), replayed: true };
    }
    const pipeline = await tx.pipeline.findFirst({ where: { tenantId, id: dto.pipelineId, isArchived: false } });
    if (!pipeline) throw new ValidationError('Choose an available pipeline.');
    const stages = await tx.stage.findMany({ where: { tenantId, pipelineId: pipeline.id, name: { equals: 'Lead', mode: 'insensitive' }, isWon: false, isLost: false } });
    if (stages.length !== 1 || stages[0].id !== dto.stageId) throw new ValidationError('New Deals must start at the Lead stage.');
    if (dto.assignedUserId) await validateSalesOwner(tx, tenantId, dto.assignedUserId);
    if (dto.accountId && !await tx.account.findFirst({ where: { tenantId, id: dto.accountId, isArchived: false, deletedAt: null } })) throw new ValidationError('Account is unavailable.');
    const leadIds = [...new Set(dto.leadIds ?? [])], contactIds = [...new Set(dto.contactIds ?? [])];
    if (await tx.lead.count({ where: { tenantId, id: { in: leadIds }, isArchived: false, deletedAt: null } }) !== leadIds.length) throw new ValidationError('A selected Lead is unavailable.');
    if (await tx.contact.count({ where: { tenantId, id: { in: contactIds }, isArchived: false, deletedAt: null } }) !== contactIds.length) throw new ValidationError('A selected Contact is unavailable.');
    const products = await resolveProducts(tx, tenantId, dto.productInterestIds);
    const { idempotencyKey, productInterestIds: _ids, ...common } = dto;
    const deals = [];
    const batchFiles: BatchFiles = new Map();
    for (const product of products) {
      const deal = await repo.createDeal(tenantId, actorId, { ...common, leadIds, contactIds, currency: 'PHP',
        productInterestId: product.id, title: productDealTitle(dto.title, product.name, products.length > 1) }, tx, batchFiles);
      deals.push(deal);
      await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'deal.created', entityType: 'Deal', entityId: deal.id,
        changeset: { after: { title: deal.title, value: deal.value, productInterestId: product.id, stageId: deal.stageId } } } });
      await tx.activity.create({ data: { tenantId, createdById: actorId, dealId: deal.id, type: 'deal_action', title: `Deal created: ${deal.title}` } });
    }
    await tx.dealCreationReceipt.create({ data: { tenantId, actorId, idempotencyKey, requestHash, dealIds: deals.map(deal => deal.id) } });
    return { deals, replayed: false };
  });
  // Replaying these stable events is safe even if the first HTTP response was lost.
  for (const deal of result.deals) {
    await fireDealCreated({ tenantId, actorId, deal });

  }
  return result;
}

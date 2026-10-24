import { assertDealAddressSource } from './deal-address';
import { randomUUID } from 'node:crypto';
import { refreshDealClassification } from '../customer-classification.service';
import { changeDealAssociation, readDealAssociation, resolveManualDealAssociation } from './deal-association';
import { salesContext } from '../leads/sales-context';
import { resolveProducts, salesTransaction } from '../leads/lead-automation.service';
import { validateSalesOwner } from '../leads/lead-automation.service';
import { Prisma } from '@prisma/client';
import { MoveDealPipelineSchema } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import * as repo from './deals.repository';
import { writeAuditLog, buildChangeset } from '../../../core/audit/audit.service';
import { NotFoundError, ValidationError, ConflictError } from '../../../shared/errors/http-error';
import { AppError } from '../../../shared/errors/app-error';
import { CreateDealDto, UpdateDealDto, MoveDealStageDto, DealsQueryParams, ManualCreateDealSchema } from './deals.dto';
import { paginate } from '../../../shared/helpers/pagination';
import { fireDealCreated, fireDealStageChanged, fireDealUpdated } from '../../automation/triggers/triggers.service';
import { recordChanges, customFieldChangeTracker } from '../record-updates';
import { assertDealStageTransition, dealHasEverBeenWon } from './deal-lifecycle';

/**
 * Maps known Prisma constraint/infrastructure errors to appropriate HTTP errors.
 * - P2002 (unique constraint) → ConflictError (409)
 * - P2003 (foreign key constraint) → ValidationError (400)
 * - Connection/infrastructure errors → logged server-side, then re-thrown for global handler (500)
 */
function mapRepositoryError(error: unknown, context: string): never {
  if (error instanceof AppError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') throw new ConflictError('This Deal is no longer active or has changed. Reopen it before editing.');
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[])?.join(', ') || 'field';
      throw new ConflictError(`A deal with the same ${target} already exists`);
    }
    if (error.code === 'P2003') {
      const field = (error.meta?.field_name as string) || 'reference';
      throw new ValidationError(`Invalid ${field}: referenced record does not exist`);
    }
  }

  // Infrastructure/connection errors — log server-side with context, then propagate to global handler
  console.error(`[DealsService] Infrastructure error in ${context}:`, {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  throw error;
}

export async function getDeals(tenantId: string, query: DealsQueryParams) {
  const result = await repo.findAllDeals(tenantId, query);
  return paginate(result.data, result.total, { page: result.page, limit: result.limit });
}

export async function getDealsGroupedByStage(tenantId: string, pipelineId: string, stagePageMap?: Record<string, number>, scope?: DealsQueryParams['scope']) {
  return repo.findDealsGroupedByStage(tenantId, pipelineId, stagePageMap, scope);
}

export async function getDealById(id: string, tenantId: string) {
  const deal = await repo.findDealById(id, tenantId);
  if (!deal) throw new NotFoundError('Deal');
  return deal;
}

export async function createDeal(tenantId: string, userId: string, dto: CreateDealDto) {
  const input = dto;
  return salesTransaction(async tx => {
  let dto = ManualCreateDealSchema.parse(input);
  dto = { ...dto, ...await resolveManualDealAssociation(tx, tenantId, dto) };
  await assertDealAddressSource(tx, tenantId, dto.addressSource, dto);
  const stage = await (salesContext.getStore() ?? prisma).stage.findFirst({ where: { id: dto.stageId, tenantId, pipelineId: dto.pipelineId } });
  if (!stage) throw new ValidationError('Stage must belong to the selected pipeline.');
  const initial = await (salesContext.getStore() ?? prisma).stage.findMany({ where: { tenantId, pipelineId: dto.pipelineId, name: { equals: 'Lead', mode: 'insensitive' }, isWon: false, isLost: false } });
  if (initial.length !== 1) throw new ValidationError('Configure one Lead starting stage in this pipeline.');
  dto = { ...dto, stageId: initial[0].id };

  let deal;
  try {
    deal = await repo.createDeal(tenantId, userId, dto, tx);
  } catch (error) {
    mapRepositoryError(error, 'createDeal');
  }

  await writeAuditLog({
    tenantId, userId,
    action: 'deal.created', entityType: 'Deal', entityId: deal.id,
    after: { title: dto.title, pipelineId: dto.pipelineId, stageId: dto.stageId, value: deal.value },
  });

  // Capture dependent automation before committing the Deal.
  await fireDealCreated({ tenantId, actorId: userId, deal });

  // Assignment events commit with the Deal through the notification outbox.

  return deal;
  });
}

export async function updateDeal(id: string, tenantId: string, userId: string, dto: UpdateDealDto) {
  const input = dto;
  return salesTransaction(async () => {
  let dto = input;
  const before = await repo.findDealById(id, tenantId);
  if (!before) throw new NotFoundError('Deal');
  if (dto.assignedUserId) await validateSalesOwner(salesContext.getStore() ?? prisma, tenantId, dto.assignedUserId, ['deals'], before.ownerGroupId);
  const { primaryAssociation, ...updates } = dto;
  if (primaryAssociation) {
    if (dto.leadIds !== undefined || dto.contactIds !== undefined) throw new ValidationError('Change the primary association separately from additional relationships.');
    await readDealAssociation(salesContext.getStore() ?? prisma, tenantId, primaryAssociation);
    Object.assign(updates, changeDealAssociation(before.leadDeals.map(link => link.leadId), before.contactDeals.map(link => link.contactId), primaryAssociation));
  }
  if (updates.addressSource !== undefined) await assertDealAddressSource(salesContext.getStore() ?? prisma, tenantId, updates.addressSource, { accountId: updates.accountId !== undefined ? updates.accountId : before.accountId, leadIds: updates.leadIds ?? before.leadDeals.map(link => link.leadId), contactIds: updates.contactIds ?? before.contactDeals.map(link => link.contactId) });
  dto = updates;
  const withCustomChanges = await customFieldChangeTracker(tenantId, 'deals', id, dto.customFieldValues);

  let deal;
  try {
    deal = await repo.updateDeal(id, tenantId, dto, userId);
  } catch (error) {
    mapRepositoryError(error, 'updateDeal');
  }
  if (!deal) throw new NotFoundError('Deal');

  const { before: changedBefore, after: changedAfter } = buildChangeset(
    before as unknown as Record<string, unknown>,
    deal  as unknown as Record<string, unknown>,
  );

  const updateEventId = randomUUID();
  await writeAuditLog({
    tenantId, userId,
    action: 'deal.updated', entityType: 'Deal', entityId: id, metadata: { eventId: updateEventId },
    before: changedBefore, after: changedAfter,
  });
  const changes = await withCustomChanges(recordChanges(before, deal));
  if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId: userId, eventId: updateEventId, record: deal, changedFields: changes.changedFields, changes });

  // Assignment events commit with the Deal through the notification outbox.

  return deal;
  });
}

export async function validateDealStageMove(id: string, tenantId: string, dto: MoveDealStageDto, policy: import('./deal-lifecycle').DealStageMovePolicy = {}) {
  // SEC-1 fix: Resolve stage within the tenant boundary via pipeline
  const newStage = await (salesContext.getStore() ?? prisma).stage.findFirst({
    where: { id: dto.stageId, tenantId },
  });
  if (!newStage) throw new NotFoundError('Stage');

  const deal = await (salesContext.getStore() ?? prisma).deal.findFirst({ where: { id, tenantId, isArchived: false, deletedAt: null }, include: { stage: true } });
  if (!deal) throw new NotFoundError('Deal');
  if (deal.pipelineId !== newStage.pipelineId) throw new ValidationError('Stage must belong to this Deal’s pipeline.');
  if (deal.stageId === newStage.id) return newStage;
  assertDealStageTransition(deal, newStage, await dealHasEverBeenWon(salesContext.getStore() ?? prisma, tenantId, deal));

  if (newStage.isLost && !dto.lostReason?.trim() && !policy.optionalLossReason) {
    throw new ValidationError('Lost reason is required when closing a deal as lost');
  }

  // BW-5 / REQ089: Enforce stage entry requirements before allowing transition
  if (newStage.requiredFields && newStage.requiredFields.length > 0) {
    const missingFields: string[] = [];
    for (const field of newStage.requiredFields) {
      const value = (deal as Record<string, unknown>)[field];
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        missingFields.push(field);
      }
    }
    if (missingFields.length > 0) {
      throw new ValidationError(
        `Cannot advance to "${newStage.name}": missing required fields — ${missingFields.join(', ')}`
      );
    }
  }

  return newStage;
}

export async function moveDealStage(id: string, tenantId: string, userId: string, dto: MoveDealStageDto, guard?: import('./deal-lifecycle').RelatedDealMoveGuard, policy: import('./deal-lifecycle').DealStageMovePolicy = {}) {
  return salesTransaction(async () => {
  const newStage = await validateDealStageMove(id, tenantId, dto, policy);
  let result;
  try {
    result = await repo.moveDealStage(id, tenantId, dto.stageId, userId, dto.note, dto.handoff, dto.lostReason, dto.confirmation, undefined, guard, policy);
  } catch (error) {
    mapRepositoryError(error, 'moveDealStage');
  }
  if (!result) throw new NotFoundError('Deal');
  if (!result.stageHistory) return { deal: result.deal, stageHistory: result.stageHistory };

  await writeAuditLog({
    tenantId, userId,
    action: 'deal.stage_changed', entityType: 'Deal', entityId: id,
    after: { newStageId: dto.stageId, isWon: newStage.isWon, isLost: newStage.isLost, note: dto.note, lostReason: dto.lostReason },
  });

  // Capture dependent automation before committing the stage transition.
  await fireDealStageChanged({
    tenantId,
    eventId: result.stageHistory.id,
    actorId: userId,
    deal: result.deal,
    newStageId:   newStage.id,
    newStageName: newStage.name,
    isWon:        newStage.isWon,
    isLost:       newStage.isLost,
    prevStageId:  result.stageHistory.previousStageId ?? undefined,
  });
  const changes = recordChanges(result.previousDeal, result.deal);
  if (changes.changedFields.length) await fireDealUpdated({ tenantId, actorId: userId, eventId: result.stageHistory.id,
    record: result.deal, changedFields: changes.changedFields, changes });

  return { deal: result.deal, stageHistory: result.stageHistory };
  });
}

export async function moveDealPipeline(id: string, tenantId: string, actorId: string, input: unknown) {
  return salesTransaction(async () => {
  const dto = MoveDealPipelineSchema.parse(input);
  const result = await repo.moveDealPipeline(id, tenantId, actorId, dto);
  if (result.stageHistory) {
    await fireDealStageChanged({ tenantId, actorId, eventId: result.stageHistory.id, deal: result.deal,
      newStageId: result.deal.stage.id, newStageName: result.deal.stage.name, isWon: false, isLost: false,
      prevStageId: result.previousDeal.stageId });
    const changes = recordChanges(result.previousDeal, result.deal);
    await fireDealUpdated({ tenantId, actorId, eventId: result.stageHistory.id, record: result.deal, changedFields: changes.changedFields, changes });
  }
  return { deal: result.deal, stageHistory: result.stageHistory };
  });
}

export async function archiveDeal(id: string, tenantId: string, userId: string, archiveReason?: string) {
  let deal;
  try {
    deal = await repo.archiveDeal(id, tenantId, archiveReason, userId);
  } catch (error) {
    mapRepositoryError(error, 'archiveDeal');
  }
  if (!deal) throw new NotFoundError('Deal');

  await writeAuditLog({
    tenantId, userId,
    action: 'deal.archived', entityType: 'Deal', entityId: id,
    after: { isArchived: true, archiveReason },
  });

  return deal;
}

export async function restoreDeal(id: string, tenantId: string, userId: string) {
  return salesTransaction(async tx => {
  const deal = await repo.findDealById(id, tenantId);
  if (!deal) throw new NotFoundError('Deal');
  if (!deal.isArchived) throw new ValidationError('Deal is not archived');

  const restored = await tx.deal.update({
    where: { id },
    data: { isArchived: false, archiveReason: null },
  });

  await writeAuditLog({
    tenantId, userId,
    action: 'deal.restored', entityType: 'Deal', entityId: id,
    before: { isArchived: true, archiveReason: deal.archiveReason },
    after: { isArchived: false, archiveReason: null },
  });

  const classified = await refreshDealClassification(tx, tenantId, id, userId);
  return { ...restored, ...(classified ? { engagementStatus: classified.engagementStatus } : {}), leadId: deal.leadId, contactId: deal.contactId };
  });
}

export async function duplicateDeal(id: string, tenantId: string, userId: string) {
  return salesTransaction(async () => {

  const source = await repo.findDealById(id, tenantId);
  if (!source) throw new NotFoundError('Deal');
  const initialStage = await (salesContext.getStore() ?? prisma).stage.findFirst({ where: { tenantId, pipelineId: source.pipelineId, name: { equals: 'Lead', mode: 'insensitive' }, isWon: false, isLost: false } });
  if (!initialStage) throw new ValidationError('Configure a Lead stage before duplicating an opportunity.');

  // Destructure to exclude fields that shouldn't be copied
  const {
    id: _id, createdAt: _c, updatedAt: _u, closedAt: _cl, lostReason: _lr,
    currentStageHistoryId: _entry,
    isArchived: _a, deletedAt: _d,
    // Exclude relation fields that Prisma won't accept in create
    stage: _stage, pipeline: _pipeline, organization: _org, assignedUser: _au,
    owner: _owner, leadDeals: _ld, contactDeals: _cd, stageHistories: _sh, productInterestRecord: _product,
    lead: _lead, contact: _contact, leadId: _leadId, contactId: _contactId,
    ...copyData
  } = source as Record<string, unknown>;

  let newDeal: any;
  try {
    newDeal = await salesTransaction(async tx => {
      const ids = [...new Set([...source.productInterestIds, ...(source.productInterestId ? [source.productInterestId] : [])])];
      if (ids.length !== 1) throw new ValidationError('Choose one Product in a new Deal instead of duplicating a legacy opportunity.');
      const [product] = await resolveProducts(tx, tenantId, ids);
      if (source.productInterests.some(name => name.trim().toLowerCase() !== product.name.trim().toLowerCase())) throw new ValidationError('Reconcile legacy Product details before duplicating this Deal.');
      const created = await tx.deal.create({
        data: {
          ...copyData,
          productInterestId: product.id, productInterestIds: [], productInterests: [], productsNormalized: true,
          value: Number(product.dealValue), currency: 'PHP',
          automationKey: null,
          hasEverBeenWon: false,
          engagementStatus: 'Inquiry', engagementEvaluatedAt: null,
          wonHistoryVerified: true,
          title: `${source.title} (Copy)`,
          tenantId,
          ownerId: userId,
          isArchived: false,
          closedAt: null,
          lostReason: null,
          stageId: initialStage.id,
          stageChangedAt: new Date(),
          wonConfirmationType: null, wonConfirmationNote: null, wonConfirmedById: null, wonConfirmedAt: null,
          closingValues: {}, closingSnapshot: Prisma.DbNull,
        } as never,
      });

      // Copy lead associations from source deal
      const leadAssociations = await tx.leadDeal.findMany({ where: { dealId: id, tenantId } });
      if (leadAssociations.length > 0) {
        await tx.leadDeal.createMany({
          data: leadAssociations.map(a => ({ leadId: a.leadId, dealId: created.id, tenantId, addedById: userId, position: a.position })),
          skipDuplicates: true,
        });
      }

      // Copy contact associations from source deal
      const contactAssociations = await tx.contactDeal.findMany({ where: { dealId: id, tenantId } });
      if (contactAssociations.length > 0) {
        await tx.contactDeal.createMany({
          data: contactAssociations.map(a => ({ contactId: a.contactId, dealId: created.id, tenantId, addedById: userId, position: a.position })),
          skipDuplicates: true,
        });
      }
      await refreshDealClassification(tx, tenantId, created.id, userId);
      return created;
    });
  } catch (error) {
    mapRepositoryError(error, 'duplicateDeal');
  }

  await writeAuditLog({
    tenantId, userId,
    action: 'deal.duplicated', entityType: 'Deal', entityId: newDeal.id,
    after: { sourceId: id, title: newDeal.title },
  });

  await fireDealCreated({ tenantId, actorId: userId, deal: newDeal });
  return repo.findDealById(newDeal.id, tenantId);
  });
}

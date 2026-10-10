import { participantOrder, withDealParticipants } from './deal-participants';
import { resolveProducts } from '../leads/lead-automation.service';
import { normalizeProductOther } from '../leads/product-snapshots';
import { salesTransaction, crmScope } from '../leads/lead-automation.service';
import { resolveWonRelationships } from './won-conversion.service';
import type { ClosedWonConfirmation } from '@leadcrm/shared';
import { closingEvidence } from '../closing-requirements/closing-requirements.repository';
import { changeCustomerStatus } from '../engagement.service';
import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { CreateDealDto, UpdateDealDto, DealsQueryParams } from './deals.dto';
import { saveRecordValues, type BatchFiles } from '../closing-requirements/custom-field-values.repository';
import { ValidationError } from '../../../shared/errors/http-error';
import { assertDealStageTransition, dealHasEverBeenWon } from './deal-lifecycle';

// All queries are scoped to tenantId — cross-tenant access is impossible by design

export async function findAllDeals(tenantId: string, params: DealsQueryParams) {
  const { page, limit } = params;
  const skip = (page - 1) * limit;
  if (params.accountId && params.organizationId && params.accountId !== params.organizationId) {
    throw new ValidationError('Account and legacy organization filters must identify the same Account.');
  }
  const accountId = params.accountId ?? params.organizationId;

  // --- Build where clause ---
  const where: Prisma.DealWhereInput = {
    tenantId,
    isArchived: params.archived === 'true',
    ...(params.stageId        ? { stageId: params.stageId }               : {}),
    ...(params.pipelineId     ? { pipelineId: params.pipelineId }         : {}),
    ...(params.priority       ? { priority: params.priority }             : {}),
    ...(params.assignedUserId ? { assignedUserId: params.assignedUserId } : {}),
    ...(accountId             ? { accountId }                           : {}),
    ...(params.contactId      ? { contactDeals: { some: { contactId: params.contactId } } } : {}),
    ...(params.leadId         ? { leadDeals: { some: { leadId: params.leadId } } }          : {}),
    ...(params.search ? { title: { contains: params.search, mode: 'insensitive' as const } } : {}),
    ...(params.dateFrom || params.dateTo ? {
      createdAt: {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo   ? { lte: new Date(params.dateTo) }   : {}),
      },
    } : {}),
  };

  // --- Build orderBy ---
  const orderBy: Prisma.DealOrderByWithRelationInput = params.sortBy
    ? { [params.sortBy]: params.sortOrder }
    : { createdAt: 'desc' };

  const [data, total] = await Promise.all([
    prisma.deal.findMany({
      where, skip, take: limit, orderBy,
      include: {
        stage:        true,
        pipeline:     true,
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        organization: { select: { id: true, name: true } },
        leadDeals: {
          orderBy: participantOrder,
          include: { lead: { select: { id: true, firstName: true, lastName: true } } },
        },
        contactDeals: {
          orderBy: participantOrder,
          include: { contact: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.deal.count({ where }),
  ]);

  return { data: data.map(withDealParticipants), total, page, limit };
}

export async function findDealById(id: string, tenantId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id, tenantId },
    include: {
      stage:        { select: { id: true, name: true, isWon: true, isLost: true, color: true } },
      pipeline:     true,
      organization: true,
      productInterestRecord: { select: { id: true, name: true } },
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      owner:        { select: { id: true, firstName: true, lastName: true, email: true } },
      leadDeals: {
        orderBy: participantOrder,
        include: { lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      },
      contactDeals: { orderBy: participantOrder, include: { contact: true } },
      stageHistories: {
        orderBy: { movedAt: 'desc' },
        take: 20,
        include: {
          newStage:      { select: { id: true, name: true } },
          previousStage: { select: { id: true, name: true } },
          movedBy:       { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  return deal ? withDealParticipants(deal) : null;
}

export async function createDeal(tenantId: string, ownerId: string, dto: CreateDealDto, db: Prisma.TransactionClient = prisma, batchFiles?: BatchFiles) {
  const stage = await db.stage.findFirst({ where: { id: dto.stageId, tenantId, pipelineId: dto.pipelineId } });
  if (!stage || stage.isWon) throw new ValidationError('New Deals require an available open stage. Confirm Closed Won through the stage action.');
  const { leadIds, contactIds, customFieldValues, ...dealData } = dto as CreateDealDto & { leadIds?: string[]; contactIds?: string[] };

  const ids = [...new Set(dto.productInterestIds ?? (dto.productInterestId ? [dto.productInterestId] : []))];
  if (ids.length !== 1 || (dto.productInterestId && dto.productInterestId !== ids[0])) throw new ValidationError('Select exactly one Product Interest per Deal.');
  const [product] = await resolveProducts(db, tenantId, ids);
  dealData.productInterestId = product.id;
  delete dealData.productInterestIds;
  delete dealData.productInterests;
  dealData.value = Number(product.dealValue);
  dealData.currency = 'PHP';
  normalizeProductOther(dealData, [product.name]);
  const deal = await db.deal.create({
    data: { ...dealData, tenantId, ownerId, productsNormalized: true } as never,
  });
  await saveRecordValues(db, tenantId, 'deals', deal.id, customFieldValues, ownerId, batchFiles);

  if (leadIds && leadIds.length > 0) {
    await db.leadDeal.createMany({
      data: [...new Set(leadIds)].map((leadId, position) => ({ position, leadId, dealId: deal.id, tenantId, addedById: ownerId })),
      skipDuplicates: true,
    });
  }

  if (contactIds && contactIds.length > 0) {
    await db.contactDeal.createMany({
      data: [...new Set(contactIds)].map((contactId, position) => ({ position, contactId, dealId: deal.id, tenantId, addedById: ownerId })),
      skipDuplicates: true,
    });
  }

  // Re-fetch with includes so the response contains junction data for the frontend adapter
  const fullDeal = await db.deal.findFirst({
    where: { id: deal.id, tenantId },
    include: {
      stage:        { select: { id: true, name: true, isWon: true, isLost: true, color: true } },
      pipeline:     true,
      organization: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      leadDeals: {
        orderBy: participantOrder,
        include: { lead: { select: { id: true, firstName: true, lastName: true } } },
      },
      contactDeals: {
        orderBy: participantOrder,
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });

  return withDealParticipants(fullDeal!);
}

export async function updateDeal(id: string, tenantId: string, dto: UpdateDealDto, actorId?: string) {
  try {
    await salesTransaction(async tx => {
      const { leadIds: _leadIds, contactIds: _contactIds, customFieldValues, ...updateData } = dto as UpdateDealDto & { leadIds?: string[]; contactIds?: string[] };
      const existing = await tx.deal.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Prisma.PrismaClientKnownRequestError('Deal not found', { code: 'P2025', clientVersion: '5' });
      await saveRecordValues(tx, tenantId, 'deals', id, customFieldValues, actorId);
      const currentIds = existing.productInterestIds.length ? existing.productInterestIds : existing.productInterestId ? [existing.productInterestId] : [];
      if (dto.productInterestIds) {
        const ids = [...new Set(dto.productInterestIds)];
        if (ids.length !== currentIds.length || ids.some(id => !currentIds.includes(id))) throw new ValidationError('A Deal keeps its original Product and value. Create a new Deal for another Product.');
        delete updateData.productInterestIds;
        delete updateData.productInterests;
        // Existing clients submit the read-only preview. It never changes the snapshot.
        delete updateData.value;
        delete updateData.currency;
      } else {
        if (dto.productInterests && JSON.stringify(dto.productInterests) !== JSON.stringify(existing.productInterests)) throw new ValidationError('A Deal keeps its original Product.');
        delete updateData.productInterests;
        if (dto.value !== undefined && dto.value !== existing.value) throw new ValidationError('Deal values are historical snapshots and cannot be overridden.');
        if (dto.currency !== undefined && dto.currency !== existing.currency) throw new ValidationError('Deal currency cannot be overridden.');
      }
      normalizeProductOther(updateData, updateData.productInterests ?? existing.productInterests, existing.productInterestOther);
      await tx.deal.update({ where: { id, tenantId }, data: updateData as never });
      // A rejected relationship rolls back the scalar edit too. Ordered
      // junctions are the only mutable relationship authority.
      if (dto.contactIds !== undefined) await syncContactAssociations(id, tenantId, dto.contactIds, actorId, tx);
      if (dto.leadIds !== undefined) await syncLeadAssociations(id, tenantId, dto.leadIds, actorId, tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }

  // Re-fetch with includes so the response contains junction data for the frontend adapter
  const updated = await prisma.deal.findFirst({
    where: { id, tenantId },
    include: {
      stage:        { select: { id: true, name: true, isWon: true, isLost: true, color: true } },
      pipeline:     true,
      organization: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      leadDeals: {
        orderBy: participantOrder,
        include: { lead: { select: { id: true, firstName: true, lastName: true } } },
      },
      contactDeals: {
        orderBy: participantOrder,
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
  return updated ? withDealParticipants(updated) : null;
}

export async function moveDealStage(
  id: string,
  tenantId: string,
  newStageId: string,
  movedById: string,
  note?: string,
  handoff?: { assignOwnerId?: string; kickoffDate?: string; notes?: string },
  lostReason?: string,
  confirmation?: ClosedWonConfirmation,
  transaction?: Prisma.TransactionClient,
) {
  const transition = async (tx: Prisma.TransactionClient) => {
    const scope = crmScope(tenantId);
    const storedDeal = await tx.deal.findFirst({ where: { id, ...scope }, include: { stage: true,
      leadDeals: { orderBy: participantOrder }, contactDeals: { orderBy: participantOrder } } });
    const deal = storedDeal ? withDealParticipants(storedDeal) : null;
    if (!deal) return null;
    const newStage = await tx.stage.findFirst({ where: { id: newStageId, ...scope, pipelineId: deal.pipelineId } });
    if (!newStage) throw new ValidationError("Stage must belong to this Deal’s pipeline.");
    let stageHistory = null;
    if (deal.stageId !== newStageId) {
      const hasEverBeenWon = await dealHasEverBeenWon(tx, tenantId, deal);
      assertDealStageTransition(deal, newStage, hasEverBeenWon);
      const snapshot = newStage.isWon ? await closingEvidence(tx, tenantId, deal, movedById) : undefined;
      if (newStage.isWon) note = 'All configured Closed Won requirements completed and validated.';
      if (newStage.isLost && !lostReason?.trim()) throw new ValidationError('Lost reason is required.');
      const missing = newStage.requiredFields.filter(field => {
        const value = (deal as Record<string, unknown>)[field];
        return value == null || value === '' || Array.isArray(value) && !value.length;
      });
      if (missing.length) throw new ValidationError(`Missing stage requirements: ${missing.join(', ')}`);
      const now = new Date();
      const previous = await tx.dealStageHistory.findFirst({ where: { ...scope, dealId: id }, orderBy: { movedAt: 'desc' } });
      await tx.deal.update({ where: { id, ...scope }, data: { stageId: newStageId,
        hasEverBeenWon: hasEverBeenWon || newStage.isWon,
        ...(hasEverBeenWon || newStage.isWon ? { wonHistoryVerified: true } : {}),
        stageChangedAt: now,
        closedAt: newStage.isWon || newStage.isLost ? now : null, lostReason: newStage.isLost ? lostReason : null,
        ...(newStage.isWon ? { closingSnapshot: snapshot, wonConfirmedById: movedById, wonConfirmedAt: now } : {}) } });
      if (newStage.isWon) {
        await resolveWonRelationships(tx, deal, movedById);
        const leads = await tx.leadDeal.findMany({ where: { tenantId, dealId: id } });
        const contacts = await tx.contactDeal.findMany({ where: { tenantId, dealId: id } });
        for (const leadId of new Set(leads.map(link => link.leadId))) await changeCustomerStatus(tx, tenantId, movedById, { leadId }, 'Closed', note!, now);
        for (const contactId of new Set(contacts.map(link => link.contactId))) await changeCustomerStatus(tx, tenantId, movedById, { contactId }, 'Closed', note!, now);
      }
      stageHistory = await tx.dealStageHistory.create({ data: { ...scope, dealId: id, previousStageId: deal.stageId, newStageId, movedById,
        movedAt: now, note, timeInPrevStage: Math.floor((now.getTime() - (previous?.movedAt ?? deal.createdAt).getTime()) / 60000) } });
      await tx.activity.create({ data: { ...scope, dealId: id, createdById: movedById, type: 'stage_change',
        title: `Deal moved from "${deal.stage.name}" to "${newStage.name}"`, description: note ?? lostReason ?? 'Staff changed the Deal stage.' } });
    }
    const fullDeal = await tx.deal.findFirstOrThrow({ where: { id, ...scope }, include: {
      stage: true, pipeline: true, organization: true, assignedUser: { select: { id: true, firstName: true, lastName: true } },
      leadDeals: { orderBy: participantOrder, include: { lead: true } }, contactDeals: { orderBy: participantOrder, include: { contact: true } },
      stageHistories: { orderBy: { movedAt: 'desc' }, take: 20, include: {
        newStage: { select: { id: true, name: true } }, previousStage: { select: { id: true, name: true } },
        movedBy: { select: { id: true, firstName: true, lastName: true } },
      } },
    } });
    return { deal: withDealParticipants(fullDeal), stageHistory, previousDeal: deal };
  };
  return transaction ? transition(transaction) : salesTransaction(transition);
}

export async function archiveDeal(id: string, tenantId: string, archiveReason?: string) {
  try {
    return await prisma.deal.update({ where: { id, tenantId }, data: { isArchived: true, archiveReason: archiveReason ?? null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }
}

export interface StageGroupResult {
  stageId: string;
  deals: unknown[];
  total: number;
  page: number;
  hasMore: boolean;
}

export async function findDealsGroupedByStage(
  tenantId: string,
  pipelineId: string,
  stagePageMap?: Record<string, number>,
): Promise<StageGroupResult[]> {
  const PAGE_SIZE = 20;

  // Get all stages for this pipeline, scoped to tenant
  const stages = await prisma.stage.findMany({
    where: { pipelineId, tenantId },
    select: { id: true },
    orderBy: { order: 'asc' },
  });

  const results: StageGroupResult[] = [];

  for (const stage of stages) {
    const page = stagePageMap?.[stage.id] ?? 1;
    const skip = (page - 1) * PAGE_SIZE;

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where: { tenantId, stageId: stage.id, pipelineId, isArchived: false },
        skip,
        take: PAGE_SIZE,
        orderBy: { createdAt: 'desc' },
        include: {
          stage: true,
          assignedUser: { select: { id: true, firstName: true, lastName: true } },
          organization: { select: { id: true, name: true } },
          contactDeals: { orderBy: participantOrder, include: { contact: { select: { id: true, firstName: true, lastName: true } } } },
          leadDeals: {
            orderBy: participantOrder,
            include: { lead: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      }),
      prisma.deal.count({
        where: { tenantId, stageId: stage.id, pipelineId, isArchived: false },
      }),
    ]);

    results.push({
      stageId: stage.id,
      deals: deals.map(withDealParticipants),
      total,
      page,
      hasMore: total > page * PAGE_SIZE,
    });
  }

  return results;
}

/**
 * Sync a deal's Contact associations to exactly `contactIds` (set-equality) via the
 * ContactDeal junction. New IDs are validated against the Contact table within the tenant.
 */
export async function syncContactAssociations(
  dealId: string, tenantId: string, contactIds: string[], userId?: string, client?: Prisma.TransactionClient
): Promise<void> {
  const work = async (tx: Prisma.TransactionClient) => {
    await tx.deal.findFirstOrThrow({ where: { id: dealId, tenantId }, select: { id: true } });
    // Current ContactDeal associations for this deal
    const current = await tx.contactDeal.findMany({
      where: { dealId, tenantId },
      select: { contactId: true },
    });
    const currentIds = new Set(current.map(c => c.contactId));
    const targetIds = new Set(contactIds);

    // Remove associations no longer in the target set
    const toRemove = [...currentIds].filter(id => !targetIds.has(id));
    if (toRemove.length > 0) {
      await tx.contactDeal.deleteMany({
        where: { dealId, tenantId, contactId: { in: toRemove } },
      });
    }

    // Add new associations
    const toAdd = [...targetIds].filter(id => !currentIds.has(id));
    if (toAdd.length > 0) {
      // Verify all new contacts belong to the tenant
      const validContacts = await tx.contact.findMany({
        where: { id: { in: toAdd }, tenantId },
        select: { id: true },
      });
      const validIds = new Set(validContacts.map(c => c.id));
      const invalidIds = toAdd.filter(id => !validIds.has(id));

      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid contact IDs: ${invalidIds.join(', ')}`);
      }

      await tx.contactDeal.createMany({
        data: toAdd.map(contactId => ({ contactId, dealId, tenantId, position: [...targetIds].indexOf(contactId), addedById: userId })),
        skipDuplicates: true,
      });
    }
    for (const [position, contactId] of [...targetIds].entries()) {
      if (currentIds.has(contactId)) await tx.contactDeal.updateMany({ where: { dealId, tenantId, contactId }, data: { position } });
    }
  };
  if (client) await work(client);
  else await salesTransaction(work);
}

/**
 * Sync a deal's Lead associations to exactly `leadIds` (set-equality) via the LeadDeal
 * junction. New IDs are validated against the Lead table within the tenant.
 */
export async function syncLeadAssociations(
  dealId: string, tenantId: string, leadIds: string[], userId?: string, client?: Prisma.TransactionClient
): Promise<void> {
  const work = async (tx: Prisma.TransactionClient) => {
    await tx.deal.findFirstOrThrow({ where: { id: dealId, tenantId }, select: { id: true } });
    // Current LeadDeal associations for this deal
    const current = await tx.leadDeal.findMany({
      where: { dealId, tenantId },
      select: { leadId: true },
    });
    const currentIds = new Set(current.map(c => c.leadId));
    const targetIds = new Set(leadIds);

    // Remove associations no longer in the target set
    const toRemove = [...currentIds].filter(id => !targetIds.has(id));
    if (toRemove.length > 0) {
      await tx.leadDeal.deleteMany({
        where: { dealId, tenantId, leadId: { in: toRemove } },
      });
    }

    // Add new associations
    const toAdd = [...targetIds].filter(id => !currentIds.has(id));
    if (toAdd.length > 0) {
      // Verify all new leads belong to the tenant
      const validLeads = await tx.lead.findMany({
        where: { id: { in: toAdd }, tenantId },
        select: { id: true },
      });
      const validIds = new Set(validLeads.map(c => c.id));
      const invalidIds = toAdd.filter(id => !validIds.has(id));

      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid lead IDs: ${invalidIds.join(', ')}`);
      }

      await tx.leadDeal.createMany({
        data: toAdd.map(leadId => ({ leadId, dealId, tenantId, position: [...targetIds].indexOf(leadId), addedById: userId })),
        skipDuplicates: true,
      });
    }
    for (const [position, leadId] of [...targetIds].entries()) {
      if (currentIds.has(leadId)) await tx.leadDeal.updateMany({ where: { dealId, tenantId, leadId }, data: { position } });
    }
  };
  if (client) await work(client);
  else await salesTransaction(work);
}

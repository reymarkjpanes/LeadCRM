import { resolveProducts } from '../leads/lead-automation.service';
import { validateProductSnapshots, normalizeProductOther } from '../leads/product-snapshots';
import { salesTransaction, crmScope } from '../leads/lead-automation.service';
import { resolveWonRelationships } from './won-conversion.service';
import type { ClosedWonConfirmation } from '@leadcrm/shared';
import { closingEvidence } from '../closing-requirements/closing-requirements.repository';
import { changeCustomerStatus } from '../engagement.service';
import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { CreateDealDto, UpdateDealDto, DealsQueryParams } from './deals.dto';
import { ValidationError } from '../../../shared/errors/http-error';
import { assertDealStageTransition, dealHasEverBeenWon } from './deal-lifecycle';

// All queries are scoped to tenantId — cross-tenant access is impossible by design

export async function findAllDeals(tenantId: string, params: DealsQueryParams) {
  const { page, limit } = params;
  const skip = (page - 1) * limit;

  // --- Build where clause ---
  const where: Prisma.DealWhereInput = {
    tenantId,
    isArchived: params.archived === 'true',
    ...(params.stageId        ? { stageId: params.stageId }               : {}),
    ...(params.pipelineId     ? { pipelineId: params.pipelineId }         : {}),
    ...(params.priority       ? { priority: params.priority }             : {}),
    ...(params.assignedUserId ? { assignedUserId: params.assignedUserId } : {}),
    ...(params.organizationId ? { accountId: params.organizationId }     : {}),
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
          include: { lead: { select: { id: true, firstName: true, lastName: true } } },
        },
        contactDeals: {
          include: { contact: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.deal.count({ where }),
  ]);

  return { data, total, page, limit };
}

export async function findDealById(id: string, tenantId: string) {
  return prisma.deal.findFirst({
    where: { id, tenantId },
    include: {
      stage:        { select: { id: true, name: true, isWon: true, isLost: true, color: true } },
      pipeline:     true,
      organization: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      owner:        { select: { id: true, firstName: true, lastName: true, email: true } },
      leadDeals: {
        include: { lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      },
      contactDeals: { include: { contact: true } },
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
}

export async function createDeal(tenantId: string, ownerId: string, dto: CreateDealDto, db: Prisma.TransactionClient = prisma) {
  const stage = await db.stage.findFirst({ where: { id: dto.stageId, tenantId, pipelineId: dto.pipelineId } });
  if (!stage || stage.isWon) throw new ValidationError('New Deals require an available open stage. Confirm Closed Won through the stage action.');
  const { leadIds, contactIds, ...dealData } = dto as CreateDealDto & { leadIds?: string[]; contactIds?: string[] };

  if (dto.productInterestIds?.length || dto.productInterestId) {
    const products = await resolveProducts(db, tenantId, dto.productInterestIds ?? [dto.productInterestId!]);
    dealData.productInterestIds = products.map(p => p.id);
    dealData.productInterestId = products[0].id;
    dealData.productInterests = products.map(p => p.name);
    dealData.value = products.reduce((sum, p) => sum + Math.round(Number(p.dealValue) * 100), 0) / 100;
    if (dealData.value > 999_999_999_999) throw new ValidationError('Combined product value exceeds the maximum.');
    dealData.currency = 'PHP';
  } else {
    // Trusted imports retain their independent historical value contract.
    dealData.productInterests = await validateProductSnapshots(tenantId, dto.productInterests, [], db);
  }
  const deal = await db.deal.create({
    data: { ...dealData, tenantId, ownerId } as never,
  });

  if (leadIds && leadIds.length > 0) {
    await db.leadDeal.createMany({
      data: leadIds.map((leadId) => ({ leadId, dealId: deal.id, tenantId, addedById: ownerId })),
      skipDuplicates: true,
    });
  }

  if (contactIds && contactIds.length > 0) {
    await db.contactDeal.createMany({
      data: contactIds.map((contactId) => ({ contactId, dealId: deal.id, tenantId, addedById: ownerId })),
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
        include: { lead: { select: { id: true, firstName: true, lastName: true } } },
      },
      contactDeals: {
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });

  return fullDeal!;
}

export async function updateDeal(id: string, tenantId: string, dto: UpdateDealDto) {
  try {
    await salesTransaction(async tx => {
      const { leadIds: _leadIds, contactIds: _contactIds, ...updateData } = dto as UpdateDealDto & { leadIds?: string[]; contactIds?: string[] };
      const existing = await tx.deal.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Prisma.PrismaClientKnownRequestError('Deal not found', { code: 'P2025', clientVersion: '5' });
      const currentIds = existing.productInterestIds.length ? existing.productInterestIds : existing.productInterestId ? [existing.productInterestId] : [];
      if (dto.productInterestIds) {
        const ids = [...new Set(dto.productInterestIds)];
        const changed = ids.length !== currentIds.length || ids.some(id => !currentIds.includes(id));
        if (changed) {
          const products = await resolveProducts(tx, tenantId, ids);
          updateData.productInterestIds = products.map(p => p.id);
          Object.assign(updateData, { productInterestId: products[0].id, productInterests: products.map(p => p.name), currency: 'PHP', value: products.reduce((sum, p) => sum + Math.round(Number(p.dealValue) * 100), 0) / 100 });
          if (updateData.value! > 999_999_999_999) throw new ValidationError('Combined product value exceeds the maximum.');
        } else {
          delete updateData.productInterestIds;
          delete updateData.productInterests;
          delete updateData.value;
          delete updateData.currency;
        }
      } else {
        if (currentIds.length && dto.productInterests && JSON.stringify(dto.productInterests) !== JSON.stringify(existing.productInterests)) throw new ValidationError('Update Product Interests using catalog IDs.');
        updateData.productInterests = await validateProductSnapshots(tenantId, dto.productInterests, existing.productInterests, tx);
        if (currentIds.length && dto.value !== undefined && dto.value !== existing.value) throw new ValidationError('Product-linked Deal values cannot be overridden.');
        if (currentIds.length && dto.currency !== undefined && dto.currency !== existing.currency) throw new ValidationError('Product-linked Deal currency cannot be overridden.');
      }
      normalizeProductOther(updateData, updateData.productInterests ?? existing.productInterests, existing.productInterestOther);
      await tx.deal.update({ where: { id, tenantId }, data: updateData as never });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null;
    }
    throw error;
  }

  // Re-fetch with includes so the response contains junction data for the frontend adapter
  return prisma.deal.findFirst({
    where: { id, tenantId },
    include: {
      stage:        { select: { id: true, name: true, isWon: true, isLost: true, color: true } },
      pipeline:     true,
      organization: true,
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      leadDeals: {
        include: { lead: { select: { id: true, firstName: true, lastName: true } } },
      },
      contactDeals: {
        include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
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
    const deal = await tx.deal.findFirst({ where: { id, ...scope }, include: { stage: true } });
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
        for (const leadId of new Set([deal.leadId, ...leads.map(link => link.leadId)].filter((value): value is string => !!value))) await changeCustomerStatus(tx, tenantId, movedById, { leadId }, 'Closed', note!, now);
        for (const contactId of new Set([deal.contactId, ...contacts.map(link => link.contactId)].filter((value): value is string => !!value))) await changeCustomerStatus(tx, tenantId, movedById, { contactId }, 'Closed', note!, now);
      }
      stageHistory = await tx.dealStageHistory.create({ data: { ...scope, dealId: id, previousStageId: deal.stageId, newStageId, movedById,
        movedAt: now, note, timeInPrevStage: Math.floor((now.getTime() - (previous?.movedAt ?? deal.createdAt).getTime()) / 60000) } });
      await tx.activity.create({ data: { ...scope, dealId: id, createdById: movedById, type: 'stage_change',
        title: `Deal moved from "${deal.stage.name}" to "${newStage.name}"`, description: note ?? lostReason ?? 'Staff changed the Deal stage.' } });
    }
    const fullDeal = await tx.deal.findFirstOrThrow({ where: { id, ...scope }, include: {
      stage: true, pipeline: true, organization: true, assignedUser: { select: { id: true, firstName: true, lastName: true } },
      leadDeals: { include: { lead: true } }, contactDeals: { include: { contact: true } },
      stageHistories: { orderBy: { movedAt: 'desc' }, take: 20, include: {
        newStage: { select: { id: true, name: true } }, previousStage: { select: { id: true, name: true } },
        movedBy: { select: { id: true, firstName: true, lastName: true } },
      } },
    } });
    return { deal: fullDeal, stageHistory, previousDeal: deal };
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
          leadDeals: {
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
      deals,
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
  dealId: string, tenantId: string, contactIds: string[], userId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
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
        data: toAdd.map(contactId => ({ contactId, dealId, tenantId, addedById: userId })),
        skipDuplicates: true,
      });
    }
  });
}

/**
 * Sync a deal's Lead associations to exactly `leadIds` (set-equality) via the LeadDeal
 * junction. New IDs are validated against the Lead table within the tenant.
 */
export async function syncLeadAssociations(
  dealId: string, tenantId: string, leadIds: string[], userId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
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
        data: toAdd.map(leadId => ({ leadId, dealId, tenantId, addedById: userId })),
        skipDuplicates: true,
      });
    }
  });
}

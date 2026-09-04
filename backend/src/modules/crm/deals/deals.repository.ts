import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { CreateDealDto, UpdateDealDto, DealsQueryParams } from './deals.dto';
import { ValidationError } from '../../../shared/errors/http-error';

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

export async function createDeal(tenantId: string, ownerId: string, dto: CreateDealDto) {
  const { leadIds, contactIds, ...dealData } = dto as CreateDealDto & { leadIds?: string[]; contactIds?: string[] };

  const deal = await prisma.deal.create({
    data: { ...dealData, tenantId, ownerId } as never,
  });

  if (leadIds && leadIds.length > 0) {
    await prisma.leadDeal.createMany({
      data: leadIds.map((leadId) => ({ leadId, dealId: deal.id, tenantId, addedById: ownerId })),
      skipDuplicates: true,
    });
  }

  if (contactIds && contactIds.length > 0) {
    await prisma.contactDeal.createMany({
      data: contactIds.map((contactId) => ({ contactId, dealId: deal.id, tenantId, addedById: ownerId })),
      skipDuplicates: true,
    });
  }

  // Re-fetch with includes so the response contains junction data for the frontend adapter
  const fullDeal = await prisma.deal.findFirst({
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
  const { leadIds: _leadIds, contactIds: _contactIds, ...updateData } = dto as UpdateDealDto & { leadIds?: string[]; contactIds?: string[] };
  try {
    await prisma.deal.update({ where: { id, tenantId }, data: updateData as never });
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
) {
  const deal = await prisma.deal.findFirst({
    where: { id, tenantId },
    include: { stage: true, organization: true, leadDeals: true },
  });
  if (!deal) return null;

  // SEC-1: stage must belong to same tenant
  const newStage = await prisma.stage.findFirst({ where: { id: newStageId, tenantId } });
  if (!newStage) return null;

  const now = new Date();

  const lastHistory = await prisma.dealStageHistory.findFirst({
    where: { dealId: id, tenantId },
    orderBy: { movedAt: 'desc' },
  });
  const referenceTime = lastHistory ? lastHistory.movedAt : deal.createdAt;
  const timeInPrevStage = Math.floor((now.getTime() - referenceTime.getTime()) / (1000 * 60));

  // Determine valid previous stage ID (prevent P2003 if stage was deleted)
  let validPrevStageId = null;
  if (deal.stageId) {
    const prevStageExists = await prisma.stage.findFirst({ where: { id: deal.stageId } });
    if (prevStageExists) validPrevStageId = deal.stageId;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedDeal = await tx.deal.update({
      where: { id },
      data: {
        stageId:    newStageId,
        pipelineId: newStage.pipelineId,
        ...(newStage.isWon || newStage.isLost ? { closedAt: now } : { closedAt: null }),
        ...(newStage.isLost ? { lostReason } : { lostReason: null }),
      },
    });

    const stageHistory = await tx.dealStageHistory.create({
      data: {
        tenantId, dealId: id,
        previousStageId: validPrevStageId, newStageId, movedById,
        movedAt: now, timeInPrevStage, note,
      },
    });

    const oldStageName = deal.stage?.name ?? 'Unknown';

    // Activity for every stage change
    await tx.activity.create({
      data: {
        tenantId, createdById: movedById,
        type:  'stage_change',
        title: `Deal moved from "${oldStageName}" to "${newStage.name}"`,
        dealId: deal.id,
        // Remove accountId to prevent P2003 if account is deleted or invalid; activity is linked to deal
      },
    });

    // Post-sale handoff on Won
    if (newStage.isWon) {
      const activeProducts = deal.productInterests || [];

      if (deal.accountId && deal.organization) {
        const org = deal.organization;
        const updatedProducts = Array.from(new Set([...(org.activeProducts || []), ...activeProducts]));
        await tx.account.update({
          where: { id: deal.accountId },
          data: {
            customerType:   'Active Customer',
            customerSince:  org.customerSince || now,
            activeProducts: updatedProducts,
          },
        });
      }

      if (deal.leadDeals.length > 0) {
        // Single query instead of N findUnique+update pairs
        await tx.lead.updateMany({
          where: { id: { in: deal.leadDeals.map((ld) => ld.leadId) } },
          data: { status: 'Active Customer' },
        });
      }
    }

    return { deal: updatedDeal, stageHistory };
  });

  // Re-fetch with full includes so frontend adapter can extract junction data
  const fullDeal = await prisma.deal.findFirst({
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

  return { deal: fullDeal!, stageHistory: result.stageHistory };
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

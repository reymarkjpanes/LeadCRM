import { Prisma } from '@prisma/client';
import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { CreateActivityDto, UpdateActivityDto } from './activities.dto';

// ─── Shared include ───────────────────────────────────────────────────────────

const ACTIVITY_INCLUDE = {
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List activities for a tenant with optional filters.
 *
 * Supported query params:
 *   leadId      — filter by linked lead
 *   dealId      — filter by linked deal
 *   accountId   — filter by linked account
 *   taskId      — filter by linked task
 *   type        — filter by activity type (e.g. "call", "stage_change")
 *   createdById — filter by the user who created the activity
 *   dateFrom    — ISO date string — return activities on or after this date
 *   dateTo      — ISO date string — return activities on or before this date
 *   page        — 1-based page number (default 1)
 *   limit       — results per page (default 20, max 100)
 *
 * All queries are tenant-scoped — tenantId is always enforced.
 * Results are ordered by createdAt DESC (newest first).
 */
export async function findAllActivities(
  tenantId: string,
  query: Record<string, unknown>,
) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  const where: Prisma.ActivityWhereInput = { tenantId };

  // ── Entity filters ──────────────────────────────────────────────────────────
  // Note: the Activity model uses leadId (not contactId) for the Lead FK.
  if (query.leadId)    where.leadId    = String(query.leadId);
  if (query.dealId)    where.dealId    = String(query.dealId);
  if (query.accountId) where.accountId = String(query.accountId);
  if (query.taskId)    where.taskId    = String(query.taskId);

  // ── Type filter ─────────────────────────────────────────────────────────────
  if (query.type) where.type = String(query.type);

  // ── User filter ─────────────────────────────────────────────────────────────
  if (query.createdById) where.createdById = String(query.createdById);

  // ── Date range filter ────────────────────────────────────────────────────────
  // Uses the @@index([tenantId, createdAt]) index for efficient range scans.
  const dateFrom = query.dateFrom ? new Date(String(query.dateFrom)) : null;
  const dateTo   = query.dateTo   ? new Date(String(query.dateTo))   : null;

  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom && !isNaN(dateFrom.getTime()) ? { gte: dateFrom } : {}),
      ...(dateTo   && !isNaN(dateTo.getTime())   ? { lte: dateTo }   : {}),
    };
  }

  const [data, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      skip,
      take:     limit,
      orderBy:  { createdAt: 'desc' },
      include:  ACTIVITY_INCLUDE,
    }),
    prisma.activity.count({ where }),
  ]);

  return { data, total, page, limit };
}

export async function findActivityById(id: string, tenantId: string) {
  return prisma.activity.findFirst({
    where:   { id, tenantId },
    include: ACTIVITY_INCLUDE,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createActivity(
  tenantId:    string,
  createdById: string,
  dto:         CreateActivityDto,
) {
  return prisma.activity.create({
    data:    { ...dto, tenantId, createdById },
    include: ACTIVITY_INCLUDE,
  });
}

export async function updateActivity(
  id:       string,
  tenantId: string,
  dto:      UpdateActivityDto,
) {
  try {
    return await prisma.activity.update({
      where:   { id, tenantId },
      data:    dto,
      include: ACTIVITY_INCLUDE,
    });
  } catch {
    return null;
  }
}

export async function deleteActivity(id: string, tenantId: string) {
  try {
    return await prisma.activity.delete({ where: { id, tenantId } });
  } catch {
    return null;
  }
}

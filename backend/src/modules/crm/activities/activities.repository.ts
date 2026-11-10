import { Prisma } from '@prisma/client';
import { crmActor, crmPolicyReadWhere, resolveCrmActor } from '../access/crm-record-access.service';
import { hasModulePermission } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { presentAssignmentActivities } from '../../notifications/assignment-presentation';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { CreateActivityDto, UpdateActivityDto } from './activities.dto';
import { AppError } from '../../../shared/errors/app-error';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { authorizedMailbox } from '../../../integrations/gmail/mailbox-store';
import { mailboxDealMessageIds } from '../../../integrations/gmail/mailbox-conversations';
import { activityReadAccess, recheckActivityReadAccess } from './activity-read-access';

/** Apply before search/count/pagination so CRM timelines cannot reveal revoked email details. */
export async function emailActivityVisibility(tenantId: string): Promise<Prisma.ActivityWhereInput> {
  return (await activityReadAccess(tenantId)).where;
}

async function taskVisibility(tenantId: string): Promise<Prisma.ActivityWhereInput> {
  const actor = crmActor.getStore();
  if (!actor) return {};
  const policy = await resolveCrmActor(prisma, actor);
  if (policy.clientAdmin || hasModulePermission(policy.permissions, 'tasks', 'canView')) return {};
  return { taskId: null, type: { not: 'task' } };
}

/** Frozen event context is independent of today's Deal participants. */
export function activityRecordContext(kind: 'lead' | 'contact' | 'account' | 'deal', id: string, tenantId: string): Prisma.ActivityWhereInput {
  return { OR: [
    { [`${kind}Id`]: id },
    { type: 'task', metadata: { path: ['taskEvent', 'context', `${kind}Ids`], array_contains: [id] } },
    ...(kind === 'contact' ? [{ lead: { tenantId, contactId: id, convertedAt: { not: null } } }] : []),
  ] };
}

/** Keep stored events; validate email Deal context through the original mailbox. */
export async function dealActivityContext(tenantId: string, id: string): Promise<Prisma.ActivityWhereInput> {
  const nonEmail: Prisma.ActivityWhereInput = { AND: [{ type: { not: 'email' } }, activityRecordContext('deal', id, tenantId)] };
  const actor = crmActor.getStore();
  if (!actor || actor.tenantId !== tenantId) return nonEmail;
  const policy = await resolveCrmActor(prisma, actor);
  if (policy.clientAdmin || policy.activityReadScope === 'managed-groups') return activityRecordContext('deal', id, tenantId);
  try {
    const { account, scope } = await authorizedMailbox(tenantId, actor.userId);
    return { OR: [nonEmail, { type: 'email', mailboxMessageId: { in: await mailboxDealMessageIds(account, scope, id, true) } }] };
  } catch (error) { if (error instanceof AppError && error.statusCode < 500) return nonEmail; throw error; }
}

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

  const emailAccess = await activityReadAccess(tenantId, query);
  const where: Prisma.ActivityWhereInput = { tenantId, AND: [await taskVisibility(tenantId), emailAccess.where] };

  // ── Entity filters ──────────────────────────────────────────────────────────
  // Note: the Activity model uses leadId (not contactId) for the Lead FK.
  for (const kind of ['lead', 'contact', 'account', 'deal'] as const) {
    if (query[`${kind}Id`]) (where.AND as Prisma.ActivityWhereInput[]).push(kind === 'deal' ? await dealActivityContext(tenantId, String(query.dealId)) : activityRecordContext(kind, String(query[`${kind}Id`]), tenantId));
  }
  if (query.taskId)    where.taskId    = String(query.taskId);

  // ── Type filter ─────────────────────────────────────────────────────────────
  if (query.type) where.type = { in: String(query.type).split(',') };
  (where.AND as Prisma.ActivityWhereInput[]).push(...buildSearchClauses(query.search, ['title', 'description'], contains => [
    { createdBy: { firstName: contains } }, { createdBy: { lastName: contains } },
  ]));

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

  const totalWhere = { ...where };
  if (query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
      if (!cursor || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 128 || typeof cursor.createdAt !== 'string') throw new Error('cursor');
      const date = new Date(cursor.createdAt);
      if (!Number.isFinite(date.getTime())) throw new Error('cursor');
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: [
        { createdAt: { lt: date } }, { createdAt: date, id: { lt: cursor.id } },
      ] }];
    } catch { throw new AppError('Invalid activity cursor', 400); }
  }
  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      skip: query.cursor ? 0 : skip,
      take:     limit + 1,
      orderBy:  [{ createdAt: 'desc' }, { id: 'desc' }],
      include:  ACTIVITY_INCLUDE,
    }),
    prisma.activity.count({ where: totalWhere }),
  ]);

  const data = rows.slice(0, limit);
  const last = data.at(-1);
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  const hydrated = await presentActivities(tenantId, data);
  // Dropping revoked rows alone would still expose their old total or cursor.
  await recheckActivityReadAccess(tenantId, emailAccess);
  return { data: hydrated, total, page, limit, nextCursor };
}

export async function presentActivities<T extends Parameters<typeof withEmailContent>[1][number]>(tenantId: string, activities: T[]): Promise<T[]> {
  const rows = await withEmailContent(tenantId, activities);
  return presentAssignmentActivities(tenantId, await presentTaskHistoryContext(tenantId, rows));
}

const jsonObject = (value: Prisma.JsonValue | undefined): Prisma.JsonObject | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.JsonObject : undefined;

/** Keep immutable Task evidence stored, while exposing only currently authorized CRM references. */
async function presentTaskHistoryContext<T extends { type: string; metadata?: Prisma.JsonValue }>(tenantId: string, rows: T[]): Promise<T[]> {
  const actor = crmActor.getStore();
  const events = rows.map(row => row.type === 'task' ? jsonObject(jsonObject(row.metadata)?.taskEvent) : undefined);
  if (!actor || !events.some(Boolean)) return rows;
  const policy = await resolveCrmActor(prisma, actor);
  if (policy.clientAdmin) return rows;
  const paths = ['before', 'after', 'context'];
  const modules = { leadIds: 'leads', contactIds: 'contacts', accountIds: 'accounts', dealIds: 'deals' } as const;
  const delegates = { leads: prisma.lead, contacts: prisma.contact, accounts: prisma.account, deals: prisma.deal };
  const visible = new Map(await Promise.all(Object.entries(modules).map(async ([field, module]) => {
    const ids = [...new Set(events.flatMap(event => paths.flatMap(path => {
      const values = jsonObject(event?.[path])?.[field];
      return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
    })))];
    const records = ids.length ? await (delegates[module] as typeof prisma.lead).findMany({
      where: { tenantId, id: { in: ids }, AND: [crmPolicyReadWhere(policy, module)] }, select: { id: true },
    }) : [];
    return [field, new Set(records.map(record => record.id))] as const;
  })));
  return rows.map((row, index) => {
    const event = events[index];
    if (!event) return row;
    const projected = { ...event };
    for (const path of paths) {
      const state = jsonObject(event[path]);
      if (!state) continue;
      const snapshot = { ...state };
      for (const [field, ids] of visible) {
        const values = state[field];
        if (Array.isArray(values)) snapshot[field] = values.filter((value): value is string => typeof value === 'string' && ids.has(value));
      }
      projected[path] = snapshot;
    }
    return { ...row, metadata: { ...jsonObject(row.metadata), taskEvent: projected } };
  });
}

/** Resolve provider content on read, including older email activities, without copying bodies into history. */
export async function withEmailContent<T extends { type: string; tenantId?: string; mailboxMessageId?: string | null; metadata?: Prisma.JsonValue; leadId?: string | null; contactId?: string | null }>(tenantId: string, activities: T[]) {
  activities = activities.filter(activity => !activity.tenantId || activity.tenantId === tenantId);
  const messageId = (activity: T) => activity.mailboxMessageId;
  const ids = [...new Set(activities.filter(a => a.type === 'email').map(messageId).filter((id): id is string => typeof id === 'string'))];
  if (!ids.length) return activities.filter(activity => activity.type !== 'email');
  const access = await activityReadAccess(tenantId);
  if (!access.messages) return activities.filter(activity => activity.type !== 'email');
  const messages = await prisma.mailboxMessage.findMany({ where: { AND: [access.messages, { id: { in: ids } }] } });
  // A reassignment can commit while the body query is awaiting the database.
  try {
    await recheckActivityReadAccess(tenantId, access);
  } catch (error) {
    if (error instanceof AppError && error.statusCode < 500) return activities.filter(activity => activity.type !== 'email');
    throw error;
  }
  return activities.flatMap(activity => {
    const metadata = activity.metadata as Record<string, Prisma.JsonValue> | null;
    const message = activity.type === 'email' ? messages.find(m => m.id === messageId(activity)) : undefined;
    if (activity.type === 'email' && !message) return [];
    return [message ? { ...activity, metadata: { ...metadata, mailboxMessageId: message.id, email: { id: message.id, providerMessageId: message.providerMessageId, threadId: message.threadId, accountId: message.accountId, direction: message.direction, from: message.from, to: message.recipients, subject: message.subject, sentAt: message.sentAt.toISOString(), body: message.body } } } : activity];
  });
}

export async function findActivityById(id: string, tenantId: string) {
  const access = await activityReadAccess(tenantId);
  const activity = await prisma.activity.findFirst({
    where:   { id, tenantId, AND: [await taskVisibility(tenantId), access.where] },
    include: ACTIVITY_INCLUDE,
  });
  if (!activity) return null;
  const [visible] = await presentActivities(tenantId, [activity]);
  if (!visible) return null;
  try { await recheckActivityReadAccess(tenantId, access); }
  catch (error) { if (error instanceof AppError && error.statusCode < 500) return null; throw error; }
  return visible ?? null;
}

/** Relationship previews share exactly the list's authorization and hydration boundaries. */
export async function findRecentActivities(tenantId: string, kind: 'lead' | 'contact' | 'account' | 'deal', id: string, limit: number, includeTasks: boolean) {
  const access = await activityReadAccess(tenantId, { [`${kind}Id`]: id });
  const rows = await prisma.activity.findMany({
    where: { tenantId, AND: [access.where, await taskVisibility(tenantId),
      kind === 'deal' ? await dealActivityContext(tenantId, id) : activityRecordContext(kind, id, tenantId),
      ...(includeTasks ? [] : [{ taskId: null, type: { not: 'task' } }])] },
    take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { ...ACTIVITY_INCLUDE, id: true, tenantId: true, type: true, title: true, createdAt: true,
      metadata: true, mailboxMessageId: true, description: true, leadId: true, contactId: true },
  });
  const activities = await presentActivities(tenantId, rows);
  await recheckActivityReadAccess(tenantId, access);
  return activities;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createActivity(
  tenantId:    string,
  createdById: string,
  dto:         CreateActivityDto,
  db: Prisma.TransactionClient = prisma,
) {
  return db.activity.create({
    data:    { ...dto, tenantId, createdById, createdAt: new Date() },
    include: ACTIVITY_INCLUDE,
  });
}

export async function updateActivity(
  id:       string,
  tenantId: string,
  dto:      UpdateActivityDto,
  db: Prisma.TransactionClient = prisma,
) {
  try {
    return await db.activity.update({
      where:   { id, tenantId },
      data:    dto,
      include: ACTIVITY_INCLUDE,
    });
  } catch {
    return null;
  }
}

export async function deleteActivity(id: string, tenantId: string, db: Prisma.TransactionClient = prisma) {
  try {
    return await db.activity.delete({ where: { id, tenantId } });
  } catch {
    return null;
  }
}

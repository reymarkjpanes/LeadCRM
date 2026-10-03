import { compareSortValues, ArchiveQuerySchema, ArchiveRestoreParamsSchema, ARCHIVE_TYPES, type ArchivedRecord, type ArchiveType } from '@leadcrm/shared';
import type { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { assertPermissions } from '../../../core/permissions/permission.service';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { AppError } from '../../../shared/errors/app-error';
import type { PermissionKey } from '../../../shared/constants/permissions';

type Actor = { userId: string; tenantId: string; role: string };
const permissions: Record<ArchiveType | z.infer<typeof ArchiveRestoreParamsSchema>['type'], [PermissionKey, PermissionKey]> = {
  Task: ['tasks.view', 'archived_data.restore'],
  Lead: ['leads.view', 'archived_data.restore'], Contact: ['contacts.view', 'archived_data.restore'],
  Account: ['accounts.view', 'archived_data.restore'], Deal: ['deals.view', 'archived_data.restore'],
  Pipeline: ['deals.view', 'archived_data.restore'], User: ['users.view', 'archived_data.restore'],
  Role: ['roles.view', 'archived_data.restore'], Workflow: ['workflows.view', 'archived_data.restore'],
  Campaign: ['campaigns.view', 'archived_data.restore'], Template: ['campaigns.view', 'archived_data.restore'],
};
const protectedRole = (name: string) => ['guest', 'clientadmin'].includes(name.toLowerCase().replace(/[\s_-]/g, ''));

function scope(actor: Actor) {
  const context = tenantContext.getStore();
  if (!context || context.tenantId !== actor.tenantId) throw new AppError('Workspace context required', 403);
  return { tenantId: actor.tenantId, isArchived: true };
}

type Identity = { id: string; name: string; detail?: string; archivedAt?: Date | null; canRestore?: boolean };
function source<T>(count: () => Promise<number>, load: (skip: number, take: number) => Promise<T[]>, identify: (row: T) => Identity) {
  return { count, load: async (skip: number, take: number) => (await load(skip, take)).map(identify) };
}

export async function list(actor: Actor, query: z.infer<typeof ArchiveQuerySchema>) {
  await assertPermissions(actor, ['archived_data.view']);
  const where = scope(actor);
  const identityWhere = { tenantId: actor.tenantId, isArchived: true };
  const searchWhere = (...fields: string[]) => query.search?.trim() ? {
    AND: query.search.trim().split(/\s+/).map(term => ({
      OR: fields.map(field => ({ [field]: { contains: term, mode: 'insensitive' as const } })),
    })),
  } : {};
  const personWhere = { ...where, ...searchWhere('firstName', 'lastName', 'email') };
  const titleWhere = { ...where, ...searchWhere('title') };
  const nameWhere = { ...where, ...searchWhere('name') };
  const accountWhere = { ...where, ...searchWhere('name', 'website', 'city') };
  const usersWhere = { tenantId: actor.tenantId, status: 'INACTIVE' as const, ...searchWhere('firstName', 'lastName', 'email') };
  const pageArgs = (skip: number, take: number) => ({ skip, take, orderBy: { id: 'asc' as const } });
  const person = (r: { id: string; firstName: string; lastName: string; email: string | null; deletedAt: Date | null }) =>
    ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), detail: r.email ?? '', archivedAt: r.deletedAt });
  // Explicit delegates, scoped counts and bounded page reads; no client-controlled model names.
  const sources = {
    Task: source(() => prisma.task.count({ where: titleWhere }), (skip, take) => prisma.task.findMany({ where: titleWhere, ...pageArgs(skip, take), select: { id: true, title: true } }), r => ({ id: r.id, name: r.title })),
    Lead: source(() => prisma.lead.count({ where: personWhere }), (skip, take) => prisma.lead.findMany({ where: personWhere, ...pageArgs(skip, take), select: { id: true, firstName: true, lastName: true, email: true, deletedAt: true } }), person),
    Contact: source(() => prisma.contact.count({ where: personWhere }), (skip, take) => prisma.contact.findMany({ where: personWhere, ...pageArgs(skip, take), select: { id: true, firstName: true, lastName: true, email: true, deletedAt: true } }), person),
    Account: source(() => prisma.account.count({ where: accountWhere }), (skip, take) => prisma.account.findMany({ where: accountWhere, ...pageArgs(skip, take), select: { id: true, name: true, website: true, city: true, deletedAt: true } }), r => ({ id: r.id, name: r.name, detail: r.website || r.city || '', archivedAt: r.deletedAt })),
    Deal: source(() => prisma.deal.count({ where: titleWhere }), (skip, take) => prisma.deal.findMany({ where: titleWhere, ...pageArgs(skip, take), select: { id: true, title: true, value: true, currency: true, deletedAt: true } }), r => ({ id: r.id, name: r.title, detail: r.value === null ? '' : [r.currency, String(r.value)].filter(Boolean).join(' '), archivedAt: r.deletedAt })),
    Pipeline: source(() => prisma.pipeline.count({ where }), (skip, take) => prisma.pipeline.findMany({ where, ...pageArgs(skip, take), select: { id: true, name: true } }), r => r),
    User: source(() => prisma.user.count({ where: usersWhere }), (skip, take) => prisma.user.findMany({ where: usersWhere, ...pageArgs(skip, take), select: { id: true, firstName: true, lastName: true, email: true } }), r => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), detail: r.email })),
    Role: source(() => prisma.roleDefinition.count({ where: identityWhere }), (skip, take) => prisma.roleDefinition.findMany({ where: identityWhere, ...pageArgs(skip, take), select: { id: true, name: true, isSystemRole: true } }), r => ({ id: r.id, name: r.name, canRestore: !r.isSystemRole && !protectedRole(r.name) })),
    Workflow: source(() => prisma.workflow.count({ where: nameWhere }), (skip, take) => prisma.workflow.findMany({ where: nameWhere, ...pageArgs(skip, take), select: { id: true, name: true } }), r => r),
    Campaign: source(() => prisma.campaign.count({ where: nameWhere }), (skip, take) => prisma.campaign.findMany({ where: nameWhere, ...pageArgs(skip, take), select: { id: true, name: true } }), r => r),
    Template: source(() => prisma.template.count({ where }), (skip, take) => prisma.template.findMany({ where, ...pageArgs(skip, take), select: { id: true, name: true } }), r => r),
  };
  const permissionChecks = new Map<PermissionKey, Promise<boolean>>();
  const allowed = (permission: PermissionKey) => {
    if (!permissionChecks.has(permission)) permissionChecks.set(permission, assertPermissions(actor, [permission]).then(() => true).catch(error => {
      if (error instanceof AppError && error.statusCode === 403) return false;
      throw error;
    }));
    return permissionChecks.get(permission)!;
  };
  const candidates = query.type ? [query.type] : [...ARCHIVE_TYPES];
  const visible = (await Promise.all(candidates.map(async type => await allowed(permissions[type][0]) ? type : null))).filter((type): type is ArchiveType => type !== null);
  if (query.type && !visible.length) throw new AppError('Access denied', 403);
  const counts = await Promise.all(visible.map(type => sources[type].count()));
  const total = counts.reduce((sum, count) => sum + count, 0);
  // Merge archive identities before pagination so All types has a global ordering.
  const all: ArchivedRecord[] = [];
  for (const [index, type] of visible.entries()) {
    const canRestore = await allowed(permissions[type][1]);
    for (let offset = 0; offset < counts[index]; offset += 500) {
      const rows = await sources[type].load(offset, 500);
      const audits = await prisma.auditLog.findMany({ where: { tenantId: actor.tenantId, entityType: type,
        entityId: { in: rows.map(row => row.id) }, OR: [{ action: { endsWith: '.archived' } }, ...(type === 'User' ? [{ action: 'user.updated' }] : [])] },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { entityId: true, createdAt: true, changeset: true, action: true } });
      const dates = new Map<string, Date>();
      for (const audit of audits) {
        if (audit.action === 'user.updated' && (audit.changeset as { after?: { status?: string } } | null)?.after?.status !== 'INACTIVE') continue;
        if (audit.entityId && !dates.has(audit.entityId)) dates.set(audit.entityId, audit.createdAt);
      }
      all.push(...rows.map(row => ({ type, id: row.id, name: row.name, detail: row.detail ?? '',
        archivedAt: (row.archivedAt ?? dates.get(row.id))?.toISOString() ?? null, canRestore: canRestore && row.canRestore !== false })));
    }
  }
  const field = query.sortBy ?? 'archivedAt', direction = query.sortOrder ?? 'desc';
  all.sort((a, b) => compareSortValues(field === 'archivedAt' ? a.archivedAt ? new Date(a.archivedAt) : null : a[field],
    field === 'archivedAt' ? b.archivedAt ? new Date(b.archivedAt) : null : b[field], direction) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const skip = (query.page - 1) * query.limit;
  const data = all.slice(skip, skip + query.limit);
  return { data, meta: { total, page: query.page, limit: query.limit, hasMore: query.page * query.limit < total } };
}

export async function restore(actor: Actor, params: z.infer<typeof ArchiveRestoreParamsSchema>) {
  await assertPermissions(actor, ['archived_data.restore', permissions[params.type][0]]);
  const where = { ...scope(actor), id: params.id };
  let result: { count: number };
  switch (params.type) {
    case 'Task':
      result = await prisma.task.updateMany({ where, data: { isArchived: false } });
      break;
    case 'Pipeline':
      result = await prisma.pipeline.updateMany({ where, data: { isArchived: false } });
      break;
    case 'Workflow':
      // Recovery must not bypass the separate workflow activation permission.
      result = await prisma.workflow.updateMany({ where, data: { isArchived: false, isActive: false, status: 'PAUSED' } });
      break;
    case 'Campaign':
      // Preserve delivery history and status; recovery never queues a send.
      result = await prisma.campaign.updateMany({ where, data: { isArchived: false } });
      break;
    case 'Template':
      result = await prisma.template.updateMany({ where, data: { isArchived: false } });
      break;
    case 'Role': {
      const role = await prisma.roleDefinition.findFirst({ where: { id: params.id, tenantId: actor.tenantId, isArchived: true } });
      if (!role) throw new AppError('Archived record not found or already restored', 404);
      if (role.isSystemRole || protectedRole(role.name)) throw new AppError('System roles cannot be restored here', 403);
      result = await prisma.roleDefinition.updateMany({ where: { id: role.id, tenantId: actor.tenantId, isArchived: true, isSystemRole: false }, data: { isArchived: false } });
      break;
    }
  }
  if (!result.count) throw new AppError('Archived record not found or already restored', 404);
  await writeAuditLog({ tenantId: actor.tenantId, userId: actor.userId, action: `${params.type.toLowerCase()}.restored`, entityType: params.type, entityId: params.id, after: { isArchived: false } });
}


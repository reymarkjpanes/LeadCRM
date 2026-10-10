import { Prisma } from '@prisma/client';
import type { ArchiveType } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';

// Only fixed server-owned table/column expressions enter the SQL. Search, tenant,
// type and pagination values are parameters; clients cannot select a delegate.
const definitions: Record<ArchiveType, { table: string; name: string; detail: string; search: string[]; deletedAt?: boolean }> = {
  Lead: { table: 'Lead', name: `btrim(concat(r."firstName", ' ', r."lastName"))`, detail: `coalesce(r."email", '')`, search: ['firstName', 'lastName', 'email'], deletedAt: true },
  Contact: { table: 'Contact', name: `btrim(concat(r."firstName", ' ', r."lastName"))`, detail: `coalesce(r."email", '')`, search: ['firstName', 'lastName', 'email'], deletedAt: true },
  Account: { table: 'Account', name: `r."name"`, detail: `coalesce(nullif(r."website", ''), r."city", '')`, search: ['name', 'website', 'city'], deletedAt: true },
  Deal: { table: 'Deal', name: `r."title"`, detail: `case when r."value" is null then '' else concat_ws(' ', nullif(r."currency", ''), r."value"::text) end`, search: ['title'], deletedAt: true },
  User: { table: 'User', name: `btrim(concat(r."firstName", ' ', r."lastName"))`, detail: `r."email"`, search: ['firstName', 'lastName', 'email'] },
  Task: { table: 'Task', name: `r."title"`, detail: `''::text`, search: ['title'] },
  Campaign: { table: 'Campaign', name: `r."name"`, detail: `''::text`, search: ['name'] },
  Workflow: { table: 'Workflow', name: `r."name"`, detail: `''::text`, search: ['name'] },
  Role: { table: 'RoleDefinition', name: `r."name"`, detail: `''::text`, search: ['name'] },
};

export type ArchiveDateRow = { type: ArchiveType; id: string; name: string; detail: string; archivedAt: Date | null; isSystemRole: boolean };

/** Sort the default archive view in PostgreSQL and hydrate only its requested page. */
export async function loadArchiveDatePage(tenantId: string, types: ArchiveType[], query: { search?: string; page: number; limit: number; sortOrder?: 'asc' | 'desc' }): Promise<ArchiveDateRow[]> {
  if (tenantContext.getStore()?.tenantId !== tenantId) throw new AppError('Workspace context required', 403);
  if (!types.length) return [];
  const terms = query.search?.trim().split(/\s+/).filter(Boolean) ?? [];
  const sources = types.map(type => {
    const definition = definitions[type];
    const search = terms.map(term => Prisma.sql`(${Prisma.join(definition.search.map(field =>
      Prisma.sql`${Prisma.raw(`r."${field}"`)} ILIKE ${`%${term.replace(/[\\%_]/g, '\\$&')}%`}`), ' OR ')})`);
    const archiveCondition = type === 'User' ? Prisma.sql`r."status" = 'INACTIVE'` : Prisma.sql`r."isArchived" = true`;
    const entityCondition = type === 'Role' ? Prisma.sql`a."entityType" IN ('Role', 'RoleDefinition')` : Prisma.sql`a."entityType" = ${type}`;
    const auditAction = type === 'User'
      ? Prisma.sql`(a."action" LIKE '%.archived' OR a."action" = 'user.deactivated_with_reassignment' OR (a."action" = 'user.updated' AND a."changeset"->'after'->>'status' = 'INACTIVE'))`
      : Prisma.sql`a."action" LIKE '%.archived'`;
    return Prisma.sql`SELECT ${type}::text AS "type", r."id", ${Prisma.raw(definition.name)} AS "name",
      ${Prisma.raw(definition.detail)} AS "detail",
      ${definition.deletedAt ? Prisma.sql`coalesce(r."deletedAt", history."createdAt")` : Prisma.sql`history."createdAt"`} AS "archivedAt",
      ${type === 'Role' ? Prisma.sql`r."isSystemRole"` : Prisma.sql`false`} AS "isSystemRole"
      FROM ${Prisma.raw(`"${definition.table}"`)} r
      LEFT JOIN LATERAL (SELECT a."createdAt" FROM "AuditLog" a
        WHERE a."tenantId" = ${tenantId} AND a."entityId" = r."id" AND ${entityCondition} AND ${auditAction}
          ${definition.deletedAt ? Prisma.sql`AND r."deletedAt" IS NULL` : Prisma.empty}
        ORDER BY a."createdAt" DESC, a."id" ASC LIMIT 1) history ON true
      WHERE r."tenantId" = ${tenantId} AND ${archiveCondition}
        ${search.length ? Prisma.sql`AND ${Prisma.join(search, ' AND ')}` : Prisma.empty}`;
  });
  const direction = query.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // The service already checked archive and per-type permissions. Like reporting,
  // this fixed, parameterized read explicitly scopes every source to that tenant.
  return tenantContext.exit(async () => await prisma.$queryRaw<ArchiveDateRow[]>(Prisma.sql`SELECT * FROM (${Prisma.join(sources, ' UNION ALL ')}) archived
    ORDER BY "archivedAt" ${direction} NULLS LAST, "type" ASC, "id" ASC
    LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`));
}

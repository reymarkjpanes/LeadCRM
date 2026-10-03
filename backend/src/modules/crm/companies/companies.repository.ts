import { validateProductSnapshots, normalizeProductOther } from '../leads/product-snapshots';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';
import { parseFilterParams, buildPrismaFilters } from '../../../shared/helpers/filter-parser';

// Allowed filter fields for accounts
const COMPANY_FILTER_FIELDS = new Set(['industry', 'assignedUserId', 'city', 'size']);
const COMPANY_FIELD_ALIASES: Record<string, string> = {
  type: 'size', // frontend filter sends 'type' (maps to size in Prisma)
};

// All queries scoped to tenantId — cross-tenant access is impossible by design

export async function findAllCompanies(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  // Parse filter[field]=operator:value params
  const parsedFilters = parseFilterParams(query);
  const filterClauses = buildPrismaFilters(parsedFilters, COMPANY_FILTER_FIELDS, COMPANY_FIELD_ALIASES);

  const where = {
    tenantId,
    isArchived: query.archived === 'true',
    // Legacy direct params (backward compat)
    ...(query.assignedUserId ? { assignedUserId: String(query.assignedUserId) } : {}),
    ...(query.search
      ? {
          OR: [
            { name:     { contains: String(query.search), mode: 'insensitive' as const } },
            { industry: { contains: String(query.search), mode: 'insensitive' as const } },
            { city:     { contains: String(query.search), mode: 'insensitive' as const } },
          ],
        }
      : {}),
    // filter[field]=operator:value clauses (AND-combined)
    ...(filterClauses.length > 0 ? { AND: filterClauses } : {}),
  };

  const ids = await sortedPageIds(query.sort, ["name","industry","size","city","country","createdAt"], skip, limit,
    () => prisma.account.findMany({ where, select: { id: true, name: true, industry: true, size: true, city: true, country: true, createdAt: true } }));
  const [data, total] = await Promise.all([
    prisma.account.findMany({
      where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : skip, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.account.count({ where }),
  ]);

  return { data: orderPage(data, ids), total, page, limit };
}

export async function findCompanyById(id: string, tenantId: string) {
  return prisma.account.findFirst({
    where: { id, tenantId },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
}

export async function createCompany(tenantId: string, dto: CreateCompanyDto) {
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests);
  normalizeProductOther(dto, (dto.productInterests as string[] | undefined) ?? []);
  return prisma.account.create({ data: { ...dto, tenantId } as never });
}

export async function updateCompany(id: string, tenantId: string, dto: UpdateCompanyDto) {
  const previous = await prisma.account.findFirst({ where: { id, tenantId } });
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests, previous?.productInterests);
  normalizeProductOther(dto, (dto.productInterests as string[] | undefined) ?? previous?.productInterests ?? [], previous?.productInterestOther);
  try {
    return await prisma.account.update({ where: { id, tenantId }, data: dto as never });
  } catch {
    // Record not found or cross-tenant attempt
    return null;
  }
}

export async function archiveCompany(id: string, tenantId: string, userId: string) {
  return prisma.account.updateMany({
    where: { id, tenantId, isArchived: false },
    data: { isArchived: true, deletedAt: new Date(), deletedBy: userId },
  });
}

export async function restoreCompany(id: string, tenantId: string) {
  return prisma.account.updateMany({
    where: { id, tenantId, isArchived: true },
    data: { isArchived: false, deletedAt: null, deletedBy: null },
  });
}

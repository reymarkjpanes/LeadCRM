import { salesContext } from '../leads/sales-context';
import type { Prisma } from '@prisma/client';
import { ACCOUNTS_TABLE_SORT_FIELDS } from '@leadcrm/shared';
import { RETIRED_ACCOUNT_FIELDS } from '@leadcrm/shared';
import { ValidationError } from '../../../shared/errors/http-error';
import { consolidateAccountAddress } from './account-address';
import { assertCrmRecordMutation, mayReadCrmModule, crmReadWhere } from '../access/crm-record-access.service';
import { salesTransaction } from '../leads/lead-automation.service';
import { saveRecordValues } from '../closing-requirements/custom-field-values.repository';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { parseFilterParams, buildPrismaFilters, type FilterFields } from '../../../shared/helpers/filter-parser';

// Allowed filter fields for accounts
const COMPANY_FILTER_FIELDS: FilterFields = {
  industry: { kind: 'text' }, address: { kind: 'text' }, size: { kind: 'choice' },
  system: { kind: 'choice', operators: ['in'], options: ['touched', 'untouched'], handled: true },
  related: { kind: 'choice', operators: ['in'], options: ['has_deals'], handled: true },
};
const COMPANY_FIELD_ALIASES: Record<string, string> = {
  type: 'size', // frontend filter sends 'type' (maps to size in Prisma)
};

// All queries scoped to tenantId — cross-tenant access is impossible by design

export async function findAllCompanies(tenantId: string, query: Record<string, unknown>) {
  const db = salesContext.getStore() ?? prisma;
  const canReadDeals = await mayReadCrmModule(db, tenantId, 'deals');
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  // Parse filter[field]=operator:value params
  const parsedFilters = parseFilterParams(query);
  if (RETIRED_ACCOUNT_FIELDS.some(field => query[field] !== undefined) || parsedFilters.some(filter => RETIRED_ACCOUNT_FIELDS.some(field => field === filter.field) || filter.field === 'scope')) throw new ValidationError('Account assignment and product filters are retired.');
  const filterClauses = buildPrismaFilters(parsedFilters, COMPANY_FILTER_FIELDS, COMPANY_FIELD_ALIASES);
  filterClauses.push(await crmReadWhere(db, tenantId, 'accounts', 'all'));
  filterClauses.push(...buildSearchClauses(query.search, ['name', 'industry', 'address', 'website']));
  const system = parsedFilters.find(filter => filter.field === 'system')?.value;
  if (Array.isArray(system) && system.includes('touched') !== system.includes('untouched')) {
    filterClauses.push({ updatedAt: system.includes('touched') ? { gt: db.account.fields.createdAt } : { lte: db.account.fields.createdAt } });
  }
  const hasDeals = { deals: { some: { tenantId, isArchived: false } } };
  const related = parsedFilters.find(filter => filter.field === 'related')?.value;
  if (Array.isArray(related) && related.includes('has_deals')) {
    // Do not let a related-record filter become a permission oracle.
    filterClauses.push(canReadDeals ? hasDeals : { id: { in: [] } });
  }

  const where = {
    tenantId,
    isArchived: query.archived === 'true',
    // Legacy direct params (backward compat)
    // filter[field]=operator:value clauses (AND-combined)
    ...(filterClauses.length > 0 ? { AND: filterClauses } : {}),
  } as Prisma.AccountWhereInput;

  const ids = await sortedPageIds(query.sort, ACCOUNTS_TABLE_SORT_FIELDS, skip, limit,
    () => (salesContext.getStore() ?? prisma).account.findMany({ where, select: { id: true, name: true, industry: true, size: true, address: true, createdAt: true } }),
    direction => (salesContext.getStore() ?? prisma).account.findMany({ where, skip, take: limit, orderBy: [{ createdAt: direction }, { id: 'asc' }], select: { id: true } }));
  const [data, total] = await Promise.all([
    (salesContext.getStore() ?? prisma).account.findMany({
      where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : skip, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }),
    (salesContext.getStore() ?? prisma).account.count({ where }),
  ]);

  const [industries, sizes, touched, relatedCount, summaries] = await Promise.all([
    db.account.groupBy({ by: ['industry'], where, _count: true }),
    db.account.groupBy({ by: ['size'], where, _count: true }),
    db.account.count({ where: { AND: [where, { updatedAt: { gt: db.account.fields.createdAt } }] } }),
    canReadDeals ? db.account.count({ where: { AND: [where, hasDeals] } }) : 0,
    accountDealSummaries(tenantId, data.map(row => row.id), canReadDeals),
  ]);
  const facets: Record<string, number> = { touched, untouched: total - touched, has_deals: relatedCount };
  for (const row of industries) if (row.industry) facets['industry:' + row.industry] = row._count;
  for (const row of sizes) if (row.size) facets['size:' + row.size] = row._count;
  return { data: orderPage(data.map(row => ({ ...row, ...summaries.get(row.id) })), ids), total, page, limit, facets };
}

async function accountDealSummaries(tenantId: string, accountIds: string[], permitted: boolean) {
  const summaries = new Map<string, { dealCount: number; dealValue: number }>();
  if (!permitted || !accountIds.length) return summaries;
  const rows = await (salesContext.getStore() ?? prisma).deal.groupBy({ by: ['accountId'],
    where: { tenantId, accountId: { in: accountIds }, isArchived: false }, _count: true, _sum: { value: true } });
  for (const id of accountIds) summaries.set(id, { dealCount: 0, dealValue: 0 });
  for (const row of rows) if (row.accountId) summaries.set(row.accountId, { dealCount: row._count, dealValue: row._sum.value ?? 0 });
  return summaries;
}

export async function findCompanyById(id: string, tenantId: string) {
  return (salesContext.getStore() ?? prisma).account.findFirst({
    where: { id, tenantId },
  });
}

export async function withCompanyDealSummary<T extends { id: string }>(tenantId: string, account: T) {
  const summaries = await accountDealSummaries(tenantId, [account.id], await mayReadCrmModule(salesContext.getStore() ?? prisma, tenantId, 'deals'));
  return { ...account, ...summaries.get(account.id) };
}

export async function createCompany(tenantId: string, dto: Omit<CreateCompanyDto, 'ownerGroupId'> & { ownerGroupId?: string | null }, actorId?: string) {
  const { customFieldValues, requestId: _requestId, ...data } = dto;
  return salesTransaction(async tx => {
    const account = await tx.account.create({ data: { ...data, address: consolidateAccountAddress(dto) ?? undefined, tenantId } });
    await saveRecordValues(tx, tenantId, 'accounts', account.id, customFieldValues, actorId);
    return account;
  });
}

export async function updateCompany(id: string, tenantId: string, dto: UpdateCompanyDto, actorId?: string) {
  return salesTransaction(async tx => {
    await assertCrmRecordMutation(tx, 'accounts', id, 'edit', dto);
    const { customFieldValues, ...data } = dto;
    await saveRecordValues(tx, tenantId, 'accounts', id, customFieldValues, actorId);
    return tx.account.update({ where: { id, tenantId }, data });
  });
}

export async function archiveCompany(id: string, tenantId: string, userId: string) {
  return (salesContext.getStore() ?? prisma).account.updateMany({
    where: { id, tenantId, isArchived: false },
    data: { isArchived: true, deletedAt: new Date(), deletedBy: userId },
  });
}

export async function restoreCompany(id: string, tenantId: string) {
  return (salesContext.getStore() ?? prisma).account.updateMany({
    where: { id, tenantId, isArchived: true },
    data: { isArchived: false, deletedAt: null, deletedBy: null },
  });
}

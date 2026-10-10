import { saveRecordValues } from '../closing-requirements/custom-field-values.repository';
import { validateProductSnapshots, normalizeProductOther } from '../leads/product-snapshots';
import { productRelationData } from '../leads/product-relations';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { CrmStatusSchema, normalizeCrmStatus } from '@leadcrm/shared';
import { salesTransaction } from '../leads/lead-automation.service';
import { assertClosedStatus, cancelOpenDeals, contactStatusValue } from '../engagement.service';
import { ValidationError } from '../../../shared/errors/http-error';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { parseFilterParams, buildPrismaFilters } from '../../../shared/helpers/filter-parser';

/**
 * Contacts V2 Repository — queries the Contact table.
 *
 * Field mapping (schema ↔ DB):
 *   company        → Contact.company       (plain text, company name)
 *   accountId      → Contact.accountId      (FK → Account.id)  ← CANONICAL company link (ADR-001)
 *   status         → ContactStatus enum    (HOT | WARM | COLD | CANCELLED | CLOSED)
 *   productInterests → names derived from ContactProductInterest
 *   isArchived     → Boolean (archive = set isArchived:true, not status change)
 */

// ── Shared include shape ───────────────────────────────────────────────────
const CONTACT_INCLUDE = {
  assignedUser: { select: { id: true, firstName: true, lastName: true } },
  account:      { select: { id: true, name: true } },
} as const;

export async function findAllContacts(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;
  const filters = parseFilterParams(query);
  const statusFilter = filters.find(filter => filter.field === 'status');
  if (statusFilter && ['in', 'not_in', 'equals'].includes(statusFilter.operator)) {
    const values = Array.isArray(statusFilter.value) ? statusFilter.value : [statusFilter.value];
    statusFilter.value = values.map(value => CrmStatusSchema.parse(value).toUpperCase());
    if (statusFilter.operator === 'equals') statusFilter.operator = 'in';
  }
  const clauses = buildPrismaFilters(filters, new Set(['status', 'assignedUserId', 'accountId']));
  const scope = filters.find(filter => filter.field === 'scope')?.value;
  if (scope === 'my') clauses.push({ assignedUserId: String(query.currentUserId ?? '') });
  if (scope === 'active') clauses.push({ status: { in: ['HOT', 'WARM'] } });
  const system = filters.find(filter => filter.field === 'system')?.value;
  const systemValues = Array.isArray(system) ? system : [];
  if (systemValues.includes('touched') !== systemValues.includes('untouched')) {
    clauses.push({ updatedAt: systemValues.includes('touched') ? { gt: prisma.contact.fields.createdAt } : { lte: prisma.contact.fields.createdAt } });
  }
  const related = filters.find(filter => filter.field === 'related')?.value;
  if (Array.isArray(related) && related.includes('has_deals')) {
    clauses.push({ contactDeals: { some: { tenantId, deal: { tenantId, isArchived: false } } } });
  }

  const where: Record<string, unknown> = {
    tenantId,
    isArchived: query.archived === 'true',
    ...(clauses.length ? { AND: clauses } : {}),
  };

  // Status filter — value must be a valid ContactStatus enum member
  if (query.status) {
    where['status'] = CrmStatusSchema.parse(query.status).toUpperCase();
  }

  if (query.assignedUserId) {
    where['assignedUserId'] = String(query.assignedUserId);
  }

  // Canonical company filter
  if (query.accountId) {
    where['accountId'] = String(query.accountId);
  }

  if (query.lifecycleStage) {
    where['lifecycleStage'] = String(query.lifecycleStage);
  }

  // Full-text search across name, email, company, phone
  if (query.search) {
    const term = String(query.search);
    where['OR'] = [
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName:  { contains: term, mode: 'insensitive' } },
      { email:     { contains: term, mode: 'insensitive' } },
      { company:   { contains: term, mode: 'insensitive' } },
      { account:   { name: { contains: term, mode: 'insensitive' } } },
      { phone:     { contains: term, mode: 'insensitive' } },
    ];
  }

  const sort = typeof query.sort === 'string' ? query.sort.replace(/^companyName:/, 'company:') : query.sort;
  const ids = await sortedPageIds(sort === 'createdAt:desc' ? undefined : sort, ['firstName', 'lastName', 'email', 'phone', 'company', 'status', 'source', 'createdAt'], skip, limit,
    async () => (await prisma.contact.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true, status: true, source: true, createdAt: true, account: { select: { name: true } } } }))
      .map(row => ({ ...row, company: row.account?.name ?? row.company })),
    direction => prisma.contact.findMany({ where, skip, take: limit, orderBy: [{ createdAt: direction }, { id: 'asc' }], select: { id: true } }));
  const [data, total] = await Promise.all([
    prisma.contact.findMany({
      where: ids ? { ...where, id: { in: ids } } : where,
      skip: ids ? 0 : skip,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: CONTACT_INCLUDE,
    }),
    prisma.contact.count({ where: where as never }),
  ]);

  const [statuses, agents, touched, hasDeals] = await Promise.all([
    prisma.contact.groupBy({ by: ['status'], where: where as never, _count: true }),
    prisma.contact.groupBy({ by: ['assignedUserId'], where: where as never, _count: true }),
    prisma.contact.count({ where: { AND: [where, { updatedAt: { gt: prisma.contact.fields.createdAt } }] } as never }),
    prisma.contact.count({ where: { AND: [where, { contactDeals: { some: { tenantId, deal: { tenantId, isArchived: false } } } }] } as never }),
  ]);
  const facets: Record<string, number> = { touched, untouched: total - touched, has_deals: hasDeals };
  for (const row of statuses) facets['status:' + normalizeCrmStatus(row.status)] = row._count;
  for (const row of agents) if (row.assignedUserId) facets['owner:' + row.assignedUserId] = row._count;
  return { data: orderPage(data, ids), total, page, limit, facets };
}

export async function findContactById(id: string, tenantId: string) {
  return prisma.contact.findFirst({
    where: { id, tenantId, isArchived: false },
    include: CONTACT_INCLUDE,
  });
}

export async function createContact(tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  if (dto.status === 'Closed') throw new ValidationError('Confirm a related Deal as Closed Won before setting Closed.');
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests);
  normalizeProductOther(dto, (dto.productInterests as string[] | undefined) ?? []);
  const { customFieldValues, ...data } = dto;
  return salesTransaction(async tx => {
    const contact = await tx.contact.create({
    data: { ...data, ...await productRelationData(tx, 'contact', tenantId, { names: dto.productInterests as string[] | undefined }), tenantId, status: CrmStatusSchema.parse(dto.status).toUpperCase() } as never,
    include: CONTACT_INCLUDE,
    });
    await saveRecordValues(tx, tenantId, 'contacts', contact.id, customFieldValues, actorId);
    return contact;
  });
}

export async function updateContact(id: string, tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  const previous = await prisma.contact.findFirst({ where: { id, tenantId } });
  if (dto.productInterestIds !== undefined && dto.productInterests !== undefined) throw new ValidationError('Supply Product IDs or legacy names, not both.');
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests, previous?.productInterests);
  const interestNames = dto.productInterestIds === undefined ? (dto.productInterests as string[] | undefined) ?? previous?.productInterests ?? []
    : (await prisma.productInterest.findMany({ where: { tenantId, id: { in: dto.productInterestIds as string[] } }, select: { name: true } })).map(product => product.name);
  normalizeProductOther(dto, interestNames, previous?.productInterestOther);
  return salesTransaction(async tx => {
    const current = await tx.contact.findFirstOrThrow({ where: { id, tenantId } });
    if (dto.productInterests !== undefined || dto.productInterestIds !== undefined) Object.assign(dto, await productRelationData(tx, 'contact', tenantId, { ids: dto.productInterestIds as string[] | undefined, names: dto.productInterests as string[] | undefined }, current, true));
    const status = dto.status === undefined ? undefined : CrmStatusSchema.parse(dto.status);
    if (status === 'Closed' && normalizeCrmStatus(current.status) !== 'Closed') await assertClosedStatus(tx, tenantId, { contactId: id });
    const { customFieldValues, productInterestIds: _productIds, ...data } = dto;
    await saveRecordValues(tx, tenantId, 'contacts', id, customFieldValues, actorId);
    const contact = await tx.contact.update({
      where:   { id, tenantId } as never,
      data: { ...data, ...(status ? { status: contactStatusValue(status), ...(status !== normalizeCrmStatus(current.status) ? { lastStatusChangedAt: new Date() } : {}) } : {}) } as never,
      include: CONTACT_INCLUDE,
    });
    if (status && actorId && status !== normalizeCrmStatus(current.status)) {
      await tx.activity.create({ data: { tenantId, contactId: id, createdById: actorId, type: 'stage_change', title: `Status changed from ${normalizeCrmStatus(current.status)} to ${status}`, description: 'Staff changed the CRM status.' } });
      if (status === 'Cancelled') await cancelOpenDeals(tx, tenantId, actorId, { contactId: id }, 'Staff explicitly cancelled the opportunity.');
    }
    if (actorId && contact.assignedUserId && contact.assignedUserId !== current.assignedUserId) await tx.activity.create({ data: {
      tenantId, createdById: actorId, contactId: id, type: 'assignment', title: 'Contact reassigned',
      metadata: { assignedUserId: contact.assignedUserId, previousUserId: current.assignedUserId },
    } });
    return contact;
  });
}

export async function archiveContact(id: string, tenantId: string, userId: string) {
  return prisma.contact.updateMany({
    where: { id, tenantId, isArchived: false },
    data: { isArchived: true, deletedAt: new Date(), deletedBy: userId },
  });
}

export async function restoreContact(id: string, tenantId: string) {
  return prisma.contact.updateMany({
    where: { id, tenantId, isArchived: true },
    data: { isArchived: false, deletedAt: null, deletedBy: null, archiveReason: null },
  });
}

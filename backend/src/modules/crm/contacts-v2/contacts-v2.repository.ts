import { salesContext } from '../leads/sales-context';
import { createLinkedAccount } from '../companies/organization-creation';
import { assignmentSnapshot } from '../../notifications/assignment-presentation';
import { formatAssignmentChange } from '@leadcrm/shared';
import { saveRecordValues } from '../closing-requirements/custom-field-values.repository';
import { assertCrmRecordMutation, assertCrmCreateAssignment } from '../access/crm-record-access.service';
import { validateProductSnapshots, normalizeProductOther } from '../leads/product-snapshots';
import { productRelationData } from '../leads/product-relations';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { NotFoundError } from '../../../shared/errors/http-error';
import { CrmStatusSchema, normalizeCrmStatus } from '@leadcrm/shared';
import { salesTransaction } from '../leads/lead-automation.service';
import { assertClosedStatus, cancelOpenDeals, contactStatusValue, finalizeContactLifecycle } from '../engagement.service';
import { ValidationError } from '../../../shared/errors/http-error';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { createAssignedContact } from './contact-creation';
import { mayReadContactAccount, presentContactAccount } from './contact-account-access';
import { parseFilterParams, buildPrismaFilters, type FilterFields } from '../../../shared/helpers/filter-parser';

const CONTACT_FILTER_FIELDS: FilterFields = {
  status: { kind: 'choice', operators: ['equals', 'in', 'not_in'] },
  assignedUserId: { kind: 'reference' }, accountId: { kind: 'reference' },
  scope: { kind: 'choice', operators: ['equals'], options: ['all', 'my', 'active'], handled: true },
  system: { kind: 'choice', operators: ['in'], options: ['touched', 'untouched'], handled: true },
  related: { kind: 'choice', operators: ['in'], options: ['has_deals'], handled: true },
};

/**
 * Contacts V2 Repository — queries the Contact table.
 *
 * Field mapping (schema ↔ DB):
 *   companyName    → Contact.companyName       (plain text, company name)
 *   accountId      → Contact.accountId      (FK → Account.id)  ← CANONICAL company link (ADR-001)
 *   status         → ContactStatus enum    (HOT | WARM | COLD | CANCELLED | CLOSED)
 *   productInterests → names derived from ContactProductInterest
 *   isArchived     → Boolean (archive = set isArchived:true, not status change)
 */

// ── Shared include shape ───────────────────────────────────────────────────
const CONTACT_INCLUDE = {
  assignedUser: { select: { id: true, firstName: true, lastName: true } },
  account:      { select: { id: true, name: true, industry: true, size: true, website: true } },
} as const;

export async function findAllContacts(tenantId: string, query: Record<string, unknown>) {
  const db = salesContext.getStore() ?? prisma;
  const canReadAccount = await mayReadContactAccount(salesContext.getStore() ?? prisma, tenantId);
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;
  const filters = parseFilterParams(query);
  const statusFilter = filters.find(filter => filter.field === 'status');
  if (statusFilter && ['in', 'not_in', 'equals'].includes(statusFilter.operator)) {
    const values = Array.isArray(statusFilter.value) ? statusFilter.value : [statusFilter.value];
    statusFilter.value = values.map(value => CrmStatusSchema.parse(value).toUpperCase());
    if (statusFilter.operator === 'equals') statusFilter.operator = 'in';
  }
  const clauses = buildPrismaFilters(filters, CONTACT_FILTER_FIELDS);
  clauses.push(...buildSearchClauses(query.search, ['firstName', 'lastName', 'email', 'phone', 'source'], contains => [
    { companyName: contains, ...(!canReadAccount ? { companyFromAccount: false } : {}) },
    ...(canReadAccount ? [{ account: { name: contains } }] : []),
    ...(['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED'].includes(contains.contains.toUpperCase()) ? [{ status: contains.contains.toUpperCase() }] : []),
  ]));
  const scope = filters.find(filter => filter.field === 'scope')?.value;
  if (scope === 'my') clauses.push({ assignedUserId: String(query.currentUserId ?? '') });
  if (scope === 'active') clauses.push({ status: { in: ['HOT', 'WARM'] } });
  const system = filters.find(filter => filter.field === 'system')?.value;
  const systemValues = Array.isArray(system) ? system : [];
  if (systemValues.includes('touched') !== systemValues.includes('untouched')) {
    clauses.push({ updatedAt: systemValues.includes('touched') ? { gt: (salesContext.getStore() ?? prisma).contact.fields.createdAt } : { lte: (salesContext.getStore() ?? prisma).contact.fields.createdAt } });
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

  const sort = query.sort;
  const ids = await sortedPageIds(sort === 'createdAt:desc' ? undefined : sort, ['firstName', 'lastName', 'email', 'phone', 'companyName', 'status', 'source', 'createdAt'], skip, limit,
    async () => (await (salesContext.getStore() ?? prisma).contact.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true, phone: true, companyName: true, companyFromAccount: true, status: true, source: true, createdAt: true } }))
      .map(row => ({ ...presentContactAccount(row, canReadAccount), status: normalizeCrmStatus(row.status) })),
    direction => (salesContext.getStore() ?? prisma).contact.findMany({ where, skip, take: limit, orderBy: [{ createdAt: direction }, { id: 'asc' }], select: { id: true } }));
  const [data, total] = await Promise.all([
    (salesContext.getStore() ?? prisma).contact.findMany({
      where: ids ? { ...where, id: { in: ids } } : where,
      skip: ids ? 0 : skip,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { ...CONTACT_INCLUDE, account: canReadAccount ? CONTACT_INCLUDE.account : false },
    }),
    (salesContext.getStore() ?? prisma).contact.count({ where: where as never }),
  ]);

  const [statuses, agents, touched, hasDeals] = await Promise.all([
    (salesContext.getStore() ?? prisma).contact.groupBy({ by: ['status'], where: where as never, _count: true }),
    (salesContext.getStore() ?? prisma).contact.groupBy({ by: ['assignedUserId'], where: where as never, _count: true }),
    (salesContext.getStore() ?? prisma).contact.count({ where: { AND: [where, { updatedAt: { gt: (salesContext.getStore() ?? prisma).contact.fields.createdAt } }] } as never }),
    (salesContext.getStore() ?? prisma).contact.count({ where: { AND: [where, { contactDeals: { some: { tenantId, deal: { tenantId, isArchived: false } } } }] } as never }),
  ]);
  const facets: Record<string, number> = { touched, untouched: total - touched, has_deals: hasDeals };
  for (const row of statuses) facets['status:' + normalizeCrmStatus(row.status)] = row._count;
  for (const row of agents) if (row.assignedUserId) facets['owner:' + row.assignedUserId] = row._count;
  return { data: orderPage(data.map(contact => presentContactAccount({ ...contact, account: contact.account ?? null }, canReadAccount)), ids), total, page, limit, facets };
}

export async function findContactById(id: string, tenantId: string) {
  return (salesContext.getStore() ?? prisma).contact.findFirst({
    where: { id, tenantId, isArchived: false },
    include: CONTACT_INCLUDE,
  });
}

export async function createContact(tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  if (!actorId) throw new ValidationError('An authenticated Contact creator is required.');
  return salesTransaction(tx => createAssignedContact(tx, tenantId, dto, actorId, String(dto.requestId)));
}

export async function updateContact(id: string, tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  const previous = await (salesContext.getStore() ?? prisma).contact.findFirst({ where: { id, tenantId } });
  if (dto.productInterestIds !== undefined && dto.productInterests !== undefined) throw new ValidationError('Supply Product IDs or legacy names, not both.');
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests, previous?.productInterests);
  const interestNames = dto.productInterestIds === undefined ? (dto.productInterests as string[] | undefined) ?? previous?.productInterests ?? []
    : (await (salesContext.getStore() ?? prisma).productInterest.findMany({ where: { tenantId, id: { in: dto.productInterestIds as string[] } }, select: { name: true } })).map(product => product.name);
  normalizeProductOther(dto, interestNames, previous?.productInterestOther);
  return salesTransaction(async tx => {
    await assertCrmRecordMutation(tx, 'contacts', id, 'edit', dto);
    const current = await tx.contact.findFirstOrThrow({ where: { id, tenantId } });
    if (dto.productInterests !== undefined || dto.productInterestIds !== undefined) Object.assign(dto, await productRelationData(tx, 'contact', tenantId, { ids: dto.productInterestIds as string[] | undefined, names: dto.productInterests as string[] | undefined }, current, true));
    const status = dto.status === undefined ? undefined : CrmStatusSchema.parse(dto.status);
    if (status === 'Closed') {
      await assertClosedStatus(tx, tenantId, { contactId: id });
      await finalizeContactLifecycle(tx, tenantId, id, actorId);
    }
    const { customFieldValues, productInterestIds: _productIds, newAccount, ...data } = dto;
    if (newAccount) {
      const account = await createLinkedAccount(tx, tenantId, newAccount, actorId);
      data.accountId = account.id; data.companyName = account.name; data.companyFromAccount = true;
    } else if (data.accountId && data.accountId !== current.accountId) {
      const account = await tx.account.findFirst({ where: { tenantId, id: String(data.accountId), isArchived: false, deletedAt: null }, select: { name: true } });
      if (!account) throw new NotFoundError('Account');
      data.companyName = account.name;
      data.companyFromAccount = true;
    } else if (data.companyName !== undefined && data.companyName !== current.companyName) {
      data.companyFromAccount = false;
    }
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
    if (actorId && contact.assignedUserId && contact.assignedUserId !== current.assignedUserId) {
      const assignment = await assignmentSnapshot(tx, tenantId, current.assignedUserId, contact.assignedUserId, actorId);
      await tx.activity.create({ data: {
        tenantId, createdById: actorId, contactId: id, type: 'assignment', ...formatAssignmentChange(assignment),
        metadata: { assignedUserId: contact.assignedUserId, previousUserId: current.assignedUserId, ...assignment },
      } });
    }
    return contact;
  });
}

export async function archiveContact(id: string, tenantId: string, userId: string) {
  return (salesContext.getStore() ?? prisma).contact.updateMany({
    where: { id, tenantId, isArchived: false },
    data: { isArchived: true, deletedAt: new Date(), deletedBy: userId },
  });
}

export async function restoreContact(id: string, tenantId: string) {
  return (salesContext.getStore() ?? prisma).contact.updateMany({
    where: { id, tenantId, isArchived: true },
    data: { isArchived: false, deletedAt: null, deletedBy: null, archiveReason: null },
  });
}

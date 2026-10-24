import { salesContext } from '../leads/sales-context';
import { salesActivityDates } from '../sales-activity';
import { assertContactAccountSelection, mayReadContactAccount, presentContactAccount } from '../contacts-v2/contact-account-access';
import type { Lead as LeadRecord } from '@prisma/client';
import { createLinkedAccount } from '../companies/organization-creation';
import { assignmentSnapshot } from '../../notifications/assignment-presentation';
import { formatAssignmentChange } from '@leadcrm/shared';
import { assertCrmRecordMutation, assertCrmCreateAssignment, authorizedWorkflowScope, crmReadWhere, requestedCrmScope } from '../access/crm-record-access.service';
import { isDeepStrictEqual } from 'node:util';
import { recordChanges } from '../record-updates';
import { normalizeCrmStatus, formatLeadName, LEADS_TABLE_SORT_FIELDS } from '@leadcrm/shared';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { readRecordValues, saveRecordValues } from '../closing-requirements/custom-field-values.repository';
import { productRelationData } from '../leads/product-relations';
import { parseLeadCreatedFilter } from '../leads/lead-created-filter';
import { convertClosedLead } from '../leads/lead-conversion.service';
import { assertClosedStatus, cancelOpenDeals, recordCustomerStatusChange } from '../engagement.service';
import { assertCustomerStatusEdit, classifyCustomerRecord, prepareCustomerStatus } from '../customer-classification.service';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import prisma from '../../../config/database.config';
import { resolveProducts, createAssignedLead, salesTransaction, createProductDeals, validateSalesOwner } from '../leads/lead-automation.service';
import { CreateContactDto, UpdateContactDto } from './contacts.dto';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { parseFilterParams, buildPrismaFilters, type FilterFields } from '../../../shared/helpers/filter-parser';

// Allowed filter fields for leads/contacts — prevents arbitrary Prisma field injection
const CONTACT_FILTER_FIELDS: FilterFields = {
  status: { kind: 'choice', operators: ['equals', 'in', 'not_in'] },
  source: { kind: 'choice' }, assignedUserId: { kind: 'reference' }, accountId: { kind: 'reference' },
  scope: { kind: 'choice', operators: ['equals'], options: ['all', 'my', 'active'], handled: true },
  system: { kind: 'choice', operators: ['in'], options: ['touched', 'untouched'], handled: true },
  related: { kind: 'choice', operators: ['in'], options: ['has_email', 'has_phone'], handled: true },
  createdAt: { kind: 'date', operators: ['gte', 'lte', 'between'], handled: true },
};
// Map frontend field names → Prisma field names where they differ
const CONTACT_FIELD_ALIASES: Record<string, string> = {
  source: 'source',          // frontend sends 'source' (maps from leadSource client-side)
  leadSource: 'source',      // alternate frontend key
  assignedUserId: 'assignedUserId',
};

// All queries are scoped to tenantId — cross-tenant access is impossible by design
export async function findAllContacts(tenantId: string, query: Record<string, unknown>) {
  if (salesContext.getStore()) return findContactsPage(tenantId, query);
  return prisma.$transaction(tx => salesContext.run(tx, () => findContactsPage(tenantId, query)), { isolationLevel: 'RepeatableRead' });
}
async function findContactsPage(tenantId: string, query: Record<string, unknown>) {
  const db = salesContext.getStore() ?? prisma;
  const canReadAccount = await mayReadContactAccount(db, tenantId);
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  // Parse filter[field]=operator:value params from the query string
  const parsedFilters = parseFilterParams(query);
  const createdAt = parseLeadCreatedFilter(query);
  const presence = parsedFilters.find(f => f.field === 'related');
  const related = Array.isArray(presence?.value) ? presence.value : [];
  const system = parsedFilters.find(f => f.field === 'system');
  const systemValues = Array.isArray(system?.value) ? system.value : [];
  const statusFilter = parsedFilters.find(f => f.field === 'status');
  if (statusFilter && ['in', 'not_in', 'equals'].includes(statusFilter.operator)) {
    const values = Array.isArray(statusFilter.value) ? statusFilter.value : [String(statusFilter.value)];
    statusFilter.value = [...new Set(values.flatMap(value => [normalizeCrmStatus(value), normalizeCrmStatus(value).toUpperCase()]))];
    if (statusFilter.operator === 'equals') statusFilter.operator = 'in';
  }
  const filterClauses = buildPrismaFilters(parsedFilters, CONTACT_FILTER_FIELDS, CONTACT_FIELD_ALIASES);
  filterClauses.push(...buildSearchClauses(query.search, ['firstName', 'lastName', 'email', 'phone', 'source'], contains => [
    { companyName: contains, ...(!canReadAccount ? { companyFromAccount: false } : {}) },
    ...(canReadAccount ? [{ account: { name: contains } }] : []),
    ...(['Inquiry', 'Hot', 'Warm', 'Cold', 'Cancelled', 'Closed Deal'].filter(status => status.toLowerCase() === contains.contains.toLowerCase())
      .map(status => ({ status: { in: [status, status.toUpperCase()] } }))),
  ]));
  const scope = requestedCrmScope(parsedFilters, query.scope);
  filterClauses.push(await crmReadWhere(db, tenantId, 'leads', scope));
  if (scope === 'my') filterClauses.push({ assignedUserId: String(query.currentUserId ?? '') });
  if (scope === 'active') filterClauses.push({ status: { in: ['Inquiry','Hot','Warm','INQUIRY','HOT','WARM'] } });

  for (const field of ['email', 'phone']) if (related.includes('has_' + field)) filterClauses.push({ [field]: { not: null } }, { [field]: { not: '' } });
  if (systemValues.includes('touched') !== systemValues.includes('untouched')) filterClauses.push({ updatedAt: systemValues.includes('touched') ? { gt: db.lead.fields.createdAt } : { lte: db.lead.fields.createdAt } });
  if (query.status) filterClauses.push({ status: { in: [normalizeCrmStatus(String(query.status)), normalizeCrmStatus(String(query.status)).toUpperCase()] } });
  const where: Record<string, unknown> = {
    ...(createdAt ? { createdAt } : {}),
    tenantId,
    isArchived: query.archived === 'true',
    ...(query.archived === 'true' ? {} : { convertedAt: null, deletedAt: null }),
    // accountId direct param (still used by relationship lookups)
    ...(query.accountId ? { accountId: String(query.accountId) } : {}),
    // filter[field]=operator:value clauses — all AND-combined at query level
    ...(filterClauses.length > 0 ? { AND: filterClauses } : {}),
  };

  const [sortKey, direction] = String(query.sort ?? 'lastSalesActivityAt:desc').split(':');
  const allowed = new Set(LEADS_TABLE_SORT_FIELDS);
  const sortField = allowed.has(sortKey) ? sortKey : 'createdAt';
  const sortDirection = direction === 'asc' ? 'asc' as const : 'desc' as const;
  const dateSort = ['createdAt', 'updatedAt'].includes(sortField);
  let activity: Map<string, Date> | undefined;
  const ids = dateSort ? null : await sortedPageIds(`${sortField}:${sortDirection}`, LEADS_TABLE_SORT_FIELDS, skip, limit,
    async () => {
      const keys = await db.lead.findMany({ where,
        select: { id: true, createdAt: true, firstName: true, lastName: true, email: true, phone: true, companyName: true, companyFromAccount: true, status: true, source: true },
      });
      if (sortField === 'lastSalesActivityAt') activity = await salesActivityDates(db, tenantId, 'leads', keys);
      return keys.map(row => ({ ...presentContactAccount(row, canReadAccount), lastSalesActivityAt: activity?.get(row.id), name: row.firstName?.trim() || row.lastName?.trim() ? formatLeadName(row) : null, status: normalizeCrmStatus(row.status) }));
    });
  const [data, total] = await Promise.all([
    db.lead.findMany({
      where: ids ? { ...where, id: { in: ids } } : where, skip: ids ? 0 : skip, take: limit,
      orderBy: [{ [dateSort ? sortField : 'createdAt']: sortDirection }, { id: 'asc' }],
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        account:      { select: { id: true, name: true, industry: true, size: true, website: true, address: true } },
        createdBy:    { select: { id: true, firstName: true, lastName: true } },
        updatedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db.lead.count({ where }),
  ]);

  const [statuses, sources, agents, email, phone, touched] = await Promise.all([
    db.lead.groupBy({ by: ['status'], where, _count: true }),
    db.lead.groupBy({ by: ['source'], where, _count: true }),
    db.lead.groupBy({ by: ['assignedUserId'], where, _count: true }),
    db.lead.count({ where: { AND: [where, { email: { not: null } }, { email: { not: '' } }] } }),
    db.lead.count({ where: { AND: [where, { phone: { not: null } }, { phone: { not: '' } }] } }),
    db.lead.count({ where: { AND: [where, { updatedAt: { gt: db.lead.fields.createdAt } }] } }),
  ]);
  const facets: Record<string, number> = { has_email: email, has_phone: phone, touched, untouched: total - touched };
  for (const row of statuses) { const key = 'status:' + normalizeCrmStatus(row.status); facets[key] = (facets[key] ?? 0) + row._count; }
  for (const row of sources) if (row.source) facets['source:' + row.source] = row._count;
  for (const row of agents) if (row.assignedUserId) facets['owner:' + row.assignedUserId] = row._count;
  activity ??= await salesActivityDates(db, tenantId, 'leads', data);
  return { data: orderPage(data.map(row => ({ ...row, lastSalesActivityAt: activity!.get(row.id) ?? row.createdAt })), ids), total, page, limit, facets };
}

export async function findContactById(id: string, tenantId: string) {
  return prisma.lead.findFirst({
    where: { id, tenantId, isArchived: false, deletedAt: null },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      account:      { select: { id: true, name: true, industry: true, size: true, website: true, address: true } },
      createdBy:    { select: { id: true, firstName: true, lastName: true } },
      updatedBy:    { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function createContact(
  tenantId: string,
  dto: CreateContactDto,
  createdById?: string,
) {
  const { requestId, productInterest, customFieldValues, newAccount, ...fields } = dto;
  await assertCrmCreateAssignment(prisma, tenantId, dto.assignedUserId, 'leads');
  if (dto.status === 'Closed Deal') throw new ValidationError('Confirm a related Deal as Closed Deal before setting Closed Deal.');
  return salesTransaction(async tx => {
    const existing = requestId ? await tx.lead.findFirst({ where: { tenantId, creationKey: requestId } }) : null;
    if (!existing) await assertContactAccountSelection(tx, tenantId, fields.accountId);
    if (!existing && newAccount) {
      const account = await createLinkedAccount(tx, tenantId, newAccount, createdById);
      fields.accountId = account.id; fields.companyName = account.name;
    } else if (!existing && fields.accountId) {
      const account = await tx.account.findFirst({ where: { tenantId, id: fields.accountId, isArchived: false, deletedAt: null }, select: { name: true } });
      if (!account) throw new NotFoundError('Active Account');
      fields.companyName = account.name;
    }
    const lead = await createAssignedLead(tx, { ...fields, companyFromAccount: !!fields.accountId, productInterestIds: productInterest ?? [], tenantId, creationKey: requestId,
      ...(createdById ? { createdById, updatedById: createdById } : {}) }, createdById);
    if (!existing) await saveRecordValues(tx, tenantId, 'leads', lead.id, customFieldValues, createdById);
    return lead;
  });
}

export async function updateContact(
  id: string,
  tenantId: string,
  dto: UpdateContactDto,
  updatedById?: string,
  prevStatus?: string,
  onCommitted?: (before: LeadRecord, after: LeadRecord, changes: ReturnType<typeof recordChanges>) => Promise<void>,
) {
  try {
    const data: Record<string, unknown> = { ...dto };
    delete data.customFieldValues;
    delete data.expectedUpdatedAt;
    delete data.newAccount;
    if (updatedById) data.updatedById = updatedById;
    // Stamp lastStatusChangedAt when status actually changes
    if (dto.status && prevStatus !== undefined && dto.status !== prevStatus) {
      data.lastStatusChangedAt = new Date();
    }
    return await salesTransaction(async tx => {
      await assertCrmRecordMutation(tx, 'leads', id, 'edit', dto);
      const current = await tx.lead.findFirst({ where: { id, tenantId, isArchived: false, deletedAt: null } });
      if (!current) throw new NotFoundError('Active Lead');
      if (dto.expectedUpdatedAt && current.updatedAt.toISOString() !== dto.expectedUpdatedAt) throw new ConflictError('This Lead changed. Reload its current status before saving.');
      await assertCustomerStatusEdit(tx, tenantId, { leadId: id }, current, dto.status);
      const preparedStatus = await prepareCustomerStatus(tx, tenantId, { leadId: id }, dto.status !== current.status || authorizedWorkflowScope(tenantId) ? dto.status : undefined);
      if (preparedStatus) { data.manualStatusContext = preparedStatus.checkpoint; data.status = preparedStatus.status; }
      if (dto.status !== undefined && (dto.status !== current.status || Object.keys(dto).filter(key => key !== 'expectedUpdatedAt').length === 1)) data.manualCancellation = dto.status === 'Cancelled';
      if (current.convertedAt) throw new ValidationError('This Lead has been converted. Update the linked Contact instead.');
      await assertContactAccountSelection(tx, tenantId, dto.accountId, current.accountId);
      if (dto.newAccount) {
        const account = await createLinkedAccount(tx, tenantId, dto.newAccount, updatedById, current.ownerGroupId);
        data.accountId = account.id; data.companyName = account.name; data.companyFromAccount = true;
      } else if (dto.accountId && dto.accountId !== current.accountId) {
        const account = await tx.account.findFirst({ where: { tenantId, id: dto.accountId, isArchived: false, deletedAt: null }, select: { name: true } });
        if (!account) throw new NotFoundError('Active Account');
        data.companyName = account.name;
        data.companyFromAccount = true;
      } else if (dto.companyName !== undefined && dto.companyName !== current.companyName) {
        data.companyFromAccount = false;
      }
      const previousCustom = dto.customFieldValues === undefined ? undefined : await readRecordValues(tx, tenantId, 'leads', id);
      await saveRecordValues(tx, tenantId, 'leads', id, dto.customFieldValues, updatedById);
      const finish = async <T extends LeadRecord>(saved: T): Promise<T> => {
        const changes = recordChanges(current, saved);
        if (previousCustom) {
          const after = await readRecordValues(tx, tenantId, 'leads', id);
          for (const key of new Set([...Object.keys(previousCustom), ...Object.keys(after)])) {
            if (isDeepStrictEqual(previousCustom[key] ?? null, after[key] ?? null)) continue;
            const field = `customFieldValues.${key}`;
            changes.changedFields.push(field); changes.before[field] = previousCustom[key] ?? null; changes.after[field] = after[key] ?? null;
          }
        }
        if (updatedById && changes.changedFields.length) await tx.auditLog.create({ data: { tenantId, userId: updatedById, action: 'lead.updated', entityType: 'Lead', entityId: id, metadata: { changedFields: changes.changedFields } } });
        if (onCommitted) await onCommitted(current, saved, changes);
        return saved;
      };
      if (dto.status) {
        if (data.status !== current.status) data.lastStatusChangedAt = new Date();
        else delete data.lastStatusChangedAt;
        if (data.status === 'Closed Deal' && data.status !== current.status) await assertClosedStatus(tx, tenantId, { leadId: id });
      }
      if (dto.productInterest) {
        const previous = await tx.lead.findFirstOrThrow({ where: { id, tenantId } });
        const retained = previous.productInterestIds.filter(id => dto.productInterest!.includes(id));
        const added = dto.productInterest.filter(id => !retained.includes(id));
        const products = await resolveProducts(tx, tenantId, added);
        const existing = await tx.productInterest.findMany({ where: { tenantId, id: { in: retained } } });
        // An explicit selection replaces the list, including an explicit empty selection.
        data.productInterestIds = [...retained, ...products.map(p => p.id)];
        data.productInterest = [...existing.map(p => p.name), ...products.map(p => p.name)];
      }
      if (dto.productInterest) Object.assign(data, await productRelationData(tx, 'lead', tenantId, { ids: dto.productInterest }, current, true));
      if (dto.accountId && !await tx.account.findFirst({ where: { id: dto.accountId, tenantId, isArchived: false, deletedAt: null } })) throw new ValidationError('Account is unavailable in this workspace.');
      if (dto.assignedUserId && dto.assignedUserId !== current.assignedUserId) await validateSalesOwner(tx, tenantId, dto.assignedUserId, ['leads', 'deals'], current.ownerGroupId);
      const updated = await tx.lead.update({
      where: { id, tenantId },
      data,
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        account:      { select: { id: true, name: true, industry: true, size: true, website: true, address: true } },
        createdBy:    { select: { id: true, firstName: true, lastName: true } },
        updatedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
    });
      if (updatedById && dto.status && updated.status !== current.status) await recordCustomerStatusChange(tx, tenantId, updatedById, { leadId: id }, current.status, normalizeCrmStatus(updated.status), 'Staff changed the CRM status.');
      if (updatedById && dto.assignedUserId !== undefined && dto.assignedUserId !== current.assignedUserId) {
        const assignment = dto.assignedUserId ? await assignmentSnapshot(tx, tenantId, current.assignedUserId, dto.assignedUserId, updatedById) : undefined;
        await tx.activity.create({ data: {
          tenantId, createdById: updatedById, leadId: id, type: 'assignment',
          ...(assignment ? formatAssignmentChange(assignment) : { title: 'Lead reassigned' }),
          metadata: { assignedUserId: dto.assignedUserId, previousUserId: current.assignedUserId, ...assignment },
        } });
      }
      if (updated.status !== 'Closed Deal' && (dto.assignedUserId || dto.productInterest)) await createProductDeals(tx, tenantId, id, updatedById);
      if (updatedById && data.manualCancellation === true) await cancelOpenDeals(tx, tenantId, updatedById, { leadId: id }, 'Staff explicitly cancelled the opportunity.');
      if (updated.status === 'Closed Deal' && updatedById) {
        await convertClosedLead(tx, tenantId, id, updatedById, { previousLead: current, emitLeadEvents: !onCommitted });
        return finish(await tx.lead.findFirstOrThrow({ where: { id, tenantId }, include: {
          assignedUser: { select: { id: true, firstName: true, lastName: true } }, account: { select: { id: true, name: true, industry: true, size: true, website: true, address: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } }, updatedBy: { select: { id: true, firstName: true, lastName: true } },
        } }));
      }
      if (updatedById) await classifyCustomerRecord(tx, tenantId, { leadId: id }, updatedById);
      return finish({ ...updated, ...await tx.lead.findFirstOrThrow({ where: { tenantId, id } }) });
    });
  } catch (error) {
    throw error;
  }
}

export async function archiveContact(id: string, tenantId: string, userId: string) {
  return prisma.lead.updateMany({
    where: { id, tenantId, isArchived: false },
    data: { isArchived: true, deletedAt: new Date(), deletedBy: userId },
  });
}

export async function restoreContact(id: string, tenantId: string) {
  return salesTransaction(async tx => {
    await assertCrmRecordMutation(tx, 'leads', id, 'restore');
    const lead = await tx.lead.findFirst({ where: { id, tenantId, isArchived: true } });
    if (!lead) return { count: 0 };
    if (lead.assignedUserId && !lead.convertedAt) {
      const agent = await tx.user.findFirst({ where: { id: lead.assignedUserId, tenantId, status: 'ACTIVE' }, select: { id: true } });
      if (!agent) throw new ConflictError('Reactivate the assigned agent before restoring this Lead.');
    }
    return tx.lead.updateMany({
      where: { id, tenantId, isArchived: true },
      // Legacy archives have no recoverable prior status.
      data: { isArchived: false, deletedAt: null, deletedBy: null,
        ...(lead.status === 'Archived' ? { status: 'Warm' } : {}) },
    });
  });
}

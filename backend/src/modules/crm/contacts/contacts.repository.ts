import type { Lead as LeadRecord } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { recordChanges } from '../record-updates';
import { normalizeCrmStatus } from '@leadcrm/shared';
import { readRecordValues, saveRecordValues } from '../closing-requirements/custom-field-values.repository';
import { productRelationData } from '../leads/product-relations';
import { parseLeadCreatedFilter } from '../leads/lead-created-filter';
import { convertClosedLead } from '../leads/lead-conversion.service';
import { assertClosedStatus, cancelOpenDeals } from '../engagement.service';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/http-error';
import prisma from '../../../config/database.config';
import { resolveProducts, createAssignedLead, salesTransaction, afterSalesCommit, createProductDeals, validateSalesOwner } from '../leads/lead-automation.service';
import { CreateContactDto, UpdateContactDto } from './contacts.dto';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { parseFilterParams, buildPrismaFilters } from '../../../shared/helpers/filter-parser';

// Allowed filter fields for leads/contacts — prevents arbitrary Prisma field injection
const CONTACT_FILTER_FIELDS = new Set(['status', 'source', 'leadSource', 'assignedUserId', 'accountId']);
// Map frontend field names → Prisma field names where they differ
const CONTACT_FIELD_ALIASES: Record<string, string> = {
  source: 'source',          // frontend sends 'source' (maps from leadSource client-side)
  leadSource: 'source',      // alternate frontend key
  assignedUserId: 'assignedUserId',
};

// All queries are scoped to tenantId — cross-tenant access is impossible by design
export async function findAllContacts(tenantId: string, query: Record<string, unknown>) {
  const { page, limit } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  // Parse filter[field]=operator:value params from the query string
  const parsedFilters = parseFilterParams(query);
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
  const scope = parsedFilters.find(filter => filter.field === 'scope')?.value;
  if (scope === 'my') filterClauses.push({ assignedUserId: String(query.currentUserId ?? '') });
  if (scope === 'active') filterClauses.push({ status: { in: ['Hot','Warm','HOT','WARM'] } });

  for (const field of ['email', 'phone']) if (related.includes('has_' + field)) filterClauses.push({ [field]: { not: null } }, { [field]: { not: '' } });
  if (systemValues.includes('touched') !== systemValues.includes('untouched')) filterClauses.push({ updatedAt: systemValues.includes('touched') ? { gt: prisma.lead.fields.createdAt } : { lte: prisma.lead.fields.createdAt } });
  if (query.status) filterClauses.push({ status: { in: [normalizeCrmStatus(String(query.status)), normalizeCrmStatus(String(query.status)).toUpperCase()] } });
  const createdAt = parseLeadCreatedFilter(query);
  const where: Record<string, unknown> = {
    ...(createdAt ? { createdAt } : {}),
    tenantId,
    isArchived: query.archived === 'true',
    ...(query.archived === 'true' ? {} : { convertedAt: null, deletedAt: null }),
    // accountId direct param (still used by relationship lookups)
    ...(query.accountId ? { accountId: String(query.accountId) } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName:   { contains: String(query.search), mode: 'insensitive' as const } },
            { lastName:    { contains: String(query.search), mode: 'insensitive' as const } },
            { email:       { contains: String(query.search), mode: 'insensitive' as const } },
            { companyName: { contains: String(query.search), mode: 'insensitive' as const } },
          ],
        }
      : {}),
    // filter[field]=operator:value clauses — all AND-combined at query level
    ...(filterClauses.length > 0 ? { AND: filterClauses } : {}),
  };

  const [sortKey, direction] = String(query.sort ?? 'createdAt:desc').split(':');
  const allowed = new Set(['firstName','email','phone','companyName','status','source','createdAt','updatedAt']);
  const sortField = allowed.has(sortKey) ? sortKey : 'createdAt';
  const sortDirection = direction === 'asc' ? 'asc' as const : 'desc' as const;
  const [data, total] = await Promise.all([
    prisma.lead.findMany({
      where, skip, take: limit,
      orderBy: [{ [sortField]: sortDirection }, { id: 'asc' }],
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        account:      { select: { id: true, name: true } },
        createdBy:    { select: { id: true, firstName: true, lastName: true } },
        updatedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  const [statuses, sources, agents, email, phone, touched] = await Promise.all([
    prisma.lead.groupBy({ by: ['status'], where, _count: true }),
    prisma.lead.groupBy({ by: ['source'], where, _count: true }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where, _count: true }),
    prisma.lead.count({ where: { AND: [where, { email: { not: null } }, { email: { not: '' } }] } }),
    prisma.lead.count({ where: { AND: [where, { phone: { not: null } }, { phone: { not: '' } }] } }),
    prisma.lead.count({ where: { AND: [where, { updatedAt: { gt: prisma.lead.fields.createdAt } }] } }),
  ]);
  const facets: Record<string, number> = { has_email: email, has_phone: phone, touched, untouched: total - touched };
  for (const row of statuses) { const key = 'status:' + normalizeCrmStatus(row.status); facets[key] = (facets[key] ?? 0) + row._count; }
  for (const row of sources) if (row.source) facets['source:' + row.source] = row._count;
  for (const row of agents) if (row.assignedUserId) facets['owner:' + row.assignedUserId] = row._count;
  return { data, total, page, limit, facets };
}

export async function findContactById(id: string, tenantId: string) {
  return prisma.lead.findFirst({
    where: { id, tenantId, isArchived: false, deletedAt: null },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      account:      { select: { id: true, name: true, industry: true } },
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
  const { requestId, productInterest, customFieldValues, ...fields } = dto;
  if (dto.status === 'Closed') throw new ValidationError('Confirm a related Deal as Closed Won before setting Closed.');
  return salesTransaction(async tx => {
    const existing = requestId ? await tx.lead.findFirst({ where: { tenantId, creationKey: requestId } }) : null;
    const lead = await createAssignedLead(tx, { ...fields, productInterestIds: productInterest ?? [], tenantId, creationKey: requestId,
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
    if (updatedById) data.updatedById = updatedById;
    // Stamp lastStatusChangedAt when status actually changes
    if (dto.status && prevStatus !== undefined && dto.status !== prevStatus) {
      data.lastStatusChangedAt = new Date();
    }
    return await salesTransaction(async tx => {
      const current = await tx.lead.findFirst({ where: { id, tenantId, isArchived: false, deletedAt: null } });
      if (!current) throw new NotFoundError('Active Lead');
      if (current.convertedAt) throw new ValidationError('This Lead has been converted. Update the linked Contact instead.');
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
        if (onCommitted) afterSalesCommit(() => onCommitted(current, saved, changes));
        return saved;
      };
      if (dto.status) {
        if (dto.status !== current.status) data.lastStatusChangedAt = new Date();
        else delete data.lastStatusChangedAt;
        if (dto.status === 'Closed') await assertClosedStatus(tx, tenantId, { leadId: id });
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
      if (dto.assignedUserId && dto.assignedUserId !== current.assignedUserId) await validateSalesOwner(tx, tenantId, dto.assignedUserId);
      const updated = await tx.lead.update({
      where: { id, tenantId },
      data,
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        account:      { select: { id: true, name: true } },
        createdBy:    { select: { id: true, firstName: true, lastName: true } },
        updatedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
    });
      if (updatedById && dto.status && dto.status !== current.status) await tx.activity.create({ data: {
        tenantId, createdById: updatedById, leadId: id, type: 'stage_change', title: `Status changed from ${current.status} to ${dto.status}`, description: 'Staff changed the CRM status.',
      } });
      if (updatedById && dto.assignedUserId !== undefined && dto.assignedUserId !== current.assignedUserId) await tx.activity.create({ data: {
        tenantId, createdById: updatedById, leadId: id, type: 'assignment', title: 'Lead reassigned',
        metadata: { assignedUserId: dto.assignedUserId, previousUserId: current.assignedUserId },
      } });
      if (dto.assignedUserId || dto.productInterest) await createProductDeals(tx, tenantId, id, updatedById);
      if (updatedById && updated.status === 'Cancelled') await cancelOpenDeals(tx, tenantId, updatedById, { leadId: id }, 'Staff explicitly cancelled the opportunity.');
      if (updated.status === 'Closed' && updatedById) {
        await convertClosedLead(tx, tenantId, id, updatedById);
        return finish(await tx.lead.findFirstOrThrow({ where: { id, tenantId }, include: {
          assignedUser: { select: { id: true, firstName: true, lastName: true } }, account: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } }, updatedBy: { select: { id: true, firstName: true, lastName: true } },
        } }));
      }
      return finish(updated);
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

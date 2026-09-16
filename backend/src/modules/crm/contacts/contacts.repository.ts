import prisma from '../../../config/database.config';
import { CreateContactDto, UpdateContactDto } from './contacts.dto';
import { getPaginationParams } from '../../../shared/helpers/pagination';
import { parseFilterParams, buildPrismaFilters } from '../../../shared/helpers/filter-parser';

// Allowed filter fields for leads/contacts — prevents arbitrary Prisma field injection
const CONTACT_FILTER_FIELDS = new Set(['status', 'source', 'assignedUserId', 'accountId']);
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
  const filterClauses = buildPrismaFilters(parsedFilters, CONTACT_FILTER_FIELDS, CONTACT_FIELD_ALIASES);

  const where: Record<string, unknown> = {
    tenantId,
    // Lead has no isArchived — archive is expressed as status='Archived'.
    // When filter[status]=in:Hot,Warm is present, archived records are naturally
    // excluded because 'Archived' is not in the list.
    // When no status filter is active, explicitly exclude archived records.
    ...(query.archived === 'true'
      ? { status: 'Archived' }
      : filterClauses.some((c) => 'status' in c)
        ? {}                            // filter[status] handles its own scoping
        : { status: { not: 'Archived' } }),
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

  const [data, total] = await Promise.all([
    prisma.lead.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        account:      { select: { id: true, name: true } },
        createdBy:    { select: { id: true, firstName: true, lastName: true } },
        updatedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return { data, total, page, limit };
}

export async function findContactById(id: string, tenantId: string) {
  return prisma.lead.findFirst({
    where: { id, tenantId },
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
  return prisma.lead.create({
    data: { ...dto, tenantId, ...(createdById ? { createdById, updatedById: createdById } : {}) },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      account:      { select: { id: true, name: true } },
      createdBy:    { select: { id: true, firstName: true, lastName: true } },
      updatedBy:    { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function updateContact(
  id: string,
  tenantId: string,
  dto: UpdateContactDto,
  updatedById?: string,
  prevStatus?: string,
) {
  try {
    const data: Record<string, unknown> = { ...dto };
    if (updatedById) data.updatedById = updatedById;
    // Stamp lastStatusChangedAt when status actually changes
    if (dto.status && prevStatus !== undefined && dto.status !== prevStatus) {
      data.lastStatusChangedAt = new Date();
    }
    return await prisma.lead.update({
      where: { id, tenantId },
      data,
      include: {
        assignedUser: { select: { id: true, firstName: true, lastName: true } },
        account:      { select: { id: true, name: true } },
        createdBy:    { select: { id: true, firstName: true, lastName: true } },
        updatedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
    });
  } catch {
    // Record not found or cross-tenant attempt
    return null;
  }
}

export async function archiveContact(id: string, tenantId: string, _userId: string) {
  try {
    // Lead has no isArchived — archive is expressed as status change
    return await prisma.lead.update({
      where: { id, tenantId },
      data:  { status: 'Archived' },
    });
  } catch {
    return null;
  }
}

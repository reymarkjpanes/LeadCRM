import { validateProductSnapshots, normalizeProductOther } from '../leads/product-snapshots';
import { sortedPageIds, orderPage } from '../../../shared/helpers/sorted-page';
import prisma from '../../../config/database.config';
import { CrmStatusSchema, normalizeCrmStatus } from '@leadcrm/shared';
import { salesTransaction } from '../leads/lead-automation.service';
import { assertClosedStatus, cancelOpenDeals, contactStatusValue } from '../engagement.service';
import { ValidationError } from '../../../shared/errors/http-error';
import { getPaginationParams } from '../../../shared/helpers/pagination';

/**
 * Contacts V2 Repository — queries the Contact table.
 *
 * Field mapping (schema ↔ DB):
 *   company        → Contact.company       (plain text, company name)
 *   accountId      → Contact.accountId      (FK → Account.id)  ← CANONICAL company link (ADR-001)
 *   status         → ContactStatus enum    (HOT | WARM | COLD | CANCELLED | CLOSED)
 *   productInterests → String[]
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

  const where: Record<string, unknown> = {
    tenantId,
    isArchived: query.archived === 'true',
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
      { phone:     { contains: term, mode: 'insensitive' } },
    ];
  }

  const ids = await sortedPageIds(query.sort === 'createdAt:desc' ? undefined : query.sort, ['firstName', 'email', 'company', 'createdAt'], skip, limit,
    () => prisma.contact.findMany({ where, select: { id: true, firstName: true, lastName: true, email: true, company: true, createdAt: true } }));
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

  return { data: orderPage(data, ids), total, page, limit };
}

export async function findContactById(id: string, tenantId: string) {
  return prisma.contact.findFirst({
    where: { id, tenantId, isArchived: false },
    include: CONTACT_INCLUDE,
  });
}

export async function createContact(tenantId: string, dto: Record<string, unknown>) {
  if (dto.status === 'Closed') throw new ValidationError('Confirm a related Deal as Closed Won before setting Closed.');
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests);
  normalizeProductOther(dto, (dto.productInterests as string[] | undefined) ?? []);
  return prisma.contact.create({
    data: { ...dto, tenantId, status: CrmStatusSchema.parse(dto.status).toUpperCase() } as never,
    include: CONTACT_INCLUDE,
  });
}

export async function updateContact(id: string, tenantId: string, dto: Record<string, unknown>, actorId?: string) {
  const previous = await prisma.contact.findFirst({ where: { id, tenantId } });
  dto.productInterests = await validateProductSnapshots(tenantId, dto.productInterests, previous?.productInterests);
  normalizeProductOther(dto, (dto.productInterests as string[] | undefined) ?? previous?.productInterests ?? [], previous?.productInterestOther);
  return salesTransaction(async tx => {
    const current = await tx.contact.findFirstOrThrow({ where: { id, tenantId } });
    const status = dto.status === undefined ? undefined : CrmStatusSchema.parse(dto.status);
    if (status === 'Closed' && normalizeCrmStatus(current.status) !== 'Closed') await assertClosedStatus(tx, tenantId, { contactId: id });
    const contact = await tx.contact.update({
      where:   { id, tenantId } as never,
      data: { ...dto, ...(status ? { status: contactStatusValue(status), ...(status !== normalizeCrmStatus(current.status) ? { lastStatusChangedAt: new Date() } : {}) } : {}) } as never,
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

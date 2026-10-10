import { ContactStatus, Prisma } from '@prisma/client';
import { CrmStatus, normalizeCrmStatus } from '@leadcrm/shared';
import { ValidationError } from '../../shared/errors/http-error';
import { convertClosedLead } from './leads/lead-conversion.service';

export type CustomerLink = { leadId: string; contactId?: never } | { contactId: string; leadId?: never };
type Tx = Prisma.TransactionClient;
// Keep the existing database enum adapter; public contracts and histories use canonical labels.
const contactStatuses: Record<CrmStatus, ContactStatus> = { Hot: ContactStatus.HOT, Warm: ContactStatus.WARM, Cold: ContactStatus.COLD, Closed: ContactStatus.CLOSED, Cancelled: ContactStatus.CANCELLED };
export const contactStatusValue = (value: CrmStatus) => contactStatuses[value];
export const customerDealWhere = (tenantId: string, link: CustomerLink): Prisma.DealWhereInput => ({ tenantId, isArchived: false, deletedAt: null,
  ...(link.leadId ? { leadDeals: { some: { tenantId, leadId: link.leadId } } } : { contactDeals: { some: { tenantId, contactId: link.contactId } } }),
});

export async function changeCustomerStatus(tx: Tx, tenantId: string, actorId: string, link: CustomerLink, status: CrmStatus, reason: string, changedAt: Date) {
  const current = link.leadId ? await tx.lead.findFirst({ where: { tenantId, id: link.leadId } }) : await tx.contact.findFirst({ where: { tenantId, id: link.contactId } });
  if (!current) return;
  if (normalizeCrmStatus(current.status) === status) {
    if (link.leadId && status === 'Closed') await convertClosedLead(tx, tenantId, link.leadId, actorId);
    return;
  }
  if (link.leadId) await tx.lead.update({ where: { tenantId, id: link.leadId }, data: { status, lastStatusChangedAt: changedAt } });
  else await tx.contact.update({ where: { tenantId, id: link.contactId }, data: { status: contactStatuses[status], lastStatusChangedAt: changedAt } });
  const activity = await tx.activity.create({ data: { tenantId, createdById: actorId, ...link, type: 'stage_change',
    title: `Status changed from ${normalizeCrmStatus(current.status)} to ${status}`, description: reason,
    metadata: { source: 'customer_engagement', occurredAt: changedAt.toISOString() } } });
  if (link.leadId && status === 'Closed') await convertClosedLead(tx, tenantId, link.leadId, actorId);
  return { eventId: activity.id, prevStatus: current.status, status, id: current.id };
}

/** Shared cancellation transition; never touches historical terminal Deals. */
export async function cancelOpenDeals(tx: Tx, tenantId: string, actorId: string, link: CustomerLink, reason: string, onlyDealId?: string, occurredAt = new Date()) {
  const deals = await tx.deal.findMany({ where: { ...customerDealWhere(tenantId, link), ...(onlyDealId ? { id: onlyDealId } : {}), stage: { isWon: false, isLost: false } }, include: { stage: true } });
  for (const deal of deals) {
    if (!['lead', 'contacted', 'qualified'].includes(deal.stage.name.toLowerCase())) continue;
    const lost = await tx.stage.findMany({ where: { tenantId, pipelineId: deal.pipelineId, isLost: true, isWon: false } });
    if (lost.length !== 1) continue;
    await tx.deal.update({ where: { tenantId, id: deal.id }, data: { stageId: lost[0].id, closedAt: occurredAt, lostReason: reason, stageChangedAt: occurredAt } });
    await tx.dealStageHistory.create({ data: { tenantId, dealId: deal.id, previousStageId: deal.stageId, newStageId: lost[0].id, movedById: actorId, note: reason } });
    await tx.activity.create({ data: { tenantId, dealId: deal.id, createdById: actorId, type: 'stage_change', title: `Deal moved from ${deal.stage.name} to ${lost[0].name}`, description: reason } });
  }
}

export async function assertClosedStatus(tx: Tx, tenantId: string, link: CustomerLink) {
  if (!await tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), stage: { isWon: true }, wonConfirmedAt: { not: null } } })) {
    throw new ValidationError('Confirm a related Deal as Closed Won before setting this record to Closed.');
  }
}

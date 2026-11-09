import { refreshDealClassification } from './customer-classification.service';
import { ContactStatus, Prisma } from '@prisma/client';
import { CrmStatus, normalizeCrmStatus } from '@leadcrm/shared';
import { ValidationError } from '../../shared/errors/http-error';
import { convertClosedLead, type LeadConversionEvents } from './leads/lead-conversion.service';
import { fireContactStatusChanged, fireContactUpdated, fireDealStageChanged, fireDealUpdated } from '../automation/triggers/triggers.service';
import { recordChanges } from './record-updates';
import { salesContext } from './leads/sales-context';
import { authorizedWorkflowScope, readCrmStatusEvidence, writeDerivedCustomerStatus } from './access/crm-record-access.service';

export type CustomerLink = { leadId: string; contactId?: never } | { contactId: string; leadId?: never };
type Tx = Prisma.TransactionClient;
// Keep the existing database enum adapter; public contracts and histories use canonical labels.
const contactStatuses: Record<CrmStatus, ContactStatus> = { Inquiry: ContactStatus.INQUIRY, Hot: ContactStatus.HOT, Warm: ContactStatus.WARM, Cold: ContactStatus.COLD, 'Closed Deal': ContactStatus.CLOSED_DEAL, Cancelled: ContactStatus.CANCELLED };
export const contactStatusValue = (value: CrmStatus) => contactStatuses[value];
export const customerDealWhere = (tenantId: string, link: CustomerLink): Prisma.DealWhereInput => ({ tenantId, isArchived: false, deletedAt: null,
  ...(link.leadId ? { leadDeals: { some: { tenantId, leadId: link.leadId } } } : { contactDeals: { some: { tenantId, contactId: link.contactId } } }),
});

export async function finalizeContactLifecycle(tx: Tx, tenantId: string, contactId: string, actorId?: string) {
  const contact = await tx.contact.findFirstOrThrow({ where: { tenantId, id: contactId } });
  const firstWon = await readCrmStatusEvidence(() => tx.deal.findFirst({ where: { tenantId, contactDeals: { some: { tenantId, contactId } }, wonConfirmedAt: { not: null } }, orderBy: { wonConfirmedAt: 'asc' }, select: { wonConfirmedAt: true } }));
  if (!firstWon?.wonConfirmedAt) throw new ValidationError('Confirmed Won evidence is required to close this Contact.');
  const customerSince = contact.customerSince && contact.customerSince <= firstWon.wonConfirmedAt ? contact.customerSince : firstWon.wonConfirmedAt;
  if (contact.lifecycleStage === 'CUSTOMER' && contact.customerSince?.getTime() === customerSince.getTime()) return;
  await tx.contact.update({ where: { tenantId, id: contactId }, data: { lifecycleStage: 'CUSTOMER', customerSince } });
  if (actorId) {
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'contact.customer_finalized', entityType: 'Contact', entityId: contactId,
      changeset: { before: { lifecycleStage: contact.lifecycleStage, customerSince: contact.customerSince?.toISOString() ?? null }, after: { lifecycleStage: 'CUSTOMER', customerSince: customerSince.toISOString() } } } });
    await tx.activity.create({ data: { tenantId, contactId, createdById: actorId, type: 'customer_lifecycle', title: 'Customer lifecycle confirmed from Won evidence', metadata: { customerSince: customerSince.toISOString() } } });
  }
}

export async function changeCustomerStatus(tx: Tx, tenantId: string, actorId: string, link: CustomerLink, status: CrmStatus, reason: string, changedAt: Date, conversionEvents: LeadConversionEvents = {}, emit = true, source = 'customer_engagement', derived = false) {
  const current = link.leadId ? await tx.lead.findFirst({ where: { tenantId, id: link.leadId } }) : await tx.contact.findFirst({ where: { tenantId, id: link.contactId } });
  if (!current) return;
  if (derived) {
    if (normalizeCrmStatus(current.status) === status) return;
    const changed = await writeDerivedCustomerStatus(tx, tenantId, link, { lead: status, contact: contactStatusValue(status) }, changedAt);
    if (!changed.count) return;
    const activity = await recordCustomerStatusChange(tx, tenantId, actorId, link, current.status, status, reason, changedAt, source);
    return { eventId: activity.id, prevStatus: current.status, status, id: current.id };
  }
  if (emit && link.contactId && status === 'Closed Deal') {
    await finalizeContactLifecycle(tx, tenantId, link.contactId, actorId);
  }
  if (normalizeCrmStatus(current.status) === status) {
    if (emit && link.leadId && status === 'Closed Deal') await convertClosedLead(tx, tenantId, link.leadId, actorId, { previousLead: current, ...conversionEvents });
    if (emit && link.contactId && status === 'Closed Deal') {
      const contact = await tx.contact.findFirstOrThrow({ where: { tenantId, id: link.contactId } });
      const changes = recordChanges(current, contact);
      await salesContext.run(tx, () => fireContactUpdated({ tenantId, actorId, record: contact, changedFields: changes.changedFields, changes }));
    }
    return;
  }
  if (link.leadId) await tx.lead.update({ where: { tenantId, id: link.leadId }, data: { status, lastStatusChangedAt: changedAt } });
  else await tx.contact.update({ where: { tenantId, id: link.contactId }, data: { status: contactStatuses[status], lastStatusChangedAt: changedAt } });
  const activity = await recordCustomerStatusChange(tx, tenantId, actorId, link, current.status, status, reason, changedAt, source);
  if (emit && link.leadId && status === 'Closed Deal') await convertClosedLead(tx, tenantId, link.leadId, actorId, { previousLead: current, ...conversionEvents });
  if (emit && link.contactId && status === 'Closed Deal') {
    const contact = await tx.contact.findFirstOrThrow({ where: { tenantId, id: link.contactId } });
    const changes = recordChanges(current, contact);
    await salesContext.run(tx, async () => {
      await fireContactUpdated({ tenantId, actorId, eventId: activity.id, record: contact, changedFields: changes.changedFields, changes });
      await fireContactStatusChanged({ tenantId, actorId, eventId: activity.id, contact, prevStatus: current.status });
    });
  }
  return { eventId: activity.id, prevStatus: current.status, status, id: current.id };
}

/** One transition history path for manual, classified and conversion updates. */
export async function recordCustomerStatusChange(tx: Tx, tenantId: string, actorId: string, link: CustomerLink,
  previous: string, status: CrmStatus, reason: string, changedAt = new Date(), source = 'manual') {
  const workflow = authorizedWorkflowScope(tenantId);
  const activity = await tx.activity.create({ data: { tenantId, createdById: actorId, ...link, type: 'stage_change',
    title: `Status changed from ${normalizeCrmStatus(previous)} to ${status}`, description: reason,
    metadata: { source: workflow ? 'workflow' : source, previousStatus: normalizeCrmStatus(previous), newStatus: status,
      ...(workflow ? { execution: workflow.provenance } : {}), occurredAt: changedAt.toISOString() } } });
  await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'customer.status_changed', entityType: link.leadId ? 'Lead' : 'Contact',
    entityId: link.leadId ?? link.contactId!, changeset: { before: { status: normalizeCrmStatus(previous) }, after: { status }, reason } } });
  return activity;
}

/** Shared cancellation transition; never touches historical terminal Deals. */
export async function cancelOpenDeals(tx: Tx, tenantId: string, actorId: string, link: CustomerLink, reason: string, onlyDealId?: string, occurredAt = new Date()) {
  const deals = await tx.deal.findMany({ where: { ...customerDealWhere(tenantId, link), ...(onlyDealId ? { id: onlyDealId } : {}), stage: { isWon: false, isLost: false } }, include: { stage: true } });
  for (const deal of deals) {
    if (!['lead', 'contacted', 'qualified'].includes(deal.stage.name.toLowerCase())) continue;
    const lost = await tx.stage.findMany({ where: { tenantId, pipelineId: deal.pipelineId, isLost: true, isWon: false } });
    if (lost.length !== 1) continue;
    const updated = await tx.deal.update({ where: { tenantId, id: deal.id }, data: { stageId: lost[0].id, closedAt: occurredAt, lostReason: reason, stageChangedAt: occurredAt } });
    const history = await tx.dealStageHistory.create({ data: { tenantId, dealId: deal.id, previousStageId: deal.stageId, newStageId: lost[0].id, movedById: actorId, note: reason, movedAt: occurredAt } });
    await tx.deal.update({ where: { tenantId, id: deal.id }, data: { currentStageHistoryId: history.id } });
    await tx.activity.create({ data: { tenantId, dealId: deal.id, createdById: actorId, type: 'stage_change', title: `Deal moved from ${deal.stage.name} to ${lost[0].name}`, description: reason } });
    await tx.auditLog.create({ data: { tenantId, userId: actorId, action: 'deal.stage_changed', entityType: 'Deal', entityId: deal.id, metadata: { source: 'customer_cancellation', previousStageId: deal.stageId, newStageId: lost[0].id } } });
    await fireDealStageChanged({ tenantId, actorId, eventId: history.id, deal: updated, prevStageId: deal.stageId, newStageId: lost[0].id, newStageName: lost[0].name, isWon: false, isLost: true });
    const changes = recordChanges(deal, updated);
    await fireDealUpdated({ tenantId, actorId, eventId: history.id, record: updated, changedFields: changes.changedFields, changes });
    await refreshDealClassification(tx, tenantId, deal.id, actorId);
  }
}

export async function assertClosedStatus(tx: Tx, tenantId: string, link: CustomerLink) {
  if (!await readCrmStatusEvidence(() => tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), stage: { isWon: true }, wonConfirmedAt: { not: null } } }))) {
    throw new ValidationError('Confirm a related Deal as Closed Deal before setting this record to Closed Deal.');
  }
}

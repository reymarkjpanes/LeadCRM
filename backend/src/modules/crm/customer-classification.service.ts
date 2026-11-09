import { Prisma } from '@prisma/client';
import { aggregateDealEngagement, classifyCustomer, normalizeCrmStatus, CRM_STATUSES, type CrmStatus } from '@leadcrm/shared';
import { evaluateDealEngagement } from './deals/deal-engagement.service';
import { acceptsStatusReply, isManualStatus, manualStatusCheckpoint, replyStatusCheckpoint } from './status-checkpoint';
import { ValidationError } from '../../shared/errors/http-error';
import { AppError } from '../../shared/errors/app-error';
import { communicationDealContext } from './leads/sales-context';
import { assertCrmRecordMutation, readCrmStatusEvidence } from './access/crm-record-access.service';
import { changeCustomerStatus, customerDealWhere, assertClosedStatus, type CustomerLink } from './engagement.service';
import { fireLeadStatusChanged, fireContactStatusChanged } from '../automation/triggers/triggers.service';

export async function prepareCustomerStatus(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink, requested: CrmStatus | undefined) {
  if (requested === undefined) return undefined;
  if (['Closed Deal', 'Cancelled'].includes(requested)) return { status: requested, checkpoint: Prisma.DbNull };
  const sale = await readCrmStatusEvidence(() => tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), stage: { isWon: true }, wonConfirmedAt: { not: null } }, select: { id: true } }));
  if (sale) {
    if (requested === 'Inquiry') return { status: 'Closed Deal' as const, checkpoint: Prisma.DbNull }; // Reopen directly to the canonical sale outcome.
    throw new ValidationError('This customer has a confirmed sale. Use the existing governed Deal actions.');
  }
  return { status: requested, checkpoint: manualStatusCheckpoint(requested) };
}

export async function hasQualifiedDeal(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink) {
  return !!await tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link),
    pipeline: { tenantId, isArchived: false }, stage: { tenantId, isWon: false, isLost: false, name: { equals: 'Qualified', mode: 'insensitive' } },
  }, select: { id: true } });
}

export function classifyCustomerRecord(...args: Parameters<typeof classifyCustomerWithEvidence>) {
  return readCrmStatusEvidence(() => classifyCustomerWithEvidence(...args));
}

const aggregateDealSelect = {
  id: true, pipelineId: true, engagementStatus: true, isArchived: true, wonConfirmedAt: true,
  stage: { select: { isWon: true, isLost: true } }, pipeline: { select: { isArchived: true } },
} satisfies Prisma.DealSelect;
type AggregateDeal = Prisma.DealGetPayload<{ select: typeof aggregateDealSelect }>;

function aggregate(deals: AggregateDeal[]) {
  return aggregateDealEngagement(deals.map(deal => ({ ...deal, ...deal.stage,
    pipelineArchived: deal.pipeline.isArchived, confirmedWon: deal.stage.isWon && !!deal.wonConfirmedAt })));
}

function linkedDeals(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink) {
  return readCrmStatusEvidence(async () => await tx.deal.findMany({
    where: { ...customerDealWhere(tenantId, link), isArchived: undefined, stage: { tenantId }, pipeline: { tenantId } },
    select: aggregateDealSelect, orderBy: { id: 'asc' },
  }));
}

/** Called only for a newly persisted, verified customer reply, before history replay. */
export async function acceptCustomerReply(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink, actorId: string, at: Date, key: string, originDealId?: string) {
  const current = link.leadId
    ? await tx.lead.findFirst({ where: { tenantId, id: link.leadId, isArchived: false, deletedAt: null, convertedAt: null } })
    : await tx.contact.findFirst({ where: { tenantId, id: link.contactId, isArchived: false, deletedAt: null } });
  if (!current || current.manualCancellation || ['Closed Deal', 'Cancelled'].includes(normalizeCrmStatus(current.status)) ||
    !acceptsStatusReply(current.manualStatusContext, at, current.lastCustomerReplyAt, current.lastStatusChangedAt ?? current.updatedAt)) return;
  try { await assertCrmRecordMutation(tx, link.leadId ? 'leads' : 'contacts', current.id); }
  catch (error) { if (error instanceof AppError && [403, 404].includes(error.statusCode)) return; throw error; }
  const data = { lastCustomerReplyAt: at, firstUnansweredOutboundAt: null, engagementEvaluatedAt: new Date(), manualStatusContext: replyStatusCheckpoint(at, key) };
  if (link.leadId) await tx.lead.update({ where: { tenantId, id: link.leadId }, data });
  else await tx.contact.update({ where: { tenantId, id: link.contactId }, data });
  if ((await linkedDeals(tx, tenantId, link)).length) return;
  const change = await changeCustomerStatus(tx, tenantId, actorId, link, 'Warm', 'Verified inbound customer reply.', at, {}, true, 'gmail');
  if (change && link.leadId) await fireLeadStatusChanged({ tenantId, actorId, originDealId: originDealId ?? null, eventId: change.eventId, lead: { id: current.id, status: 'Warm' }, prevStatus: change.prevStatus });
  else if (change && link.contactId) await fireContactStatusChanged({ tenantId, actorId, originDealId: originDealId ?? null, eventId: change.eventId, contact: { id: current.id, status: 'Warm' }, prevStatus: change.prevStatus });
}

async function classifyCustomerWithEvidence(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink, actorId: string,
  evidence: { genuineReply?: boolean; qualificationChanged?: boolean; originDealId?: string; source?: string; dealOnly?: boolean } = {}, now = new Date(), emit = true): Promise<void> {
  const current = link.leadId ? await tx.lead.findFirst({ where: { tenantId, id: link.leadId, isArchived: false, deletedAt: null } })
    : await tx.contact.findFirst({ where: { tenantId, id: link.contactId, isArchived: false, deletedAt: null } });
  if (!current) return;
  const deals = await linkedDeals(tx, tenantId, link);
  const derived = aggregate(deals);
  if (derived) {
    const change = await changeCustomerStatus(tx, tenantId, actorId, link, derived, 'Status recalculated from associated Deals.', now, {}, emit, evidence.source ?? 'deal_aggregate', true);
    if (!emit || !change) return;
    if (link.leadId) await fireLeadStatusChanged({ tenantId, actorId, originDealId: null, eventId: change.eventId, lead: { id: current.id, status: derived }, prevStatus: change.prevStatus });
    else await fireContactStatusChanged({ tenantId, actorId, originDealId: null, eventId: change.eventId, contact: { id: current.id, status: derived }, prevStatus: change.prevStatus });
    return;
  }
  if (evidence.dealOnly || deals.length) return;
  if ('contactId' in current && current.contactId && current.convertedAt) await classifyCustomerRecord(tx, tenantId, { contactId: current.contactId }, actorId, evidence, now, emit);
  if (current.manualCancellation || isManualStatus(current.manualStatusContext)) return;
  const status = classifyCustomer({ ...current, ...evidence, qualified: false }, now);
  if (!status || status === normalizeCrmStatus(current.status)) return;
  try { await assertCrmRecordMutation(tx, link.leadId ? 'leads' : 'contacts', current.id); }
  catch (error) { if (error instanceof AppError && [403, 404].includes(error.statusCode)) return; throw error; }
  const change = await changeCustomerStatus(tx, tenantId, actorId, link, status,
    'Customer classification reevaluated from verified engagement evidence.', now, {}, emit, evidence.source);
  if (!emit) return;
  if (change && link.leadId) await fireLeadStatusChanged({ tenantId, actorId, originDealId: evidence.originDealId, eventId: change.eventId, lead: { id: current.id, status }, prevStatus: change.prevStatus });
  else if (change && link.contactId) await fireContactStatusChanged({ tenantId, actorId, originDealId: evidence.originDealId, eventId: change.eventId, contact: { id: current.id, status }, prevStatus: change.prevStatus });
}

export async function synchronizeDealCustomers(tx: Prisma.TransactionClient, tenantId: string, dealIds: string[], actorId: string,
  previous: CustomerLink[] = [], now = new Date(), emit = true, source?: string) {
  const where = { tenantId, dealId: { in: dealIds } };
  const [leads, contacts] = await Promise.all([
    tx.leadDeal.findMany({ where, select: { leadId: true } }),
    tx.contactDeal.findMany({ where, select: { contactId: true } }),
  ]);
  const links: CustomerLink[] = [...leads, ...contacts, ...previous];
  const unique = new Map(links.map(link => [link.leadId ? `lead:${link.leadId}` : `contact:${link.contactId}`, link]));
  for (const key of [...unique.keys()].sort()) await classifyCustomerRecord(tx, tenantId, unique.get(key)!, actorId, { dealOnly: true, source }, now, emit);
}

export async function refreshDealClassification(tx: Prisma.TransactionClient, tenantId: string, dealId: string, actorId: string, previous: CustomerLink[] = [], now = new Date(), emit = true, originDealId?: string, source?: string) {
  return communicationDealContext.run(originDealId ?? communicationDealContext.getStore() ?? dealId, async () => {
    const evaluated = await evaluateDealEngagement(tx, tenantId, dealId, actorId, now, emit);
    await synchronizeDealCustomers(tx, tenantId, [dealId], actorId, previous, now, emit, source);
    return evaluated;
  });
}

/** Keep status choices on the Deal side of the relationship. */
export async function applyManagedCustomerStatus(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink, actorId: string | undefined,
  current: string, requested: CrmStatus | undefined) {
  if (requested === undefined) return false;
  const deals = await linkedDeals(tx, tenantId, link);
  const managed = aggregate(deals);
  if (!managed) return false;
  if (requested === normalizeCrmStatus(current)) return true;
  const open = deals.filter(deal => !deal.isArchived && !deal.pipeline.isArchived && !deal.stage.isWon && !deal.stage.isLost);
  const cancelled = deals.filter(deal => !deal.isArchived && !deal.pipeline.isArchived && deal.stage.isLost);
  const targets = requested === 'Cancelled' ? open : requested === 'Inquiry' && managed === 'Cancelled' && cancelled.length === 1 ? cancelled : [];
  if (!actorId || !targets.length) throw new ValidationError('Status follows associated Deals. Update the appropriate Deal to change it.');
  const { moveDealStage } = await import('./deals/deals.service.js');
  for (const deal of targets) {
    const stages = await tx.stage.findMany({ where: { tenantId, pipelineId: deal.pipelineId, isWon: false,
      ...(requested === 'Cancelled' ? { isLost: true } : { isLost: false, name: { equals: 'Lead', mode: 'insensitive' } }) }, take: 2 });
    if (stages.length !== 1) throw new ValidationError('Configure one matching stage in the Deal pipeline.');
    await moveDealStage(deal.id, tenantId, actorId, { stageId: stages[0].id,
      ...(requested === 'Cancelled' ? { lostReason: 'Staff cancelled the related customer opportunity.' } : {}) },
    undefined, { deferCustomerStatus: true });
  }
  await synchronizeDealCustomers(tx, tenantId, targets.map(deal => deal.id), actorId);
  return true;
}

/** Manual engagement is allowed; terminal actions keep their existing prerequisites. */
export async function assertCustomerStatusEdit(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink,
  current: { status: string; manualCancellation: boolean }, requested: string | undefined) {
  if (requested === undefined || requested === normalizeCrmStatus(current.status) || requested === 'Cancelled') return;
  if (normalizeCrmStatus(current.status) === 'Closed Deal') throw new ValidationError('Closed Deal follows confirmed sale evidence. Use the existing governed Deal actions.');
  if (current.manualCancellation && requested === 'Inquiry') return;
  if (normalizeCrmStatus(current.status) === 'Cancelled' && requested !== 'Inquiry') throw new ValidationError('Reopen this customer to Inquiry before changing engagement.');
  if (requested === 'Closed Deal') await readCrmStatusEvidence(() => assertClosedStatus(tx, tenantId, link));
}

export function withCustomerStatusPolicy<T extends { id: string }>(tx: Prisma.TransactionClient, tenantId: string, kind: 'lead' | 'contact', records: T[]) {
  return readCrmStatusEvidence(() => customerStatusPolicyWithEvidence(tx, tenantId, kind, records));
}

async function customerStatusPolicyWithEvidence<T extends { id: string }>(tx: Prisma.TransactionClient, tenantId: string, kind: 'lead' | 'contact', records: T[]) {
  const where = { tenantId, deal: { tenantId, deletedAt: null, stage: { tenantId }, pipeline: { tenantId } } };
  const ids = records.map(record => record.id);
  const deal = { select: aggregateDealSelect };
  const links = kind === 'lead' ? await tx.leadDeal.findMany({ where: { ...where, leadId: { in: ids } }, select: { leadId: true, deal } })
    : await tx.contactDeal.findMany({ where: { ...where, contactId: { in: ids } }, select: { contactId: true, deal } });
  return records.map(record => {
    const current = record as T & { status?: string };
    const deals = links.filter(link => ('leadId' in link ? link.leadId : link.contactId) === record.id).map(link => link.deal);
    const managed = aggregate(deals);
    const canClose = deals.some(deal => !deal.isArchived && deal.wonConfirmedAt && deal.stage.isWon);
    const status = normalizeCrmStatus(current.status);
    const { manualStatusContext: _checkpoint, ...visible } = record as T & { manualStatusContext?: unknown };
    const statusEditOptions = CRM_STATUSES.filter(option => managed
      ? option === status || (managed === 'Cancelled' ? option === 'Inquiry' && deals.filter(deal => deal.stage.isLost && !deal.isArchived && !deal.pipeline.isArchived).length === 1
        : managed !== 'Closed Deal' && option === 'Cancelled')
      : status === 'Cancelled' ? option === 'Inquiry' : status === 'Closed Deal' ? option === 'Closed Deal' || option === 'Cancelled' : option !== 'Closed Deal' || canClose);
    const reason = managed ? 'Status follows associated Deals.' : status === 'Cancelled' ? 'Reopen to Inquiry before changing engagement.'
      : status === 'Closed Deal' ? 'Closed Deal follows confirmed sale evidence. Use the governed Deal actions.'
      : 'Confirm a related Deal as Closed Deal first.';
    return { ...visible, statusManagedByDeals: !!managed || status === 'Closed Deal', statusEditOptions,
      statusEditRestrictions: Object.fromEntries(CRM_STATUSES.filter(option => !statusEditOptions.includes(option)).map(option => [option, reason])) };
  });
}

export async function recordStaffOutreach(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink, occurredAt: Date): Promise<void> {
  if (!Number.isFinite(+occurredAt) || +occurredAt > Date.now()) return;
  const where = { tenantId, id: link.leadId ?? link.contactId, OR: [{ firstStaffOutreachAt: null }, { firstStaffOutreachAt: { gt: occurredAt } }] };
  if (link.leadId) {
    const lead = await tx.lead.findFirst({ where: { tenantId, id: link.leadId }, select: { convertedAt: true, contactId: true } });
    if (lead?.convertedAt && lead.contactId) return recordStaffOutreach(tx, tenantId, { contactId: lead.contactId }, occurredAt);
    await tx.lead.updateMany({ where, data: { firstStaffOutreachAt: occurredAt } });
  } else await tx.contact.updateMany({ where, data: { firstStaffOutreachAt: occurredAt } });
}

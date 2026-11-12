import { Prisma, type Deal } from '@prisma/client';
import { classifyDealEngagement, QuotationDraftSchema, type DealEngagementEvent } from '@leadcrm/shared';
import { fireDealUpdated } from '../../automation/triggers/triggers.service';
import { assertCrmRecordMutation } from '../access/crm-record-access.service';
import { AppError } from '../../../shared/errors/app-error';
import { salesContext } from '../leads/sales-context';
import { ValidationError } from '../../../shared/errors/http-error';
import { acceptsStatusReply, isManualStatus, replyStatusCheckpoint, statusContext } from '../status-checkpoint';
import { customerDealWhere, recordDealEngagementChange, type CustomerLink } from '../engagement.service';
import { isMailboxForward } from '../../../integrations/gmail/mailbox-engagement';

/** Shared verified inputs for classification and manual-status checkpoints. */
export async function readDealEngagementEvidence(tx: Prisma.TransactionClient, tenantId: string, dealId: string, now: Date) {
  const [qualifications, messages] = await Promise.all([
    tx.dealStageHistory.findMany({ where: { tenantId, dealId, newStage: { tenantId, name: { equals: 'Qualified', mode: 'insensitive' }, isWon: false, isLost: false } },
      orderBy: [{ movedAt: 'asc' }, { id: 'asc' }], select: { previousStageId: true, newStageId: true, movedAt: true } }),
    tx.mailboxMessage.findMany({ where: { tenantId, dealId,
      NOT: [{ dealAttribution: { equals: Prisma.DbNull } }, { labels: { hasSome: ['DRAFT', 'SPAM', 'TRASH', 'DELETED'] } }],
      engagementRuleVersion: 2, participantPolicyVersion: 1, sentAt: { lte: now } },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }], select: { id: true, accountId: true, providerMessageId: true, rfcMessageId: true, direction: true, meaningful: true, sentAt: true,
        account: { select: { syncPageToken: true, syncBaselineHistoryId: true, syncError: true } } } }),
  ]);
  const allReceipts = messages.length ? await tx.mailboxSendReceipt.findMany({ where: { tenantId, operation: { in: ['send', 'schedule'] },
    OR: messages.filter(message => message.direction === 'outbound').map(message => ({ accountId: message.accountId,
      OR: [{ providerMessageId: message.providerMessageId }, ...(message.rfcMessageId ? [{ rfcMessageId: message.rfcMessageId }] : [])] })) },
    select: { accountId: true, providerMessageId: true, rfcMessageId: true, status: true, authorizationContext: true } }) : [];
  const engagementMessages = messages.filter(message => !allReceipts.some(receipt => receipt.accountId === message.accountId && isMailboxForward(receipt.authorizationContext) &&
    (receipt.providerMessageId === message.providerMessageId || !!receipt.rfcMessageId && receipt.rfcMessageId === message.rfcMessageId)));
  const receipts = allReceipts.filter(receipt => receipt.status === 'sent' && !isMailboxForward(receipt.authorizationContext));
  const events: DealEngagementEvent[] = qualifications.filter(row => row.previousStageId !== row.newStageId).map(row => ({ type: 'qualified', at: row.movedAt }));
  for (const message of engagementMessages) {
    if (message.direction === 'inbound' && message.meaningful) events.push({ type: 'reply', at: message.sentAt });
    if (message.direction === 'outbound' && receipts.some(receipt => receipt.accountId === message.accountId && receipt.providerMessageId === message.providerMessageId)) events.push({ type: 'outreach', at: message.sentAt });
  }
  const hasQuotation = receipts.some(receipt => {
    const saved = receipt.authorizationContext as { quotation?: { draft?: unknown; fingerprint?: unknown } } | null;
    const draft = QuotationDraftSchema.safeParse(saved?.quotation?.draft);
    return draft.success && draft.data.dealId === dealId && typeof saved?.quotation?.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(saved.quotation.fingerprint);
  });
  const quotationAt = hasQuotation ? messages.filter(message => message.direction === 'outbound' && receipts.some(receipt => {
    const saved = receipt.authorizationContext as { quotation?: { draft?: unknown; fingerprint?: unknown } } | null;
    const draft = QuotationDraftSchema.safeParse(saved?.quotation?.draft);
    return receipt.accountId === message.accountId && receipt.providerMessageId === message.providerMessageId && draft.success && draft.data.dealId === dealId;
  })).reduce<Date | undefined>((latest, message) => !latest || message.sentAt > latest ? message.sentAt : latest, undefined) : undefined;
  return { qualifications, events, hasQuotation, quotationAt,
    incomplete: engagementMessages.some(message => message.account.syncPageToken || message.account.syncBaselineHistoryId || message.account.syncError) };
}

/** Evidence stays in the existing stage history and mailbox tables, not a second event store. */
export async function evaluateDealEngagement(tx: Prisma.TransactionClient, tenantId: string, dealId: string, actorId: string,
  now = new Date(), emit = true) {
  const deal = await tx.deal.findFirst({ where: { tenantId, id: dealId, deletedAt: null }, include: { stage: true } });
  if (!deal || deal.isArchived) return deal;
  if (!deal.stage.isWon && !deal.stage.isLost && isManualStatus(deal.manualStatusContext)) return deal;
  // A sweep's snapshot may precede a qualification/reply committed during that sweep.
  if (deal.engagementEvaluatedAt && deal.engagementEvaluatedAt > now || deal.stageChangedAt && deal.stageChangedAt > now) return deal;
  const evidence = await readDealEngagementEvidence(tx, tenantId, dealId, now);
  const checkpoint = statusContext(deal.manualStatusContext);
  const replyAt = checkpoint?.source === 'reply' && typeof checkpoint.replyAt === 'string' ? new Date(checkpoint.replyAt) : undefined;
  const { qualifications, hasQuotation, quotationAt, incomplete } = evidence;
  const events = replyAt ? evidence.events.filter(event => event.at >= replyAt) : evidence.events;
  let qualifiedTarget: { id: string } | undefined;
  if (emit && hasQuotation && (!replyAt || quotationAt && quotationAt > replyAt) && !qualifications.length && !deal.stage.isWon && !deal.stage.isLost && ['lead', 'contacted'].includes(deal.stage.name.trim().toLowerCase())) {
    const targets = await tx.stage.findMany({ where: { tenantId, pipelineId: deal.pipelineId, name: { equals: 'Qualified', mode: 'insensitive' }, isWon: false, isLost: false }, take: 2 });
    if (targets.length === 1) {
      const { validateDealStageMove } = await import('./deals.service.js');
      try {
        await salesContext.run(tx, () => validateDealStageMove(dealId, tenantId, { stageId: targets[0].id }));
        qualifiedTarget = targets[0];
        events.push({ type: 'qualified', at: now });
      } catch (error) { if (!(error instanceof ValidationError)) throw error; }
    }
  }
  let status = classifyDealEngagement(events, now, deal.stage.isWon ? 'won' : deal.stage.isLost ? 'lost' : undefined);
  // Incomplete first sync cannot prove absence of a newer reply. Verified snapshots can still age offline.
  if (!deal.engagementEvaluatedAt && incomplete && status === 'Cold') status = 'Inquiry';
  // Stage entry from a reply is handled once at ingestion, never by replay/sweeps.
  if (!qualifiedTarget && status === deal.engagementStatus && (deal.engagementEvaluatedAt || incomplete)) return deal;
  // Readable mailbox history must still persist when CRM editing is unavailable.
  // The existing administrator sweep will update the derived status later.
  try { await assertCrmRecordMutation(tx, 'deals', dealId); }
  catch (error) { if (error instanceof AppError && [403, 404].includes(error.statusCode)) return deal; throw error; }
  let updated: Deal;
  if (qualifiedTarget) {
    // The stage writer persists Hot and publishes the full Deal update with the stage history ID.
    if (!incomplete) await tx.deal.update({ where: { tenantId, id: dealId }, data: { engagementEvaluatedAt: now } });
    const { moveDealStage } = await import('./deals.service.js');
    const transition = await salesContext.run(tx, () => moveDealStage(dealId, tenantId, actorId,
      { stageId: qualifiedTarget.id, note: 'Provider-accepted quotation for this Deal.' }, undefined, { automatic: true }));
    updated = transition.deal;
  } else {
    updated = await tx.deal.update({ where: { tenantId, id: dealId }, data: { engagementStatus: status,
      ...(!incomplete ? { engagementEvaluatedAt: now } : {}) } });
  }
  const eventId = await recordDealEngagementChange(tx, tenantId, dealId, actorId, deal.engagementStatus, status, now);
  if (eventId && emit && !qualifiedTarget) {
    await fireDealUpdated({ tenantId, actorId, eventId, record: updated,
      changedFields: ['engagementStatus'], changes: { before: { engagementStatus: deal.engagementStatus }, after: { engagementStatus: status } } });
  }
  return updated;
}

/** Only fresh, explicitly attributed inbound messages enter this transition path. */
export async function acceptDealReply(tx: Prisma.TransactionClient, tenantId: string, link: CustomerLink, dealId: string, actorId: string, at: Date, key: string) {
  const deal = await tx.deal.findFirst({ where: { ...customerDealWhere(tenantId, link), id: dealId, pipeline: { isArchived: false } }, include: { stage: true } });
  if (!deal || deal.stage.isWon || deal.stage.isLost || !acceptsStatusReply(deal.manualStatusContext, at, undefined, deal.updatedAt)) return;
  try { await assertCrmRecordMutation(tx, 'deals', dealId); }
  catch (error) { if (error instanceof AppError && [403, 404].includes(error.statusCode)) return; throw error; }
  const stages = await tx.stage.findMany({ where: { tenantId, pipelineId: deal.pipelineId, name: { equals: 'Contacted', mode: 'insensitive' }, isWon: false, isLost: false }, take: 2 });
  if (stages.length !== 1) return;
  const { validateDealStageMove, moveDealStage } = await import('./deals.service.js');
  try { await salesContext.run(tx, () => validateDealStageMove(dealId, tenantId, { stageId: stages[0].id })); }
  catch (error) { if (error instanceof ValidationError) return; throw error; }
  await tx.deal.update({ where: { tenantId, id: dealId }, data: { manualStatusContext: replyStatusCheckpoint(at, key) } });
  await salesContext.run(tx, () => moveDealStage(dealId, tenantId, actorId, { stageId: stages[0].id, note: 'Verified inbound reply on this Deal’s email thread.' }, undefined, { automatic: true }));
  await evaluateDealEngagement(tx, tenantId, dealId, actorId);
}

import type { CampaignStatus, Prisma } from '@prisma/client';

type RecipientEvidence = {
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failureReason: string | null;
};

// Soft bounces are retryable. Opens, clicks, spam complaints and unsubscribes
// describe engagement/preferences, not a terminal delivery failure.
const terminalFailures = new Set(['failed', 'error', 'hard_bounce', 'blocked', 'invalid_email']);
export function recipientDeliveryFailed(recipient: RecipientEvidence) {
  return terminalFailures.has(recipient.status) || terminalFailures.has(recipient.failureReason?.toLowerCase() ?? '');
}

export function deriveCampaignDeliveryStatus(
  campaign: { status: CampaignStatus; recipientCount: number },
  recipients: RecipientEvidence[],
): CampaignStatus {
  // Preparation changes DRAFT to SENDING and freezes recipientCount atomically.
  if (campaign.status === 'DRAFT') return 'DRAFT';
  const eligible = recipients.filter(row => row.status !== 'excluded');
  // Never reconstruct a historical audience or guess from incomplete history.
  if (!campaign.recipientCount || eligible.length !== campaign.recipientCount) return campaign.status;
  const failed = eligible.filter(recipientDeliveryFailed).length;
  const successful = eligible.filter(row => !recipientDeliveryFailed(row) && (row.sentAt || row.deliveredAt)).length;
  const delivered = eligible.filter(row => !recipientDeliveryFailed(row) && row.deliveredAt).length;
  if (delivered === campaign.recipientCount && failed === 0) return 'DELIVERED';
  if (successful > 0 && failed > 0) return 'PARTIALLY_SENT';
  if (failed === campaign.recipientCount) return 'FAILED';
  if (successful === campaign.recipientCount && failed === 0) return 'SENT';
  // Submitted/pending recipients cannot be presented as sent. Legacy records
  // without conclusive evidence retain their original state.
  return campaign.status;
}

/** Call inside the provider/send transaction, after locking the campaign and
 * before releasing it. All recipient writers use this same lock order. */
export async function recalculateCampaignDelivery(tx: Prisma.TransactionClient, id: string, tenantId: string) {
  const campaign = await tx.campaign.update({ where: { id, tenantId }, data: { engagement: { increment: 0 } } });
  const where = { campaignId: id, tenantId };
  const rows = await tx.campaignContact.findMany({ where, select: {
    messageId: true, status: true, failureReason: true, submittedAt: true, sentAt: true,
    deliveredAt: true, openedAt: true, clickedAt: true, bouncedAt: true,
  } });
  // Older email sentAt values recorded API acceptance. Only a persisted Brevo
  // request event upgrades that historical value to provider-confirmed sending.
  const legacyEmailRows = campaign.type === 'EMAIL' ? rows.filter(row => !row.submittedAt && row.sentAt) : [];
  const confirmedLegacy = legacyEmailRows.length ? await tx.emailDeliveryLog.findMany({ where: {
    ...where, brevoMessageId: { in: legacyEmailRows.flatMap(row => row.messageId ? [row.messageId] : []) },
    EmailEvent: { some: { tenantId, eventType: 'request' } },
  }, select: { brevoMessageId: true } }) : [];
  const confirmedIds = new Set(confirmedLegacy.map(row => row.brevoMessageId));
  const evidence = rows.map(row => campaign.type === 'EMAIL' && !row.submittedAt && !confirmedIds.has(row.messageId)
    ? { ...row, sentAt: null } : row);
  const eligible = rows.filter(row => row.status !== 'excluded');
  // Legacy email sends stored acceptance in sentAt; retain that submitted total.
  const submitted = eligible.filter(row => row.submittedAt || (campaign.type === 'EMAIL' && row.sentAt)).length;
  const failed = eligible.filter(recipientDeliveryFailed).length;
  const delivered = eligible.filter(row => row.deliveredAt && !recipientDeliveryFailed(row)).length;
  const opened = eligible.filter(row => row.openedAt).length;
  const clicked = eligible.filter(row => row.clickedAt).length;
  const bounced = eligible.filter(row => row.bouncedAt).length;
  const updated = await tx.campaign.update({ where: { id, tenantId }, data: {
    status: deriveCampaignDeliveryStatus(campaign, evidence), sentCount: submitted, failedCount: failed,
    openedCount: opened, clickedCount: clicked,
  } });
  await tx.campaignMetrics.create({ data: { ...where, sentCount: submitted, deliveredCount: delivered,
    openedCount: opened, clickedCount: clicked, bouncedCount: bounced,
    openRate: delivered ? opened / delivered * 100 : 0,
    clickRate: delivered ? clicked / delivered * 100 : 0,
    deliveryRate: submitted ? delivered / submitted * 100 : 0,
    bounceRate: submitted ? bounced / submitted * 100 : 0,
  } });
  return updated;
}

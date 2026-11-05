import type { CampaignStatus, Prisma } from '@prisma/client';
import { enqueueSmsCampaignOutcomes, smsSent, smsDelivered } from './sms-campaign-outcomes';
import { campaignEngagementRate } from '@leadcrm/shared';

type RecipientEvidence = {
  status: string;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failureReason: string | null;
  submittedAt?: Date | null;
  submissionAttemptedAt?: Date | null;
};

// Soft bounces are retryable. Opens, clicks, spam complaints and unsubscribes
// describe engagement/preferences, not a terminal delivery failure.
const terminalFailures = new Set(['failed', 'error', 'hard_bounce', 'blocked', 'invalid_email']);
export function recipientDeliveryFailed(recipient: RecipientEvidence) {
  return terminalFailures.has(recipient.status) || terminalFailures.has(recipient.failureReason?.toLowerCase() ?? '');
}

export function deriveCampaignDeliveryStatus(
  campaign: { status: CampaignStatus; recipientCount: number; type?: string; submissionStartedAt?: Date | null; submissionFinishedAt?: Date | null },
  recipients: RecipientEvidence[],
): CampaignStatus {
  // Preparation changes DRAFT to SENDING and freezes recipientCount atomically.
  if (['DRAFT', 'SCHEDULED'].includes(campaign.status)) return campaign.status;
  const eligible = recipients.filter(row => row.status !== 'excluded');
  // Never reconstruct a historical audience or guess from incomplete history.
  if (!campaign.recipientCount || eligible.length !== campaign.recipientCount) return campaign.status;
  if (campaign.status === 'SENDING' && campaign.submissionStartedAt && !campaign.submissionFinishedAt) return 'SENDING';
  const failed = eligible.filter(recipientDeliveryFailed).length;
  const successful = eligible.filter(row => !recipientDeliveryFailed(row) && (campaign.type === 'SMS' ? smsSent(row) : row.sentAt || row.deliveredAt)).length;
  const delivered = eligible.filter(row => !recipientDeliveryFailed(row) && (campaign.type === 'SMS' ? smsDelivered(row) : row.deliveredAt)).length;
  if (delivered === campaign.recipientCount && failed === 0) return 'DELIVERED';
  const uncertain = eligible.some(row => !recipientDeliveryFailed(row) && !(campaign.type === 'SMS' ? smsSent(row) : row.sentAt || row.deliveredAt)
    && (row.status === 'unknown' || ['TEXTBEE_UNKNOWN_STATE', 'PROVIDER_SUBMISSION_UNCONFIRMED'].includes(row.failureReason ?? '')));
  if (successful > 0 && failed > 0 && !uncertain && successful + failed === campaign.recipientCount) return 'PARTIALLY_SENT';
  if (failed === campaign.recipientCount) return 'FAILED';
  if (successful === campaign.recipientCount && failed === 0 && !uncertain) return 'SENT';
  if (campaign.submissionFinishedAt) {
    if (uncertain) return 'INTERRUPTED';
    const accepted = eligible.filter(row => !recipientDeliveryFailed(row) && (row.submittedAt || row.status === 'submitted' || row.sentAt || row.deliveredAt)).length;
    if (accepted > 0 && accepted + failed === campaign.recipientCount) return 'SUBMITTED';
  }
  if (campaign.type === 'SMS' && campaign.status === 'PARTIALLY_SENT') return 'SENDING';
  // Submitted/pending recipients cannot be presented as sent. Legacy records
  // without conclusive evidence retain their original state.
  return campaign.status;
}

/** Call inside the provider/send transaction, after locking the campaign and
 * before releasing it. All recipient writers use this same lock order. */
export async function recalculateCampaignDelivery(tx: Prisma.TransactionClient, id: string, tenantId: string, skipUnchanged = false) {
  const campaign = await tx.campaign.update({ where: { id, tenantId }, data: { engagement: { increment: 0 } } });
  const where = { campaignId: id, tenantId };
  const rows = await tx.campaignContact.findMany({ where, select: {
    messageId: true, status: true, failureReason: true, submittedAt: true, sentAt: true,
    deliveredAt: true, openedAt: true, clickedAt: true, bouncedAt: true, submissionAttemptedAt: true,
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
  const delivered = eligible.filter(row => (campaign.type === 'SMS' ? smsDelivered(row) : row.deliveredAt) && !recipientDeliveryFailed(row)).length;
  const opened = campaign.type === 'SMS' ? 0 : eligible.filter(row => row.openedAt).length;
  const clicked = campaign.type === 'SMS' && campaign.smsTrackingVersion !== 1 ? 0 : eligible.filter(row => row.clickedAt).length;
  const bounced = eligible.filter(row => row.bouncedAt).length;
  const status = deriveCampaignDeliveryStatus(campaign, evidence);
  if (skipUnchanged && campaign.status === status && campaign.sentCount === submitted && campaign.failedCount === failed && campaign.openedCount === opened && campaign.clickedCount === clicked) return campaign;
  const updated = await tx.campaign.update({ where: { id, tenantId }, data: {
    status, sentCount: submitted, failedCount: failed,
    openedCount: opened, clickedCount: clicked,
    engagement: campaignEngagementRate({ type: campaign.type, smsTrackingVersion: campaign.smsTrackingVersion, sentCount: submitted, openedCount: opened, clickedCount: clicked }) ?? 0,
  } });
  await tx.campaignMetrics.create({ data: { ...where, sentCount: submitted, deliveredCount: delivered,
    openedCount: opened, clickedCount: clicked, bouncedCount: bounced,
    openRate: delivered ? opened / delivered * 100 : 0,
    clickRate: (campaign.type === 'SMS' ? submitted : delivered) ? clicked / (campaign.type === 'SMS' ? submitted : delivered) * 100 : 0,
    deliveryRate: submitted ? delivered / submitted * 100 : 0,
    bounceRate: submitted ? bounced / submitted * 100 : 0,
  } });
  await enqueueSmsCampaignOutcomes(tx, updated, rows);
  return updated;
}

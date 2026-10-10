import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { writeAuditLog } from '../../../core/audit/audit.service';
import { recalculateCampaignDelivery } from './campaign-delivery-status';

export const CAMPAIGN_LEASE_MS = 120_000;

/** Lock the campaign first, just like submission and provider receipt writers.
 * Unknown provider outcomes are retained for review and never replayed. */
export async function interruptCampaignSubmission(id: string, tenantId: string, leaseId?: string, now = new Date()) {
  return tenantContext.run({ tenantId }, async () => {
    const interrupted = await prisma.$transaction(async tx => {
      const claim = await tx.campaign.updateMany({ where: { id, tenantId, submissionStartedAt: { not: null }, submissionFinishedAt: null,
        ...(leaseId ? { submissionLeaseId: leaseId } : { OR: [{ submissionLeaseUntil: { lt: now } }, { submissionLeaseUntil: null, submissionStartedAt: { lt: new Date(+now - CAMPAIGN_LEASE_MS) } }] }) },
        data: { submissionLeaseId: null, submissionLeaseUntil: null, submissionFinishedAt: now, submissionInterruptedAt: now, status: 'INTERRUPTED' } });
      if (!claim.count) return null;
      const rows = await tx.campaignContact.findMany({ where: { campaignId: id, tenantId, status: { in: ['pending', 'submitting'] }, submittedAt: null, sentAt: null, deliveredAt: null, messageId: null },
        select: { id: true, email: true, submissionAttemptedAt: true, failureReason: true } });
      const unsent = rows.filter(row => !row.submissionAttemptedAt && row.failureReason !== 'PROVIDER_SUBMISSION_UNCONFIRMED');
      const unsentIds = new Set(unsent.map(row => row.id));
      const uncertain = rows.filter(row => !unsentIds.has(row.id));
      if (unsent.length) {
        await tx.campaignContact.updateMany({ where: { tenantId, campaignId: id, id: { in: unsent.map(row => row.id) } }, data: { status: 'failed', failureReason: 'SUBMISSION_INTERRUPTED_NOT_SENT' } });
        await tx.emailDeliveryLog.updateMany({ where: { tenantId, campaignId: id, toEmail: { in: unsent.flatMap(row => row.email ?? []) }, brevoMessageId: null }, data: { status: 'failed', errorMessage: 'SUBMISSION_INTERRUPTED_NOT_SENT' } });
      }
      if (uncertain.length) {
        await tx.campaignContact.updateMany({ where: { tenantId, campaignId: id, id: { in: uncertain.map(row => row.id) } }, data: { status: 'pending', failureReason: 'PROVIDER_SUBMISSION_UNCONFIRMED' } });
        await tx.emailDeliveryLog.updateMany({ where: { tenantId, campaignId: id, toEmail: { in: uncertain.flatMap(row => row.email ?? []) }, brevoMessageId: null }, data: { status: 'pending', errorMessage: 'PROVIDER_SUBMISSION_UNCONFIRMED' } });
      }
      const campaign = await recalculateCampaignDelivery(tx, id, tenantId);
      // Keep an incomplete provider picture explicit; later verified receipts
      // may establish Sent, Partially Sent, Delivered or Failed normally.
      if (campaign.status === 'SENDING') await tx.campaign.update({ where: { id, tenantId }, data: { status: 'INTERRUPTED' } });
      return { unsent: unsent.length, uncertain: uncertain.length, userId: campaign.createdById };
    });
    if (interrupted?.userId) await writeAuditLog({ tenantId, userId: interrupted.userId, action: 'campaign.delivery_interrupted', entityType: 'Campaign', entityId: id, severity: 'WARNING', metadata: { source: 'submission-recovery' }, after: { unsent: interrupted.unsent, uncertain: interrupted.uncertain } });
    else if (interrupted) console.warn('[Campaigns] Historical campaign has no creator for audit attribution; interruption is preserved on the campaign.', { campaignId: id });
    return interrupted;
  });
}

/** Cross-workspace discovery is bounded; each mutation then enters its tenant scope. */
export async function recoverCampaignSubmissions(now = new Date()) {
  const expired = await prisma.campaign.findMany({ where: { submissionStartedAt: { not: null }, submissionFinishedAt: null,
    OR: [{ submissionLeaseUntil: { lt: now } }, { submissionLeaseUntil: null, submissionStartedAt: { lt: new Date(+now - CAMPAIGN_LEASE_MS) } }] },
    select: { id: true, tenantId: true }, orderBy: [{ submissionStartedAt: 'asc' }, { id: 'asc' }], take: 25 });
  let recovered = 0;
  for (const row of expired) if (await interruptCampaignSubmission(row.id, row.tenantId, undefined, now)) recovered++;
  return recovered;
}

export function startCampaignRecoveryScheduler() {
  let running: Promise<unknown> | undefined;
  const run = () => {
    if (!running) running = recoverCampaignSubmissions().catch(() => console.error('[Campaigns] Submission recovery failed; it will retry.')).finally(() => { running = undefined; });
  };
  run();
  const interval = setInterval(run, 30_000);
  interval.unref();
  return async () => { clearInterval(interval); await running; };
}

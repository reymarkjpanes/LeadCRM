import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { z } from 'zod';
import { getSmsBatch, isSmsConfigured, SmsSubmissionError } from '../../../shared/services/sms.service';
import { applyTextBeeEvidence } from './textbee-webhook';
import { recalculateCampaignDelivery } from './campaign-delivery-status';
import { smsSent } from './sms-campaign-outcomes';

const DAY = 86400000;
const delays = [5, 15, 60];
export async function reconcileSmsStatuses(now = new Date()) {
  // Stop silently abandoning old batches. Retain confirmed sent facts and mark
  // other outcomes for review; late signed callbacks can still resolve them.
  const expired = await prisma.campaignContact.findMany({ where: { messageId: { not: null }, submittedAt: { lt: new Date(+now - 30 * DAY) },
    deliveredAt: null, status: { notIn: ['delivered', 'failed', 'excluded'] }, nextSmsCheckAt: { lte: now }, campaign: { type: 'SMS' } }, take: 10,
    orderBy: [{ nextSmsCheckAt: 'asc' }, { id: 'asc' }], select: { id: true, tenantId: true, campaignId: true } });
  for (const row of expired) await tenantContext.run({ tenantId: row.tenantId }, () => prisma.$transaction(async tx => {
    await tx.campaign.update({ where: { id: row.campaignId, tenantId: row.tenantId }, data: { engagement: { increment: 0 } } });
    const current = await tx.campaignContact.findFirst({ where: { id: row.id, tenantId: row.tenantId, deliveredAt: null,
      status: { notIn: ['delivered', 'failed', 'excluded'] }, nextSmsCheckAt: { lte: now } } });
    if (!current) return;
    await tx.campaignContact.update({ where: { id: row.id, tenantId: row.tenantId }, data: { nextSmsCheckAt: null,
      ...(!smsSent(current) ? { status: 'unknown', failureReason: 'SMS_VERIFICATION_EXPIRED' } : {}) } });
    await recalculateCampaignDelivery(tx, row.campaignId, row.tenantId);
  }));
  if (!isSmsConfigured()) return 0;
  // Discovery contains no customer content; all claims/writes then enter tenant scope.
  const due = await prisma.campaignContact.findMany({ where: {
    messageId: { not: null }, submittedAt: { gte: new Date(+now - 30 * DAY) },
    deliveredAt: null, status: { notIn: ['delivered', 'failed', 'excluded'] }, nextSmsCheckAt: { lte: now },
    campaign: { type: 'SMS' },
  }, orderBy: [{ nextSmsCheckAt: 'asc' }, { id: 'asc' }], take: 10,
  select: { id: true, tenantId: true, campaignId: true, messageId: true, smsId: true, phone: true, providerUpdatedAt: true, nextSmsCheckAt: true, smsCheckAttempts: true,
    campaign: { select: { smsDeviceId: true } } } });
  let checked = 0;
  for (const row of due) await tenantContext.run({ tenantId: row.tenantId }, async () => {
    let category: 'transport' | 'response_validation' | 'identity_mismatch' | 'persistence' = 'persistence';
    try {
      // Reserve the next check before HTTP. Concurrent workers and restarts do not
      // hammer the provider; a failed lookup can never trigger a send.
      const claimed = await prisma.$transaction(async tx => {
        await tx.campaign.update({ where: { id: row.campaignId, tenantId: row.tenantId }, data: { engagement: { increment: 0 } } });
        return tx.campaignContact.updateMany({ where: { id: row.id, tenantId: row.tenantId, nextSmsCheckAt: row.nextSmsCheckAt,
          deliveredAt: null, status: { notIn: ['delivered', 'failed', 'excluded'] } }, data: {
          nextSmsCheckAt: new Date(+now + delays[Math.min(row.smsCheckAttempts, delays.length - 1)] * 60000), smsCheckAttempts: { increment: 1 },
        } });
      });
      if (!claimed.count) return;
      category = 'identity_mismatch';
      const deviceId = row.campaign.smsDeviceId ?? process.env.TEXTBEE_DEVICE_ID?.trim();
      if (!deviceId || !row.messageId || !row.phone) throw new Error('SMS_IDENTITY_MISSING');
      category = 'transport';
      const result = await getSmsBatch(deviceId, row.messageId);
      const message = result.messages[0];
      category = 'identity_mismatch';
      if (result.batch._id !== row.messageId || result.batch.recipientCount !== 1 || result.messages.length !== 1
        || !message || message.recipient !== row.phone || message.device._id !== deviceId
        || (message.smsBatch && message.smsBatch !== row.messageId) || (row.smsId && message._id !== row.smsId)) throw new Error('SMS_IDENTITY_MISMATCH');
      category = 'response_validation';
      if (!['pending', 'dispatched', 'sent', 'delivered', 'failed', 'unknown', 'delivery_failed'].includes(message.status)) throw new Error('SMS_STATUS_INVALID');
      const sentAt = message.sentAt ? new Date(message.sentAt) : undefined;
      const deliveredAt = message.deliveredAt ? new Date(message.deliveredAt) : undefined;
      const failedAt = message.failedAt ? new Date(message.failedAt) : undefined;
      // TextBee's authoritative status is evidence even when optional event
      // timestamps are absent. Preserve absent dates instead of inventing them.
      category = 'persistence';
      if (['sent', 'delivered', 'failed', 'unknown', 'delivery_failed'].includes(message.status)) {
        await applyTextBeeEvidence({ smsId: message._id, smsBatchId: row.messageId, deviceId, recipient: row.phone,
          status: message.status === 'delivery_failed' ? 'unknown' : message.status, sentAt, deliveredAt, failedAt,
          providerUpdatedAt: message.updatedAt ? new Date(message.updatedAt) : undefined,
          errorCode: message.errorCode, errorMessage: message.errorMessage }, undefined, row.providerUpdatedAt);
      } else {
        // Pending/dispatched is acceptance only. Recalculate from stored facts
        // so completed legacy Sending parents become Submitted without a resend.
        await prisma.$transaction(tx => recalculateCampaignDelivery(tx, row.campaignId, row.tenantId, true));
      }
      checked++;
      console.info('[Campaigns]', { event: 'sms_status_lookup', campaignId: row.campaignId, recipientId: row.id, status: message.status,
        requestedAt: message.requestedAt, dispatchedAt: message.dispatchedAt, pushReceivedAt: message.pushReceivedAt,
        sendAttemptedAt: message.sendAttemptedAt, sentAt: message.sentAt, deliveredAt: message.deliveredAt });
    } catch (error) {
      console.warn('[Campaigns]', { event: 'sms_status_lookup_failed', campaignId: row.campaignId, recipientId: row.id,
        category: category === 'transport' && (error instanceof z.ZodError || error instanceof SyntaxError) ? 'response_validation' : category,
        httpStatus: error instanceof SmsSubmissionError ? error.httpStatus : undefined });
    }
  });
  return checked;
}

export function startSmsStatusReconciliation() {
  let running: Promise<unknown> | undefined;
  const run = () => {
    if (!running) running = reconcileSmsStatuses().catch(() => console.warn('[Campaigns]', { event: 'sms_reconciliation_failed', category: 'persistence' })).finally(() => { running = undefined; });
  };
  // Starting after one minute also limits calls across frequent deployments.
  const timer = setInterval(run, 60000); timer.unref();
  return async () => { clearInterval(timer); await running; };
}

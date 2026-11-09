import { processSmsReply } from '../../../integrations/sms/sms-replies';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import { recalculateCampaignDelivery } from './campaign-delivery-status';
import { requestNotificationDispatch } from '../../notifications/notification-events.service';
import { smsSent } from './sms-campaign-outcomes';
import { smsProviderDiagnostic } from '../../../shared/services/sms.service';

const identity = z.string().min(1).max(500);
const timestamp = z.string().datetime({ offset: true }).transform(value => new Date(value));
const envelope = z.object({ smsId: identity, smsBatchId: identity, deviceId: identity,
  webhookSubscriptionId: identity, idempotencyKey: identity, recipient: z.string().regex(/^\+[1-9]\d{7,14}$/), errorCode: z.unknown().optional(), errorMessage: z.unknown().optional() });
export const TextBeeEventSchema = z.discriminatedUnion('webhookEvent', [
  envelope.extend({ webhookEvent: z.literal('MESSAGE_SENT'), status: z.literal('sent'), sentAt: timestamp }),
  envelope.extend({ webhookEvent: z.literal('MESSAGE_DELIVERED'), status: z.literal('delivered'), sentAt: timestamp.optional(), deliveredAt: timestamp }),
  envelope.extend({ webhookEvent: z.literal('MESSAGE_FAILED'), status: z.literal('failed'), failedAt: timestamp }),
  envelope.extend({ webhookEvent: z.literal('UNKNOWN_STATE'), status: z.string().min(1).max(100) }),
]);

export function verifyTextBeeSignature(raw: Buffer, signature?: string, timestampedSignature?: string) {
  const secret = process.env.TEXTBEE_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 20) throw new AppError('SMS webhook is not configured.', 503);
  const hmac = createHmac('sha256', secret);
  if (timestampedSignature !== undefined) {
    const match = /^t=(\d{1,12}),\s*v1=([a-f\d]{64})$/.exec(timestampedSignature);
    if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) throw new AppError('Unauthorized webhook.', 401);
    hmac.update(match[1] + '.');
    signature = match[2];
  }
  const expected = hmac.update(raw).digest();
  if (!signature || !/^[a-f\d]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    throw new AppError('Unauthorized webhook.', 401);
  }
}

export async function processTextBeeEvent(input: unknown) {
  const parsed = TextBeeEventSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Invalid outbound SMS event.', 400);
  const event = parsed.data;
  return applyTextBeeEvidence({ ...event, status: event.webhookEvent === 'UNKNOWN_STATE' ? 'unknown' : event.status,
    sentAt: 'sentAt' in event ? event.sentAt : undefined, deliveredAt: 'deliveredAt' in event ? event.deliveredAt : undefined,
    failedAt: 'failedAt' in event ? event.failedAt : undefined }, event.idempotencyKey);
}

export type TextBeeEvidence = { smsId: string; smsBatchId: string; deviceId: string; recipient: string; status: string;
  sentAt?: Date; deliveredAt?: Date; failedAt?: Date; providerUpdatedAt?: Date; errorCode?: unknown; errorMessage?: unknown };
function evidenceTime(event: TextBeeEvidence) {
  return (event.status === 'failed' ? event.failedAt : event.status === 'delivered' ? event.deliveredAt : event.sentAt) ?? event.providerUpdatedAt ?? null;
}
/** Shared verified-fact writer. Provider GET results are not webhook receipts. */
export async function applyTextBeeEvidence(event: TextBeeEvidence, receiptKey?: string, expectedUpdatedAt?: Date | null) {
  const started = performance.now();
  const recipient = await prisma.campaignContact.findUnique({ where: { messageId: event.smsBatchId }, include: { campaign: { select: { type: true, smsDeviceId: true } } } });
  if (!recipient) {
    // Workflows persist their submission in the existing execution step. They do
    // not own CampaignContacts, so acknowledge their outbound events without
    // creating campaign records or changing workflow engagement.
    const workflow = await prisma.workflowExecutionStep.findFirst({ where: { actionType: 'send_sms', output: { path: ['messageId'], equals: event.smsBatchId } }, select: { id: true } });
    if (workflow && receiptKey) return;
    // Retry if the callback arrived before the send receipt was persisted.
    throw new AppError('SMS delivery record is not available.', 503);
  }
  if (recipient.campaign.type !== 'SMS' || recipient.phone !== event.recipient) throw new AppError('SMS delivery record does not match.', 400);
  const deviceId = recipient.campaign.smsDeviceId ?? process.env.TEXTBEE_DEVICE_ID?.trim();
  if (deviceId && event.deviceId !== deviceId) throw new AppError('SMS device does not match.', 400);
  if (recipient.smsId && recipient.smsId !== event.smsId) throw new AppError('SMS message identity does not match.', 400);
  await tenantContext.run({ tenantId: recipient.tenantId }, () => prisma.$transaction(async tx => {
    const where = { tenantId: recipient.tenantId, campaignId: recipient.campaignId };
    const locked = await tx.campaign.update({ where: { id: recipient.campaignId, tenantId: recipient.tenantId }, data: { engagement: { increment: 0 } } });
    if (locked.smsDeviceId && locked.smsDeviceId !== event.deviceId) throw new AppError('SMS device does not match.', 400);
    if (!locked.smsDeviceId) await tx.campaign.update({ where: { id: recipient.campaignId, tenantId: recipient.tenantId }, data: { smsDeviceId: event.deviceId } });
    if (receiptKey) {
      const receipt = await tx.smsWebhookReceipt.createMany({ data: [{ idempotencyKey: receiptKey, tenantId: recipient.tenantId, campaignContactId: recipient.id,
        status: event.status, eventAt: evidenceTime(event) }], skipDuplicates: true });
      if (!receipt.count) return;
    }
    const current = await tx.campaignContact.findUniqueOrThrow({ where: { id: recipient.id, ...where } });
    if (expectedUpdatedAt !== undefined && current.providerUpdatedAt?.getTime() !== expectedUpdatedAt?.getTime()) return;
    if (current.smsId && current.smsId !== event.smsId) throw new AppError('SMS message identity does not match.', 400);
    const status = event.status;
    const diagnostic = smsProviderDiagnostic(event.errorCode, event.errorMessage);
    const at = evidenceTime(event);
    if (current.status === 'excluded') return;
    if (['delivered', 'failed'].includes(current.status) && status !== current.status) {
      if (!['delivered', 'failed'].includes(status)) return;
      // Conflicting terminal facts require review. Receipt arrival order is not event order.
      await tx.campaignContact.update({ where: { id: current.id, ...where }, data: { smsStatusConflict: true } });
      if (!at || !current.providerUpdatedAt || at <= current.providerUpdatedAt) return;
    }
    const newDates = !!(event.sentAt && !current.sentAt || event.deliveredAt && !current.deliveredAt);
    if (at && current.providerUpdatedAt && at < current.providerUpdatedAt && !(status === current.status && newDates)) return;
    const newDiagnostic = !!(diagnostic.code && diagnostic.code !== current.providerErrorCode || diagnostic.message && diagnostic.message !== current.providerErrorMessage);
    if (status === current.status && current.failureReason !== 'TEXTBEE_UNKNOWN_STATE' && !newDates && !newDiagnostic) {
      await recalculateCampaignDelivery(tx, recipient.campaignId, recipient.tenantId, true);
      return;
    }
    // UNKNOWN_STATE has no event timestamp. Preserve the confirmed sent fact,
    // while flagging it for review until a final delivery/failure arrives.
    if (status === 'unknown' && current.failureReason === 'TEXTBEE_UNKNOWN_STATE' && !newDiagnostic) return;
    await tx.campaignContact.update({ where: { id: recipient.id, ...where }, data: {
      status: status === 'unknown' && smsSent(current) ? 'sent' : status,
      smsId: event.smsId,
      ...(['delivered', 'failed'].includes(status) ? { nextSmsCheckAt: null } : {}),
      ...(at && status !== 'unknown' ? { providerUpdatedAt: current.providerUpdatedAt && current.providerUpdatedAt > at ? current.providerUpdatedAt : at } : {}),
      ...(event.sentAt ? { sentAt: current.sentAt ?? event.sentAt } : {}),
      ...(event.deliveredAt ? { deliveredAt: current.deliveredAt ?? event.deliveredAt } : {}),
      failureReason: status === 'failed' ? 'TEXTBEE_FAILED' : status === 'unknown' ? 'TEXTBEE_UNKNOWN_STATE' : null,
      ...(['failed', 'unknown'].includes(status) ? {
        providerErrorCode: diagnostic.code ?? current.providerErrorCode,
        providerErrorMessage: diagnostic.message ?? current.providerErrorMessage,
      } : { providerErrorCode: null, providerErrorMessage: null }),
    } });
    await recalculateCampaignDelivery(tx, recipient.campaignId, recipient.tenantId);
  }));
  requestNotificationDispatch(recipient.tenantId);
  console.info('[Campaigns]', { event: 'sms_evidence_processed', source: receiptKey ? 'webhook' : 'provider_lookup', campaignId: recipient.campaignId,
    tenantId: recipient.tenantId, recipientId: recipient.id, status: event.status, durationMs: Math.round(performance.now() - started) });
}

export const textbeeWebhookRouter = Router();
textbeeWebhookRouter.post('/', rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => { res.status(503).json({ success: false, error: 'SMS webhook temporarily busy. Retry later.' }); } }), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.secure) throw new AppError('HTTPS is required.', 400);
    if (!Buffer.isBuffer(req.body)) throw new AppError('Raw SMS webhook body is required.', 400);
    verifyTextBeeSignature(req.body, req.get('X-Signature'), req.get('X-TextBee-Signature'));
    let input: unknown;
    try { input = JSON.parse(req.body.toString('utf8')); } catch { throw new AppError('Invalid outbound SMS event.', 400); }
    if (input && typeof input === 'object' && 'webhookEvent' in input && input.webhookEvent === 'MESSAGE_RECEIVED') {
      await processSmsReply(input); res.json({ success: true }); return;
    }
    // Reserved outbound events have no classification effect.
    if (input && typeof input === 'object' && 'webhookEvent' in input && ['SMS_STATUS_UPDATED'].includes(String(input.webhookEvent))) {
      res.json({ success: true }); return;
    }
    await processTextBeeEvent(input);
    res.json({ success: true });
  } catch (error) { next(error); }
});

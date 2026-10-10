import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import { recalculateCampaignDelivery } from './campaign-delivery-status';

const identity = z.string().min(1).max(500);
const timestamp = z.string().datetime({ offset: true }).transform(value => new Date(value));
const envelope = z.object({ smsId: identity, smsBatchId: identity, deviceId: identity,
  webhookSubscriptionId: identity, idempotencyKey: identity, recipient: z.string().regex(/^\+[1-9]\d{7,14}$/) });
export const TextBeeEventSchema = z.discriminatedUnion('webhookEvent', [
  envelope.extend({ webhookEvent: z.literal('MESSAGE_SENT'), status: z.literal('sent'), sentAt: timestamp }),
  envelope.extend({ webhookEvent: z.literal('MESSAGE_DELIVERED'), status: z.literal('delivered'), sentAt: timestamp, deliveredAt: timestamp }),
  envelope.extend({ webhookEvent: z.literal('MESSAGE_FAILED'), status: z.literal('failed'), failedAt: timestamp }),
  envelope.extend({ webhookEvent: z.literal('UNKNOWN_STATE'), status: z.string().min(1).max(100) }),
]);

export function verifyTextBeeSignature(raw: Buffer, signature?: string) {
  const secret = process.env.TEXTBEE_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 20) throw new AppError('SMS webhook is not configured.', 503);
  const expected = createHmac('sha256', secret).update(raw).digest();
  if (!signature || !/^[a-f\d]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    throw new AppError('Unauthorized webhook.', 401);
  }
}

export async function processTextBeeEvent(input: unknown) {
  const parsed = TextBeeEventSchema.safeParse(input);
  if (!parsed.success) throw new AppError('Invalid outbound SMS event.', 400);
  const event = parsed.data;
  const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
  if (deviceId && event.deviceId !== deviceId) throw new AppError('SMS device does not match.', 400);
  const recipient = await prisma.campaignContact.findUnique({ where: { messageId: event.smsBatchId }, include: { campaign: { select: { type: true } } } });
  if (!recipient) {
    // Workflows persist their submission in the existing execution step. They do
    // not own CampaignContacts, so acknowledge their outbound events without
    // creating campaign records or changing workflow engagement.
    const workflow = await prisma.workflowExecutionStep.findFirst({ where: { actionType: 'send_sms', output: { path: ['messageId'], equals: event.smsBatchId } }, select: { id: true } });
    if (workflow) return;
    // Retry if the callback arrived before the send receipt was persisted.
    throw new AppError('SMS delivery record is not available.', 503);
  }
  if (recipient.campaign.type !== 'SMS' || recipient.phone !== event.recipient) throw new AppError('SMS delivery record does not match.', 400);
  return tenantContext.run({ tenantId: recipient.tenantId }, () => prisma.$transaction(async tx => {
    const where = { tenantId: recipient.tenantId, campaignId: recipient.campaignId };
    await tx.campaign.update({ where: { id: recipient.campaignId, tenantId: recipient.tenantId }, data: { engagement: { increment: 0 } } });
    const receipt = await tx.smsWebhookReceipt.createMany({ data: [{ idempotencyKey: event.idempotencyKey, tenantId: recipient.tenantId, campaignContactId: recipient.id }], skipDuplicates: true });
    if (!receipt.count) return;
    const current = await tx.campaignContact.findUniqueOrThrow({ where: { id: recipient.id, ...where } });
    // Final delivery/failure cannot regress, even on a new delivery identity.
    if (['delivered', 'failed', 'excluded'].includes(current.status)) return;
    const status = event.webhookEvent === 'UNKNOWN_STATE' ? 'unknown' : event.status;
    const at = 'deliveredAt' in event ? event.deliveredAt : 'failedAt' in event ? event.failedAt : 'sentAt' in event ? event.sentAt : null;
    if (at && current.providerUpdatedAt && at < current.providerUpdatedAt) return;
    if (status === current.status && current.failureReason !== 'TEXTBEE_UNKNOWN_STATE') return;
    // UNKNOWN_STATE has no event timestamp. Preserve the confirmed sent fact,
    // while flagging it for review until a final delivery/failure arrives.
    if (status === 'unknown' && current.failureReason === 'TEXTBEE_UNKNOWN_STATE') return;
    await tx.campaignContact.update({ where: { id: recipient.id, ...where }, data: {
      status: status === 'unknown' && current.sentAt ? 'sent' : status,
      ...(at ? { providerUpdatedAt: at } : {}),
      ...('sentAt' in event ? { sentAt: current.sentAt ?? event.sentAt } : {}),
      ...('deliveredAt' in event ? { deliveredAt: event.deliveredAt } : {}),
      failureReason: status === 'failed' ? 'TEXTBEE_FAILED' : status === 'unknown' ? 'TEXTBEE_UNKNOWN_STATE' : null,
    } });
    await recalculateCampaignDelivery(tx, recipient.campaignId, recipient.tenantId);
  }));
}

export const textbeeWebhookRouter = Router();
textbeeWebhookRouter.post('/', rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: true, legacyHeaders: false }), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.secure) throw new AppError('HTTPS is required.', 400);
    if (!Buffer.isBuffer(req.body)) throw new AppError('Raw SMS webhook body is required.', 400);
    verifyTextBeeSignature(req.body, req.get('X-Signature'));
    let input: unknown;
    try { input = JSON.parse(req.body.toString('utf8')); } catch { throw new AppError('Invalid outbound SMS event.', 400); }
    // Never process inbound content or reserved events, even if subscribed externally.
    if (input && typeof input === 'object' && 'webhookEvent' in input && ['MESSAGE_RECEIVED', 'SMS_STATUS_UPDATED'].includes(String(input.webhookEvent))) {
      res.json({ success: true }); return;
    }
    await processTextBeeEvent(input);
    res.json({ success: true });
  } catch (error) { next(error); }
});

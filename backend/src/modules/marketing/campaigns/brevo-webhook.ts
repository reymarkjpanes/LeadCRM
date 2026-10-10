import { timingSafeEqual, createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';
import { recalculateCampaignDelivery } from './campaign-delivery-status';
import { campaignLinkDestination } from '@leadcrm/shared';

export const BrevoEventSchema = z.object({
  event: z.enum(['request', 'delivered', 'opened', 'unique_opened', 'click', 'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'unsubscribed', 'invalid_email', 'error', 'deferred']),
  email: z.string().trim().email().max(254), 'message-id': z.string().min(1).max(500),
  ts_event: z.number().int().nonnegative().optional(),
  ts_epoch: z.number().int().nonnegative().optional(),
  ts: z.number().int().nonnegative().optional(),
  link: z.string().max(8192).optional(),
  tags: z.array(z.string()).optional(),
  // Older Brevo payloads serialize the tags array as a JSON string.
  tag: z.string().optional(),
}).superRefine((event, ctx) => {
  if (['click', 'opened', 'unique_opened'].includes(event.event) && event.ts_epoch == null && event.ts_event == null && event.ts == null) {
    ctx.addIssue({ code: 'custom', path: ['ts_event'], message: 'Engagement events require a provider timestamp.' });
  }
  if (event.event === 'click' && event.link && !campaignLinkDestination(event.link)) {
    ctx.addIssue({ code: 'custom', path: ['link'], message: 'Click destination must be an HTTP or HTTPS URL.' });
  }
});

export function brevoEventTime(event: z.infer<typeof BrevoEventSchema>) {
  const epoch = event.ts_epoch == null ? undefined : event.ts_epoch < 1e12 ? event.ts_epoch * 1000 : event.ts_epoch;
  const seconds = event.ts_event ?? event.ts;
  // Some payloads reuse the send epoch. Prefer event time in that case, while
  // retaining millisecond precision for genuinely separate same-second clicks.
  const time = seconds == null ? epoch : epoch != null && Math.floor(epoch / 1000) === seconds ? epoch : seconds * 1000;
  if (time != null && (!Number.isFinite(time) || time > Date.now() + 300_000 || time > 8.64e15)) throw new AppError('Invalid provider event timestamp.', 400);
  return new Date(time ?? Date.now());
}
export function verifyWebhookAuthorization(header?: string) {
  const token = process.env.BREVO_WEBHOOK_TOKEN;
  if (!token || token.length < 32) throw new AppError('Webhook is not configured.', 503);
  const actual = createHash('sha256').update(header || '').digest();
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  if (!timingSafeEqual(actual, expected)) throw new AppError('Unauthorized webhook.', 401);
}
export async function processBrevoEvent(input: unknown) {
  const event = BrevoEventSchema.parse(input);
  let tags: unknown = event.tags;
  if (!tags && event.tag) {
    try { tags = JSON.parse(event.tag); } catch { tags = []; }
  }
  // The route authenticates Brevo before processing. Account recovery messages
  // are deliberately untracked by campaigns; acknowledge their delivery events.
  if (Array.isArray(tags) && tags.includes('leadcrm-password-reset')) return;
  const rawId = event['message-id'];
  const bareId = rawId.replace(/^<|>$/g, '');
  const log = await prisma.emailDeliveryLog.findFirst({ where: { brevoMessageId: { in: [rawId, bareId, `<${bareId}>`] }, toEmail: event.email.toLowerCase(), campaignId: { not: null } } });
  // A provider callback can race the send response. A retryable status avoids losing it.
  if (!log) throw new AppError('Delivery record is not available.', 503);
  return tenantContext.run({ tenantId: log.tenantId }, async () => {
    const scope = { tenantId: log.tenantId };
    const type = event.event === 'unique_opened' ? 'opened' : event.event === 'unsubscribed' ? 'unsubscribe' : event.event;
    await prisma.$transaction(async tx => {
      // Serialize events for this campaign so aggregate counters cannot overwrite newer values.
      await tx.campaign.update({ where: { id: log.campaignId!, ...scope }, data: { engagement: { increment: 0 } } });
      const at = brevoEventTime(event);
      const legacyKey = type === 'click' && event.link
        ? `${log.id}:click:${createHash('sha256').update(JSON.stringify([event.link, event.ts_epoch ?? event.ts_event ?? null])).digest('hex')}` : `${log.id}:${type}`;
      // The payload's id identifies the webhook subscription, not the event.
      // Include both provider timestamps: ts_epoch can refer to the original send.
      const repeatable = type === 'click' || type === 'opened';
      const eventKey = repeatable
        ? `${log.id}:${type}:v2:${createHash('sha256').update(JSON.stringify([event.link ?? '', event.ts_epoch ?? null, event.ts_event ?? event.ts ?? null])).digest('hex')}`
        : legacyKey;
      // Recognize retries of receipts saved before the expanded event key.
      if (repeatable && await tx.emailEvent.findFirst({ where: { ...scope, deliveryLogId: log.id, providerEventKey: legacyKey,
        createdAt: { gte: new Date(Math.floor(at.getTime() / 1000) * 1000), lt: new Date(Math.floor(at.getTime() / 1000) * 1000 + 1000) } } })) return;
      const inserted = await tx.emailEvent.createMany({ data: [{ ...scope, deliveryLogId: log.id, eventType: type,
        url: type === 'click' ? event.link : undefined, createdAt: at, providerEventKey: eventKey }], skipDuplicates: true });
      if (!inserted.count) return;
      const blocked = ['hard_bounce', 'blocked', 'invalid_email'].includes(type);
      const bounced = blocked || type === 'soft_bounce';
      const current = await tx.emailDeliveryLog.findFirstOrThrow({ where: { id: log.id, ...scope } });
      const rank: Record<string, number> = { pending: 0, submitted: 0.5, sent: 1, request: 1, deferred: 1, soft_bounce: 1.5, delivered: 2, opened: 3, click: 4, clicked: 4, error: 5, invalid_email: 6, hard_bounce: 6, blocked: 6, spam: 6, unsubscribed: 7 };
      const eventStatus = type === 'unsubscribe' ? 'unsubscribed' : type === 'click' ? 'clicked' : type;
      const status = (rank[eventStatus] ?? 0) > (rank[current.status] ?? 0) ? eventStatus : current.status;
      await tx.campaignContact.updateMany({ where: { ...scope, campaignId: log.campaignId!, messageId: log.brevoMessageId }, data: { status,
        ...(type === 'request' ? { sentAt: current.sentAt ?? at } : {}),
        ...(type === 'delivered' ? { deliveredAt: at } : {}),
        ...(type === 'opened' ? { openedAt: current.openedAt && current.openedAt < at ? current.openedAt : at } : {}),
        ...(type === 'click' ? { clickedAt: current.clickedAt && current.clickedAt < at ? current.clickedAt : at } : {}),
        ...(bounced ? { bouncedAt: at, ...(blocked ? { failureReason: type.toUpperCase() } : {}) } : {}),
        ...(type === 'error' ? { failureReason: 'ERROR' } : {}),
        ...(type === 'unsubscribe' ? { unsubscribed: true } : {}),
      } });
      await tx.emailDeliveryLog.update({ where: { id: log.id, ...scope }, data: { status,
        ...(type === 'request' ? { sentAt: current.sentAt ?? at } : {}),
        ...(type === 'opened' ? { openedAt: current.openedAt && current.openedAt < at ? current.openedAt : at } : {}), ...(type === 'click' ? { clickedAt: current.clickedAt && current.clickedAt < at ? current.clickedAt : at } : {}),
        ...(bounced ? { bouncedAt: at } : {}),
      } });
      await recalculateCampaignDelivery(tx, log.campaignId!, log.tenantId);
    });
  });
}
export const brevoWebhookRouter = Router();
brevoWebhookRouter.post(['/', '/email'], rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: true, legacyHeaders: false }), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.secure) throw new AppError('HTTPS is required.', 400);
    verifyWebhookAuthorization(req.get('authorization'));
    await processBrevoEvent(req.body);
    res.json({ success: true });
  } catch (error) { next(error); }
});

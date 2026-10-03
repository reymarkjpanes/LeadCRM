import { timingSafeEqual, createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';

export const BrevoEventSchema = z.object({
  event: z.enum(['request', 'delivered', 'opened', 'unique_opened', 'click', 'soft_bounce', 'hard_bounce', 'blocked', 'spam', 'unsubscribed', 'invalid_email', 'error', 'deferred']),
  email: z.string().trim().email().max(254), 'message-id': z.string().min(1).max(500),
  ts_event: z.number().int().nonnegative().optional(),
});
export function verifyWebhookAuthorization(header?: string) {
  const token = process.env.BREVO_WEBHOOK_TOKEN;
  if (!token || token.length < 32) throw new AppError('Webhook is not configured.', 503);
  const actual = createHash('sha256').update(header || '').digest();
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  if (!timingSafeEqual(actual, expected)) throw new AppError('Unauthorized webhook.', 401);
}
export async function processBrevoEvent(input: unknown) {
  const event = BrevoEventSchema.parse(input);
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
      const inserted = await tx.emailEvent.createMany({ data: [{ ...scope, deliveryLogId: log.id, eventType: type, providerEventKey: `${log.id}:${type}` }], skipDuplicates: true });
      if (!inserted.count) return;
      const at = event.ts_event && event.ts_event <= Date.now() / 1000 + 300 ? new Date(event.ts_event * 1000) : new Date();
      const blocked = ['hard_bounce', 'blocked', 'spam', 'invalid_email'].includes(type);
      const bounced = blocked || type === 'soft_bounce';
      const current = await tx.emailDeliveryLog.findFirstOrThrow({ where: { id: log.id, ...scope } });
      const rank: Record<string, number> = { pending: 0, sent: 1, request: 1, deferred: 1, soft_bounce: 1.5, delivered: 2, opened: 3, click: 4, clicked: 4, error: 5, invalid_email: 6, hard_bounce: 6, blocked: 6, spam: 6, unsubscribed: 7 };
      const eventStatus = type === 'unsubscribe' ? 'unsubscribed' : type === 'click' ? 'clicked' : type;
      const status = (rank[eventStatus] ?? 0) > (rank[current.status] ?? 0) ? eventStatus : current.status;
      await tx.campaignContact.updateMany({ where: { ...scope, campaignId: log.campaignId!, messageId: log.brevoMessageId }, data: { status,
        ...(type === 'delivered' ? { deliveredAt: at } : {}),
        ...(type === 'opened' ? { openedAt: at } : {}),
        ...(type === 'click' ? { clickedAt: at } : {}),
        ...(bounced ? { bouncedAt: at, ...(blocked ? { failureReason: type.toUpperCase() } : {}) } : {}),
        ...(type === 'unsubscribe' ? { unsubscribed: true } : {}),
      } });
      await tx.emailDeliveryLog.update({ where: { id: log.id, ...scope }, data: { status,
        ...(type === 'opened' ? { openedAt: at } : {}), ...(type === 'click' ? { clickedAt: at } : {}),
        ...(bounced ? { bouncedAt: at } : {}),
      } });
      const where = { ...scope, campaignId: log.campaignId! };
      const [sentCount, deliveredCount, openedCount, clickedCount, bouncedCount] = await Promise.all([
        tx.campaignContact.count({ where: { ...where, sentAt: { not: null } } }),
        tx.campaignContact.count({ where: { ...where, deliveredAt: { not: null } } }),
        tx.campaignContact.count({ where: { ...where, openedAt: { not: null } } }),
        tx.campaignContact.count({ where: { ...where, clickedAt: { not: null } } }),
        tx.campaignContact.count({ where: { ...where, bouncedAt: { not: null } } }),
      ]);
      await tx.campaign.update({ where: { id: log.campaignId!, ...scope }, data: { openedCount, clickedCount } });
      await tx.campaignMetrics.create({ data: { ...where, sentCount, deliveredCount, openedCount, clickedCount, bouncedCount,
        openRate: sentCount ? openedCount / sentCount * 100 : 0,
        clickRate: sentCount ? clickedCount / sentCount * 100 : 0,
        deliveryRate: sentCount ? deliveredCount / sentCount * 100 : 0,
        bounceRate: sentCount ? bouncedCount / sentCount * 100 : 0,
      } });
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

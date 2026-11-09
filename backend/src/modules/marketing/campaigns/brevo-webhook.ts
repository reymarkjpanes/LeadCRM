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
const failedEvents = ['hard_bounce', 'blocked', 'invalid_email', 'error'];
const terminalEvents = ['delivered', ...failedEvents];
const deliveryEvents = ['request', 'deferred', 'soft_bounce', ...terminalEvents];

function hasChanges(current: Record<string, unknown>, update: Record<string, unknown>) {
  return Object.entries(update).some(([key, value]) => {
    const before = current[key];
    return value !== undefined && (value instanceof Date && before instanceof Date ? +value !== +before : value !== before);
  });
}

export async function processBrevoEvent(input: unknown) {
  const event = BrevoEventSchema.parse(input);
  let tags: unknown = event.tags;
  if (!tags && event.tag) {
    try { tags = JSON.parse(event.tag); } catch { tags = []; }
  }
  // The route authenticates Brevo before processing. Account recovery messages
  // are deliberately untracked by campaigns; acknowledge their delivery events.
  if (Array.isArray(tags) && tags.some(tag => ['leadcrm-password-reset', 'leadcrm-profile-email-change'].includes(tag))) return;
  const rawId = event['message-id'];
  const bareId = rawId.replace(/^<|>$/g, '');
  const logs = await prisma.emailDeliveryLog.findMany({ where: { brevoMessageId: { in: [rawId, bareId, `<${bareId}>`] },
    toEmail: { equals: event.email, mode: 'insensitive' }, campaignId: { not: null } }, take: 2 });
  if (logs.length > 1) throw new AppError('Delivery record is ambiguous.', 409);
  const [log] = logs;
  // A callback can race the send response. The history lookup can recover a missed event.
  if (!log) throw new AppError('Delivery record is not available.', 503);
  return tenantContext.run({ tenantId: log.tenantId }, async () => {
    const scope = { tenantId: log.tenantId };
    const type = event.event === 'unique_opened' ? 'opened' : event.event === 'unsubscribed' ? 'unsubscribe' : event.event;
    const timedDelivery = deliveryEvents.includes(type);
    if (timedDelivery && event.ts_event == null && event.ts == null && event.ts_epoch == null) {
      throw new AppError('Delivery events require a provider timestamp.', 400);
    }
    await prisma.$transaction(async tx => {
      // Serialize events for this campaign so aggregate counters cannot overwrite newer values.
      await tx.campaign.update({ where: { id: log.campaignId!, ...scope }, data: { engagement: { increment: 0 } } });
      const at = brevoEventTime(event);
      const legacyKey = type === 'click' && event.link
        ? `${log.id}:click:${createHash('sha256').update(JSON.stringify([event.link, event.ts_epoch ?? event.ts_event ?? null])).digest('hex')}` : `${log.id}:${type}`;
      // The payload's id identifies the webhook subscription, not the event.
      // Include both provider timestamps: ts_epoch can refer to the original send.
      const repeatable = type === 'click' || type === 'opened';
      const eventKey = timedDelivery ? legacyKey + ':at:' + at.toISOString() : repeatable
        ? `${log.id}:${type}:v2:${createHash('sha256').update(JSON.stringify([event.link ?? '', event.ts_epoch ?? null, event.ts_event ?? event.ts ?? null])).digest('hex')}`
        : legacyKey;
      // Recognize retries of receipts saved before the expanded event key.
      const legacyReceipt = (repeatable || timedDelivery) && await tx.emailEvent.findFirst({ where: { ...scope, deliveryLogId: log.id, providerEventKey: legacyKey,
        createdAt: { gte: new Date(Math.floor(at.getTime() / 1000) * 1000), lt: new Date(Math.floor(at.getTime() / 1000) * 1000 + 1000) } } });
      const inserted = !legacyReceipt && (await tx.emailEvent.createMany({ data: [{ ...scope, deliveryLogId: log.id, eventType: type,
        url: type === 'click' ? event.link : undefined, createdAt: at, providerEventKey: eventKey }], skipDuplicates: true })).count > 0;
      if (!inserted && !timedDelivery) return;
      const current = await tx.emailDeliveryLog.findFirstOrThrow({ where: { id: log.id, ...scope } });
      const recipientWhere = { ...scope, campaignId: log.campaignId!, messageId: log.brevoMessageId,
        email: { equals: log.toEmail, mode: 'insensitive' as const } };
      const recipient = await tx.campaignContact.findFirst({ where: recipientWhere });
      // Terminal receipts outrank retryable transport events. Within terminal
      // outcomes the latest provider evidence wins, independent of arrival order.
      const terminal = await tx.emailEvent.findMany({ where: { ...scope, deliveryLogId: log.id, eventType: { in: terminalEvents } },
        orderBy: [{ createdAt: 'desc' }, { eventType: 'asc' }], distinct: ['eventType'], select: { eventType: true, createdAt: true } });
      if (recipient?.deliveredAt && !terminal.some(receipt => receipt.eventType === 'delivered')) {
        terminal.push({ eventType: 'delivered', createdAt: recipient.deliveredAt });
      }
      terminal.sort((a, b) => +b.createdAt - +a.createdAt || Number(b.eventType === 'delivered') - Number(a.eventType === 'delivered'));
      const latest = terminal[0];
      const lifecycle = latest?.eventType ?? (timedDelivery &&
        (!recipient?.providerUpdatedAt || at >= recipient.providerUpdatedAt) ? type : undefined);
      const failureReason = latest ? failedEvents.includes(latest.eventType) ? latest.eventType.toUpperCase() : null : undefined;
      const bounce = ['soft_bounce', 'hard_bounce', 'blocked', 'invalid_email'].includes(type);
      const sharedUpdate = {
        ...(lifecycle ? { status: lifecycle === 'request' ? 'sent' : lifecycle } : {}),
        ...(type === 'request' ? { sentAt: recipient?.submittedAt && current.sentAt && current.sentAt < at ? current.sentAt : at } : {}),
        ...(type === 'opened' ? { openedAt: current.openedAt && current.openedAt < at ? current.openedAt : at } : {}),
        ...(type === 'click' ? { clickedAt: current.clickedAt && current.clickedAt < at ? current.clickedAt : at } : {}),
        ...(bounce ? { bouncedAt: current.bouncedAt && current.bouncedAt > at ? current.bouncedAt : at } : {}),
      };
      const recipientUpdate = { ...sharedUpdate,
        ...(lifecycle ? { providerUpdatedAt: latest?.createdAt ?? at } : {}),
        ...(latest?.eventType === 'delivered' ? { deliveredAt: recipient?.deliveredAt && recipient.deliveredAt < latest.createdAt ? recipient.deliveredAt : latest.createdAt } : {}),
        failureReason,
        ...(type === 'unsubscribe' ? { unsubscribed: true } : {}),
      };
      if (recipient && hasChanges(recipient, recipientUpdate)) {
        await tx.campaignContact.update({ where: { id: recipient.id, ...scope, campaignId: log.campaignId! }, data: recipientUpdate });
      }
      const suppression = type === 'unsubscribe' || current.status === 'unsubscribed' ? 'unsubscribed'
        : type === 'spam' || current.status === 'spam' ? 'spam' : undefined;
      const logUpdate = { ...sharedUpdate, ...(suppression ? { status: suppression } : {}) };
      if (hasChanges(current, logUpdate)) await tx.emailDeliveryLog.update({ where: { id: log.id, ...scope }, data: logUpdate });
      await recalculateCampaignDelivery(tx, log.campaignId!, log.tenantId, true);
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

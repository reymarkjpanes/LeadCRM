import { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { isBrevoConfigured } from '../../../shared/services/email.service';
import { BrevoEventSchema, processBrevoEvent } from './brevo-webhook';

const batchSize = 5;
const historyDays = 30;
const minute = 60_000;
const terminalStatuses = ['delivered', 'excluded', 'failed', 'error', 'hard_bounce', 'blocked', 'invalid_email'];
const historyResponse = z.object({ events: z.array(z.unknown()).default([]) });
const historyEvent = z.object({
  event: z.string(), messageId: z.string(), email: z.string(), date: z.string().datetime({ offset: true }),
});
const deliveryEvents = new Map([
  ['requests', 'request'], ['request', 'request'], ['delivered', 'delivered'], ['deferred', 'deferred'],
  ['softbounces', 'soft_bounce'], ['softbounce', 'soft_bounce'], ['soft_bounce', 'soft_bounce'],
  ['hardbounces', 'hard_bounce'], ['hardbounce', 'hard_bounce'], ['hard_bounce', 'hard_bounce'],
  ['blocked', 'blocked'], ['invalid', 'invalid_email'], ['invalid_email', 'invalid_email'], ['error', 'error'],
]);
const normalizeMessageId = (value: string) => value.trim().replace(/^<|>$/g, '');

function deliveryReceipts(input: unknown, messageId: string, recipient: string, submittedAt: Date, now: Date) {
  const receipts = new Map<string, { time: number; event: z.infer<typeof BrevoEventSchema> }>();
  for (const raw of historyResponse.parse(input).events) {
    const parsed = historyEvent.safeParse(raw);
    if (!parsed.success) continue;
    const { date, email, event, messageId: providerId } = parsed.data;
    if (normalizeMessageId(providerId) !== normalizeMessageId(messageId) ||
      email.trim().toLowerCase() !== recipient.trim().toLowerCase()) continue;
    const time = Date.parse(date), type = deliveryEvents.get(event.toLowerCase());
    if (!type || !Number.isFinite(time) || time < +submittedAt - 2 * minute || time > +now + 5 * minute) continue;
    const receipt = BrevoEventSchema.safeParse({ event: type, email: recipient, 'message-id': messageId, ts_epoch: time });
    if (!receipt.success) continue;
    const previous = receipts.get(type)?.time;
    if (previous === undefined || (type === 'request' ? time < previous : time > previous)) {
      receipts.set(type, { time, event: receipt.data });
    }
  }
  return [...receipts.values()].sort((a, b) => a.time - b.time).map(receipt => receipt.event);
}

/** Recover lost delivery callbacks from existing provider messages. This never submits email. */
export async function reconcileBrevoStatuses(afterId?: string, now = new Date()): Promise<string | undefined> {
  if (!isBrevoConfigured()) return undefined;
  const rows = await prisma.campaignContact.findMany({
    where: {
      ...(afterId ? { id: { gt: afterId } } : {}),
      email: { not: null }, messageId: { not: null }, deliveredAt: null,
      status: { notIn: terminalStatuses },
      submittedAt: { gte: new Date(+now - historyDays * 24 * 60 * minute), lte: new Date(+now - 2 * minute) },
      campaign: { type: 'EMAIL', isArchived: false, submissionFinishedAt: { not: null } },
    },
    orderBy: { id: 'asc' }, take: batchSize,
    select: { id: true, tenantId: true, campaignId: true, email: true, messageId: true, submittedAt: true },
  });
  let cursor = afterId;
  for (const { id, tenantId, campaignId, email, messageId, submittedAt } of rows) {
    if (!email || !messageId || !submittedAt) continue;
    try {
      const query = new URLSearchParams({ messageId, days: String(historyDays), limit: '5000' });
      const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?' + query, {
        method: 'GET', headers: { 'api-key': process.env.BREVO_API_KEY!, accept: 'application/json' },
        signal: AbortSignal.timeout(4000), redirect: 'error',
      });
      if (response.ok) {
        const receipts = deliveryReceipts(await response.json(), messageId, email, submittedAt, now);
        if (receipts.length) await tenantContext.run({ tenantId }, async () => {
          const log = await prisma.emailDeliveryLog.findFirst({
            where: { tenantId, campaignId, brevoMessageId: messageId, toEmail: { equals: email, mode: 'insensitive' } },
            select: { id: true },
          });
          if (!log) return;
          for (const receipt of receipts) await processBrevoEvent(receipt);
        });
      } else {
        console.warn('[Campaigns]', { event: 'brevo_status_lookup_failed', httpStatus: response.status });
        if ([401, 403, 429].includes(response.status) || response.status >= 500) return cursor;
      }
    } catch {
      console.warn('[Campaigns]', { event: 'brevo_status_lookup_failed', recipientId: id });
    }
    cursor = id;
  }
  // Rotate past messages that are still pending, then revisit them on the next pass.
  return rows.length === batchSize ? cursor : undefined;
}

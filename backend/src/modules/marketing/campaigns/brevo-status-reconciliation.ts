import { z } from 'zod';
import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { isBrevoConfigured } from '../../../shared/services/email.service';
import { BrevoEventSchema, processBrevoEvent } from './brevo-webhook';

const batchSize = 5;
const historyDays = 30;
const minute = 60_000;
const terminalStatuses = ['excluded', 'failed', 'error', 'hard_bounce', 'blocked', 'invalid_email'];
const historyResponse = z.object({ events: z.array(z.unknown()).default([]) });
const historyEvent = z.object({
  event: z.string(), messageId: z.string(), email: z.string(), date: z.string().datetime({ offset: true }),
  link: z.string().max(8192).nullish(),
});
const deliveryEvents = new Map([
  ['requests', 'request'], ['request', 'request'], ['delivered', 'delivered'], ['deferred', 'deferred'],
  ['softbounces', 'soft_bounce'], ['softbounce', 'soft_bounce'], ['soft_bounce', 'soft_bounce'],
  ['hardbounces', 'hard_bounce'], ['hardbounce', 'hard_bounce'], ['hard_bounce', 'hard_bounce'],
  ['blocked', 'blocked'], ['invalid', 'invalid_email'], ['invalid_email', 'invalid_email'], ['error', 'error'],
  ['opened', 'opened'], ['uniqueopened', 'unique_opened'], ['unique_opened', 'unique_opened'],
  ['clicks', 'click'], ['click', 'click'],
]);
const normalizeMessageId = (value: string) => value.trim().replace(/^<|>$/g, '');

function deliveryReceipts(input: unknown, messageId: string, recipient: string, submittedAt: Date, now: Date) {
  const receipts = new Map<string, { time: number; event: z.infer<typeof BrevoEventSchema> }>();
  for (const raw of historyResponse.parse(input).events) {
    const parsed = historyEvent.safeParse(raw);
    if (!parsed.success) continue;
    const { date, email, event, messageId: providerId, link } = parsed.data;
    if (normalizeMessageId(providerId) !== normalizeMessageId(messageId) ||
      email.trim().toLowerCase() !== recipient.trim().toLowerCase()) continue;
    const time = Date.parse(date), type = deliveryEvents.get(event.toLowerCase());
    if (!type || !Number.isFinite(time) || time < +submittedAt - 2 * minute || time > +now + 5 * minute) continue;
    const receipt = BrevoEventSchema.safeParse({ event: type, email: recipient, 'message-id': messageId, ts_epoch: time,
      ...(type === 'click' && link ? { link } : {}) });
    if (!receipt.success) continue;
    // Engagement is repeatable; retain each timestamp without inflating unique recipients.
    const key = ['opened', 'unique_opened', 'click'].includes(type) ? `${type}:${time}:${link ?? ''}` : type;
    const previous = receipts.get(key)?.time;
    if (previous === undefined || (type === 'request' ? time < previous : time > previous)) {
      receipts.set(key, { time, event: receipt.data });
    }
  }
  return [...receipts.values()].sort((a, b) => a.time - b.time).map(receipt => receipt.event);
}

/** Recover delivery and engagement for recent existing messages. This never submits email. */
export async function reconcileBrevoStatuses(afterId?: string, now = new Date()): Promise<string | undefined> {
  if (!isBrevoConfigured()) return undefined;
  const started = performance.now();
  const rows = await prisma.campaignContact.findMany({
    where: {
      ...(afterId ? { id: { gt: afterId } } : {}),
      email: { not: null }, messageId: { not: null },
      status: { notIn: terminalStatuses },
      OR: [{ deliveredAt: null }, { openedAt: null }, { clickedAt: null }],
      submittedAt: { gte: new Date(+now - historyDays * 24 * 60 * minute), lte: new Date(+now - 2 * minute) },
      campaign: { type: 'EMAIL', isArchived: false, submissionFinishedAt: { not: null } },
    },
    orderBy: { id: 'asc' }, take: batchSize,
    select: { id: true, tenantId: true, campaignId: true, email: true, messageId: true, submittedAt: true },
  });
  let cursor = afterId;
  let checked = 0, verifiedEvents = 0, failures = 0;
  const finish = (nextCursor: string | undefined, deferred = false) => {
    console.info('[Campaigns]', { event: 'brevo_reconciliation_sweep', selected: rows.length,
      checked, verifiedEvents, failures, hasMore: nextCursor !== undefined, deferred,
      durationMs: Math.round(performance.now() - started) });
    return nextCursor;
  };
  for (const { id, tenantId, campaignId, email, messageId, submittedAt } of rows) {
    if (!email || !messageId || !submittedAt) continue;
    try {
      checked++;
      const query = new URLSearchParams({ messageId, days: String(historyDays), limit: '5000' });
      const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?' + query, {
        method: 'GET', headers: { 'api-key': process.env.BREVO_API_KEY!, accept: 'application/json' },
        signal: AbortSignal.timeout(4000), redirect: 'error',
      });
      if (response.ok) {
        const body = historyResponse.parse(await response.json());
        const receipts = deliveryReceipts(body, messageId, email, submittedAt, now);
        if (body.events.length >= 5000) console.warn('[Campaigns]', { event: 'brevo_history_truncated', campaignId, recipientId: id });
        if (body.events.length && !receipts.length) console.warn('[Campaigns]', { event: 'brevo_history_unmatched', campaignId, recipientId: id, category: 'no_verified_events' });
        if (receipts.length) await tenantContext.run({ tenantId }, async () => {
          const log = await prisma.emailDeliveryLog.findFirst({
            where: { tenantId, campaignId, brevoMessageId: messageId, toEmail: { equals: email, mode: 'insensitive' } },
            select: { id: true },
          });
          if (!log) {
            failures++;
            console.warn('[Campaigns]', { event: 'brevo_history_unmatched', campaignId, recipientId: id });
            return;
          }
          for (const receipt of receipts) {
            await processBrevoEvent(receipt, 'history');
            verifiedEvents++;
          }
        });
      } else {
        failures++;
        console.warn('[Campaigns]', { event: 'brevo_status_lookup_failed', httpStatus: response.status });
        if ([401, 403, 429].includes(response.status) || response.status >= 500) return finish(cursor, true);
      }
    } catch (error) {
      failures++;
      console.warn('[Campaigns]', { event: 'brevo_status_lookup_failed', campaignId, recipientId: id,
        category: error instanceof z.ZodError || error instanceof SyntaxError ? 'response_validation' : 'transport_or_persistence' });
    }
    cursor = id;
  }
  // Rotate past messages that are still pending, then revisit them on the next pass.
  return finish(rows.length === batchSize ? cursor : undefined);
}

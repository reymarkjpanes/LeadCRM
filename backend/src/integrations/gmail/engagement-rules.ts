import { CrmStatus, normalizeCrmStatus } from '@leadcrm/shared';

export const ENGAGEMENT_RULE_VERSION = 2;
export const DAY_MS = 86_400_000;
export function normalizeEmail(value: string): string {
  return (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase();
}
export interface EngagementHistory {
  status: string;
  lastCustomerReplyAt: Date | null;
  firstUnansweredOutboundAt: Date | null;
}
/** Completed UTC 24-hour days, independent of local midnight and DST. */
export function engagementStatus(record: EngagementHistory, now = new Date()): CrmStatus | undefined {
  if (['Closed', 'Cancelled'].includes(normalizeCrmStatus(record.status))) return;
  const baseline = record.lastCustomerReplyAt ?? record.firstUnansweredOutboundAt;
  if (!baseline || !Number.isFinite(+baseline) || +baseline > +now) return;
  const days = Math.floor((+now - +baseline) / DAY_MS);
  return days >= 30 ? 'Cold' : record.lastCustomerReplyAt && days < 8 ? 'Hot' : 'Warm';
}
export function engagementReason(record: EngagementHistory): string {
  return record.lastCustomerReplyAt
    ? `Customer engagement based on the latest inbound reply at ${record.lastCustomerReplyAt.toISOString()}.`
    : `Waiting for the first customer reply since ${record.firstUnansweredOutboundAt!.toISOString()}.`;
}

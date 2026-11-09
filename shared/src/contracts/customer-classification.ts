import { normalizeCrmStatus, type CrmStatus } from './record-experience';

export const LEAD_WORKLOAD_WEIGHTS: Record<CrmStatus, number> = { Inquiry: 1, Warm: 2, Hot: 3, Cold: 1, 'Closed Deal': 0, Cancelled: 0 };
export const CUSTOMER_STATUS_HELP: Record<CrmStatus, string> = {
  Inquiry: 'New inquiry; awaiting a customer reply.',
  Warm: 'Recent customer engagement, or the Hot qualification window has elapsed.',
  Hot: 'Recently qualified; verified replies while Hot renew the eight-day window.',
  Cold: 'Inactive; follow up when appropriate.',
  'Closed Deal': 'Sale completed through a confirmed Closed Deal Deal.',
  Cancelled: 'Cancelled; explicit staff cancellation requires authorized reopening.',
};
export interface CustomerClassificationEvidence {
  status: string;
  qualified?: boolean;
  qualificationChanged?: boolean;
  genuineReply?: boolean;
  lastCustomerReplyAt: Date | null;
  firstUnansweredOutboundAt: Date | null;
  firstStaffOutreachAt?: Date | null;
}
/** One precedence policy for both people modules and every communication channel. */
export function classifyCustomer(record: CustomerClassificationEvidence, now = new Date()): CrmStatus | undefined {
  const status = normalizeCrmStatus(record.status);
  if (status === 'Closed Deal' || status === 'Cancelled') return;
  if (record.qualified) return 'Hot';
  const valid = (value: Date | null | undefined) => value && Number.isFinite(+value) && +value <= +now ? value : null;
  const reply = valid(record.lastCustomerReplyAt);
  const outreach = valid(record.firstUnansweredOutboundAt) ?? valid(record.firstStaffOutreachAt);
  const baseline = reply ?? outreach;
  if (status === 'Inquiry' && !reply && !valid(record.firstStaffOutreachAt)) return;
  if (!baseline) return record.qualificationChanged ? 'Inquiry' : undefined;
  const days = Math.floor((+now - +baseline) / 86_400_000);
  if (days >= 30) return 'Cold';
  if (record.qualificationChanged) return reply ? 'Warm' : 'Inquiry';
  if (record.genuineReply && reply && (status === 'Inquiry' || status === 'Cold')) return 'Warm';
  if (status === 'Hot' && days >= 8) return 'Warm';
  return status;
}

export interface DealEngagementEvent { type: 'qualified' | 'reply' | 'outreach'; at: Date }
/** Replay verified Deal events. Staff follow-ups never renew an engagement clock. */
export function classifyDealEngagement(events: DealEngagementEvent[], now = new Date(), outcome?: 'won' | 'lost'): CrmStatus {
  if (outcome) return outcome === 'won' ? 'Closed Deal' : 'Cancelled';
  let status: CrmStatus = 'Inquiry';
  let qualified = false;
  let baseline: number | undefined;
  const age = (at: number) => {
    if (baseline === undefined) return;
    if (at - baseline >= 30 * 86_400_000) status = 'Cold';
    else if (status === 'Hot' && at - baseline >= 8 * 86_400_000) status = 'Warm';
  };
  const rank = { outreach: 0, qualified: 1, reply: 2 };
  for (const event of events.filter(event => Number.isFinite(+event.at) && +event.at <= +now)
    .sort((a, b) => +a.at - +b.at || rank[a.type] - rank[b.type])) {
    age(+event.at);
    if (event.type === 'qualified') { qualified = true; status = 'Hot'; baseline = +event.at; }
    else if (event.type === 'reply') { status = qualified ? 'Hot' : 'Warm'; baseline = +event.at; }
    else if (baseline === undefined) { status = 'Inquiry'; baseline = +event.at; }
  }
  age(+now);
  return status;
}

export function aggregateDealEngagement(deals: Array<{ engagementStatus: string; isArchived: boolean; pipelineArchived: boolean; isWon: boolean; isLost: boolean; confirmedWon: boolean }>): CrmStatus | undefined {
  const eligible = deals.filter(deal => deal.confirmedWon || deal.isLost || (!deal.isArchived && !deal.pipelineArchived));
  const open = eligible.filter(deal => !deal.isArchived && !deal.pipelineArchived && !deal.isWon && !deal.isLost);
  if (open.length) return (['Hot', 'Warm', 'Inquiry', 'Cold'] as const).find(status => open.some(deal => deal.engagementStatus === status)) ?? 'Inquiry';
  if (eligible.some(deal => deal.confirmedWon)) return 'Closed Deal';
  if (eligible.length && eligible.every(deal => deal.isLost)) return 'Cancelled';
  return undefined;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOMER_STATUS_HELP = exports.LEAD_WORKLOAD_WEIGHTS = void 0;
exports.classifyCustomer = classifyCustomer;
exports.classifyDealEngagement = classifyDealEngagement;
exports.aggregateDealEngagement = aggregateDealEngagement;
const record_experience_1 = require("./record-experience");
exports.LEAD_WORKLOAD_WEIGHTS = { Inquiry: 1, Warm: 2, Hot: 3, Cold: 1, 'Closed Deal': 0, Cancelled: 0 };
exports.CUSTOMER_STATUS_HELP = {
    Inquiry: 'New inquiry; awaiting a customer reply.',
    Warm: 'Recent customer engagement, or the Hot qualification window has elapsed.',
    Hot: 'Recently qualified; verified replies while Hot renew the eight-day window.',
    Cold: 'Inactive; follow up when appropriate.',
    'Closed Deal': 'Sale completed through a confirmed Closed Deal Deal.',
    Cancelled: 'Cancelled; explicit staff cancellation requires authorized reopening.',
};
/** One precedence policy for both people modules and every communication channel. */
function classifyCustomer(record, now = new Date()) {
    const status = (0, record_experience_1.normalizeCrmStatus)(record.status);
    if (status === 'Closed Deal' || status === 'Cancelled')
        return;
    if (record.qualified)
        return 'Hot';
    const valid = (value) => value && Number.isFinite(+value) && +value <= +now ? value : null;
    const reply = valid(record.lastCustomerReplyAt);
    const outreach = valid(record.firstUnansweredOutboundAt) ?? valid(record.firstStaffOutreachAt);
    const baseline = reply ?? outreach;
    if (status === 'Inquiry' && !reply && !valid(record.firstStaffOutreachAt))
        return;
    if (!baseline)
        return record.qualificationChanged ? 'Inquiry' : undefined;
    const days = Math.floor((+now - +baseline) / 86400000);
    if (days >= 30)
        return 'Cold';
    if (record.qualificationChanged)
        return reply ? 'Warm' : 'Inquiry';
    if (record.genuineReply && reply && (status === 'Inquiry' || status === 'Cold'))
        return 'Warm';
    if (status === 'Hot' && days >= 8)
        return 'Warm';
    return status;
}
/** Replay verified Deal events. Staff follow-ups never renew an engagement clock. */
function classifyDealEngagement(events, now = new Date(), outcome) {
    if (outcome)
        return outcome === 'won' ? 'Closed Deal' : 'Cancelled';
    let status = 'Inquiry';
    let qualified = false;
    let baseline;
    const age = (at) => {
        if (baseline === undefined)
            return;
        if (at - baseline >= 30 * 86400000)
            status = 'Cold';
        else if (status === 'Hot' && at - baseline >= 8 * 86400000)
            status = 'Warm';
    };
    const rank = { outreach: 0, qualified: 1, reply: 2 };
    for (const event of events.filter(event => Number.isFinite(+event.at) && +event.at <= +now)
        .sort((a, b) => +a.at - +b.at || rank[a.type] - rank[b.type])) {
        age(+event.at);
        if (event.type === 'qualified') {
            qualified = true;
            status = 'Hot';
            baseline = +event.at;
        }
        else if (event.type === 'reply') {
            status = qualified ? 'Hot' : 'Warm';
            baseline = +event.at;
        }
        else if (baseline === undefined) {
            status = 'Inquiry';
            baseline = +event.at;
        }
    }
    age(+now);
    return status;
}
function aggregateDealEngagement(deals) {
    const eligible = deals.filter(deal => deal.confirmedWon || deal.isLost || (!deal.isArchived && !deal.pipelineArchived));
    const open = eligible.filter(deal => !deal.isArchived && !deal.pipelineArchived && !deal.isWon && !deal.isLost);
    if (open.length)
        return ['Hot', 'Warm', 'Inquiry', 'Cold'].find(status => open.some(deal => deal.engagementStatus === status)) ?? 'Inquiry';
    if (eligible.some(deal => deal.confirmedWon))
        return 'Closed Deal';
    if (eligible.length && eligible.every(deal => deal.isLost))
        return 'Cancelled';
    return undefined;
}

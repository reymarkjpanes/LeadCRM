import { describe, expect, it } from 'vitest';
import { classifyEngagement, eligibleForCold, engagementStatus, normalizeEmail } from './engagement-rules';
import { ClosedWonConfirmationSchema, SendMailboxEmailSchema } from '@leadcrm/shared';
import { parseGmailMessage } from './gmail.service';

describe('conservative engagement rules', () => {
  it.each(['Could you please send me the available options and a quotation based on those areas?', 'Please send me the formal quotation and let me know the next steps if we decide to proceed.'])('qualifies the observed request patterns independently of purchase uncertainty: %s', body => { expect(classifyEngagement(body, true)).toBe('quotation'); expect(engagementStatus('Warm', 'quotation')).toBe('Warm'); });
  it('keeps interest in proceeding Warm until a clear decision', () => expect(classifyEngagement('The package looks suitable. I’m interested in proceeding.', true)).toBe('interested'));
  it.each(['The quotation is acceptable.', 'Please schedule the installation.', 'We are okay with the package and would like to continue.', 'We would like to proceed.', 'Please proceed with the order.', 'We approve the quotation.'])('supports the requested buying-intent examples: %s', body => expect(classifyEngagement(body, true)).toBe('proceed'));
  it.each(['May I get a formal quotation?', 'Could you please share a proposal?', 'Can I request purchase terms?', 'Please issue a contract.', 'We would like a formal scope of work.'])('supports explicit customer requests: %s', body => expect(classifyEngagement(body)).toBe('quotation'));
  it.each(['The quotation is not acceptable.', 'Please schedule the installation after approval.', 'Is the quotation acceptable?', 'We are considering the package and might continue.'])('does not infer approval from uncertainty: %s', body => expect(classifyEngagement(body, true)).not.toBe('proceed'));
  it.each(['Thanks', 'Noted', "I'll check", 'Maybe', 'Let me ask my manager', 'We might proceed', 'We do not approve the quotation', 'If the price falls, we will proceed', 'Are you asking us to cancel the order?', 'My manager said we will proceed', 'We are not ready to proceed'])('abstains from ambiguous language: %s', body => expect(classifyEngagement(body, true)).toBe('none'));
  it.each(['We want to proceed with the product.', 'I have decided to purchase.', 'We approve the quotation and will proceed.', 'Please proceed with our order.'])('detects intent without closing: %s', body => { expect(classifyEngagement(body)).toBe('proceed'); expect(engagementStatus('Warm', 'proceed')).toBe('Hot'); });
  it.each(['Can you send a quotation?', 'Please prepare a contract.', 'We request final pricing.', 'Could you provide a formal scope of work?'])('detects formal steps: %s', body => expect(classifyEngagement(body)).toBe('quotation'));
  it.each(['How does the product work?', 'We are still deciding on the service.', 'Can you tell us more about the installation?'])('detects interest: %s', body => expect(classifyEngagement(body)).toBe('interested'));
  it.each(['We are no longer interested.', 'Please cancel our order.', 'Please do not proceed.', 'I decline your proposal.'])('detects explicit cancellation: %s', body => expect(classifyEngagement(body)).toBe('cancel'));
  it('ignores quoted text and automated responses', () => {
    expect(classifyEngagement('Thanks\nOn Tuesday someone wrote:\nWe approve the quotation.')).toBe('none');
    expect(classifyEngagement('<p>Thanks</p><blockquote>We want to proceed with the order.</blockquote>')).toBe('none');
    expect(classifyEngagement('<p>Thanks</p><div class="gmail_quote">We want to proceed with the order.</div>')).toBe('none');
    expect(classifyEngagement('We want to proceed', true, true)).toBe('none');
  });
  it.each(["We approve the quotation but won't proceed", 'We are not interested in cancelling our order', 'We will proceed after approval', 'We approve the quotation subject to financing'])('abstains when apparent intent is qualified: %s', body => expect(classifyEngagement(body, true)).toBe('none'));
  it('preserves terminal CRM statuses and re-engages Cold', () => {
    for (const status of ['Closed', 'Cancelled']) for (const signal of ['interested', 'proceed', 'quotation', 'cancel'] as const) expect(engagementStatus(status, signal)).toBeUndefined();
    expect(engagementStatus('Cold', 'interested')).toBe('Warm'); expect(engagementStatus('Cold', 'proceed')).toBe('Hot');
    expect(engagementStatus('Hot', 'interested')).toBeUndefined();
  });
  it('requires meaningful inbound age and a genuine unanswered outbound for Cold', () => {
    const now = new Date('2026-10-01T00:00:00Z'), day = 86400000;
    const record = { status: 'Warm', lastMeaningfulInboundAt: new Date(+now - 60 * day), firstUnansweredOutboundAt: new Date(+now - 45 * day), lastStatusChangedAt: null };
    expect(eligibleForCold(record, now)).toBe(true);
    expect(eligibleForCold({ ...record, firstUnansweredOutboundAt: null }, now)).toBe(false);
    expect(eligibleForCold({ ...record, lastMeaningfulInboundAt: new Date(+now - 30 * day) }, now)).toBe(false);
    expect(eligibleForCold({ ...record, lastStatusChangedAt: new Date(+now - 5 * day) }, now)).toBe(false);
    expect(eligibleForCold({ ...record, status: 'Cancelled' }, now)).toBe(false);
  });
  it('uses exact normalized email addresses without name or Gmail alias guessing', () => {
    expect(normalizeEmail('Customer <Person+sales@Example.com> ')).toBe('person+sales@example.com');
    expect(normalizeEmail('p.erson@gmail.com')).not.toBe(normalizeEmail('person@gmail.com'));
  });
  it('requires structured confirmation and an explanation for Other', () => {
    expect(ClosedWonConfirmationSchema.safeParse({}).success).toBe(false);
    expect(ClosedWonConfirmationSchema.safeParse({ type: 'Other', date: '2026-02-30' }).success).toBe(false);
    expect(ClosedWonConfirmationSchema.safeParse({ type: 'Other', date: '2026-01-01', note: '   ' }).success).toBe(false);
    expect(ClosedWonConfirmationSchema.safeParse({ type: 'Other', date: '2026-01-01', note: 'Sale independently verified.' }).success).toBe(true);
  });
  it('rejects header injection and arbitrary sender fields', () => {
    expect(SendMailboxEmailSchema.safeParse({ to: 'user@example.test', subject: 'Hello\r\nBcc: victim@example.test', body: 'Text' }).success).toBe(false);
    expect(SendMailboxEmailSchema.safeParse({ to: 'user@example.test', from: 'someone@example.test', subject: 'Hello', body: 'Text' }).success).toBe(false);
  });
  it('decodes nested MIME and trusts provider received time over a forged Date header', () => {
    const message = parseGmailMessage({ id: '123', threadId: '456', internalDate: '1000000', labelIds: ['INBOX'], snippet: '', payload: { headers: [{ name: 'Date', value: '2099-01-01' }, { name: 'To', value: '"Rivera, Jamie" <jamie@example.test>, staff@camxian.com' }], parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Product question').toString('base64url') } }] }] } });
    expect(message.plainText).toBe('Product question'); expect(message.date).toBe(new Date(1000000).toISOString());
    expect(message.to).toEqual(['"Rivera, Jamie" <jamie@example.test>', 'staff@camxian.com']);
  });
});

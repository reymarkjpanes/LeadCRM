import { describe, expect, it } from 'vitest';
import { engagementStatus, normalizeEmail, DAY_MS } from './engagement-rules';
import { ClosedWonConfirmationSchema, SendMailboxEmailSchema } from '@leadcrm/shared';
import { parseGmailMessage } from './gmail.service';

describe('reply timestamp engagement', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it.each([[0, 'Hot'], [7, 'Hot'], [7.5, 'Hot'], [8, 'Warm'], [29, 'Warm'], [30, 'Cold'], [60, 'Cold']] as const)('reply %s days ago is %s', (days, status) => {
    expect(engagementStatus({ status: 'Cold', lastCustomerReplyAt: new Date(+now - days * DAY_MS), firstUnansweredOutboundAt: null }, now)).toBe(status);
  });
  it.each([[8 * DAY_MS - 1, 'Hot'], [8 * DAY_MS, 'Warm'], [30 * DAY_MS - 1, 'Warm'], [30 * DAY_MS, 'Cold']] as const)('has exact elapsed millisecond boundaries %s', (age, status) => {
    expect(engagementStatus({ status: 'Warm', lastCustomerReplyAt: new Date(+now - age), firstUnansweredOutboundAt: now }, now)).toBe(status);
  });
  it.each([[0, 'Warm'], [10, 'Warm'], [30, 'Cold'], [60, 'Cold']] as const)('never replied after %s days is %s', (days, status) => {
    expect(engagementStatus({ status: 'Hot', lastCustomerReplyAt: null, firstUnansweredOutboundAt: new Date(+now - days * DAY_MS) }, now)).toBe(status);
  });
  it('preserves no-history and terminal records and rejects future timestamps', () => {
    expect(engagementStatus({ status: 'Warm', lastCustomerReplyAt: null, firstUnansweredOutboundAt: null }, now)).toBeUndefined();
    for (const status of ['Closed', 'Cancelled']) expect(engagementStatus({ status, lastCustomerReplyAt: now, firstUnansweredOutboundAt: null }, now)).toBeUndefined();
    expect(engagementStatus({ status: 'Cold', lastCustomerReplyAt: new Date(+now + 1), firstUnansweredOutboundAt: null }, now)).toBeUndefined();
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
  it.each([
    { headers: [{ name: 'Return-Path', value: '<>' }] },
    { headers: [{ name: 'From', value: 'Mailer <mailer-daemon@example.test>' }] },
    { headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] },
    { headers: [], parts: [{ mimeType: 'message/delivery-status' }] },
    { headers: [], mimeType: 'multipart/report' },
  ])('excludes automated delivery metadata without inspecting wording', payload => {
    expect(parseGmailMessage({ id: 'bounce', threadId: 'thread', internalDate: '1000000', labelIds: ['INBOX'], snippet: 'Thanks', payload }).automated).toBe(true);
  });
});

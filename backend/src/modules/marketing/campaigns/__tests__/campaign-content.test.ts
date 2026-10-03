import { describe, expect, it } from 'vitest';
import { CampaignDraftSchema, CampaignSendSchema, CreateAudienceSchema, renderEmailVariables } from '@leadcrm/shared';
import { renderCampaignMessage, sanitizeCampaignHtml } from '../campaign-content';
import { classifyRecipients } from '../audiences.service';

describe('campaign validation and rendering', () => {
  it('removes executable HTML, forms, SVG and unsafe links', () => {
    const html = sanitizeCampaignHtml('<p onclick="bad()">Hi</p><script>bad()</script><svg onload="bad()"></svg><iframe src="x"></iframe><object>x</object><embed src="x"><form><input></form><a href="javascript:bad()">Click</a><img src="x" onerror="bad()">');
    expect(html).not.toMatch(/script|iframe|object|embed|form|input|onclick|onerror|svg|javascript:/i);
    expect(html).toContain('<p>Hi</p>');
  });
  it('escapes personalized HTML and does not resolve unknown properties', () => {
    const message = renderCampaignMessage('Hello {{first_name}}', '<p>{{first_name}} {{constructor}} {{__proto__}} {{user.password}}</p>', { first_name: '<img src=x onerror=alert(1)>' });
    expect(message.html).toContain('&lt;img');
    expect(message.html).not.toContain('<img');
    expect(renderEmailVariables('{{constructor}} {{user.password}}', {})).toBe(' ');
  });
  it('rejects subject injection, whitespace names and foreign request keys', () => {
    for (const subject of ['Hello\r\nBcc: attacker@example.com', 'Hello\n']) expect(CampaignDraftSchema.safeParse({ name: 'Campaign', type: 'EMAIL', subject }).success).toBe(false);
    expect(CampaignDraftSchema.safeParse({ name: '  ', type: 'EMAIL' }).success).toBe(false);
    expect(CampaignDraftSchema.safeParse({ name: 'OK', type: 'EMAIL', tenantId: 'other' }).success).toBe(false);
  });
  it('accepts incomplete drafts but requires send fields', () => {
    expect(CampaignDraftSchema.safeParse({ name: 'Draft', type: 'EMAIL' }).success).toBe(true);
    expect(CampaignSendSchema.safeParse({ name: 'Draft', type: 'EMAIL' }).success).toBe(false);
  });
  it('whitelists audience fields, operators and typed values', () => {
    const condition = { field: 'createdAt', operator: 'gte', value: '2026-02-30' };
    expect(CreateAudienceSchema.safeParse({ name: 'Test', source: 'ALL', conditions: [condition] }).success).toBe(false);
    expect(CreateAudienceSchema.safeParse({ name: 'Test', source: 'ALL', conditions: [{ ...condition, field: '__proto__' }] }).success).toBe(false);
    expect(CreateAudienceSchema.safeParse({ name: 'Test', source: 'ALL', conditions: [{ field: 'status', operator: 'equals', value: 'FAKE' }] }).success).toBe(false);
  });
  it('deduplicates emails and excludes staff, invalid, missing, suppressed and Sandbox addresses', () => {
    const records = ['Customer@example.com', 'CUSTOMER@example.com', ' staff@camxian.com ', 'bad', null, 'optout@example.com', 'blocked@example.com', 'outside@example.com'].map(email => ({ email, reason: null, personalization: {} }));
    const result = classifyRecipients(records, new Set(['staff@camxian.com']), new Map([['optout@example.com', 'UNSUBSCRIBED'], ['blocked@example.com', 'BLOCKED']]), new Set(['customer@example.com']));
    expect(result.breakdown).toMatchObject({ matched: 8, eligible: 1, duplicateEmail: 1, staffEmail: 1, invalidEmail: 1, missingEmail: 1, unsubscribed: 1, blocked: 1, recipientNotAllowed: 1 });
  });
});

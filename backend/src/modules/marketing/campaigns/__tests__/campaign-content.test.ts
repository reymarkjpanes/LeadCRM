import { describe, expect, it } from 'vitest';
import { CampaignDraftSchema, CampaignSendSchema, CreateAudienceSchema, renderEmailVariables } from '@leadcrm/shared';
import { prepareCampaignHtml, renderCampaignMessage, sanitizeCampaignHtml } from '../campaign-content';
import { classifyRecipients } from '../audiences.service';

describe('campaign validation and rendering', () => {
  it('persists the screenshot URL as an anchor and keeps it intact across draft edits and sending', () => {
    const body = 'hi click this link if you have any inquiries of our products:\nhttps://camxian.com/product-services/';
    const prepared = prepareCampaignHtml(body);
    expect(prepared).toBe('hi click this link if you have any inquiries of our products:<br><a href="https://camxian.com/product-services/">https://camxian.com/product-services/</a>');
    const edited = prepareCampaignHtml(prepared);
    const message = renderCampaignMessage('Welcome {{first_name}}', edited, { first_name: 'Shaun' });
    expect(message.subject).toBe('Welcome Shaun');
    expect(message.html).toContain('<a href="https://camxian.com/product-services/">https://camxian.com/product-services/</a>');
    expect(message.html.match(/<a(?: |>)/g)).toHaveLength(1);
  });
  it.each([
    'https://camxian.com/', 'http://sub.camxian.com/products',
    'https://camxian.com/products?id=123&filter=a%20b#inquiry',
    'https://camxian.com/contact#inquiry', 'https://camxian.com/a_(b)',
  ])('generates a real anchor for %s without changing its destination', url => {
    const message = renderCampaignMessage('Test', `Before (${url}).\nAfter {{first_name}}`, { first_name: 'John' });
    expect(message.html).toContain(`<a href="${url.replaceAll('&', '&amp;')}">${url.replaceAll('&', '&amp;')}</a>`);
    expect(message.html).toContain(').<br>After John');
  });
  it('preserves existing anchors, entities, variables and line breaks through a saved draft', () => {
    const draft = sanitizeCampaignHtml('Hi {{first_name}}\n<a href="https://camxian.com/?a=1&amp;b=2">Visit https://camxian.com/</a>\nhttps://camxian.com/?a=1&b=2');
    const message = renderCampaignMessage('Test', draft, { first_name: 'A & B' });
    expect(message.html.match(/<a(?: |>)/g)).toHaveLength(2);
    expect(message.html).toContain('Hi A &amp; B<br>');
    expect(message.html).toContain('href="https://camxian.com/?a=1&amp;b=2"');
    expect(message.html).not.toContain('&amp;amp;');
    expect(message.html).toContain('Visit https://camxian.com/</a>');
  });
  it('escapes text injection and ignores unsafe schemes while linkifying sanitized text', () => {
    const message = renderCampaignMessage('Test', '<img src="https://camxian.com/image" onerror="bad()"><a href="javascript:alert(1)">Unsafe</a>\nhttps://camxian.com/?x=%3Cscript%3E', {});
    expect(message.html).not.toMatch(/onerror|javascript:/);
    expect(message.html.match(/<a(?: |>)/g)).toHaveLength(2);
    expect(message.html).toContain('href="https://camxian.com/?x=%3Cscript%3E"');
  });
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

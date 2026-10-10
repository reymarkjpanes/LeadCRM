import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFinalSms, smsMessageStats } from '@leadcrm/shared';
import { tenantContext } from '../../../core/tenant/tenant-context';
vi.mock('../../../config/database.config', () => ({ default: { tenant: { findUnique: vi.fn() } } }));
import prisma from '../../../config/database.config';
import { isSmsConfigured, normalizeSmsPhone, sendSms } from '../sms.service';
const batchId = '66f7c3a8b1c2d3e4f5a6b7c0';
const accepted = () => new Response(JSON.stringify({ data: { success: true, smsBatchId: batchId, recipientCount: 1 } }));
const send = (body = 'Hello') => tenantContext.run({ tenantId: 'test-tenant' }, () => sendSms('+639171234567', body));
beforeEach(() => {
  vi.stubEnv('TEXTBEE_API_KEY', 'fixture-key'); vi.stubEnv('TEXTBEE_DEVICE_ID', '');
  vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ email: 'info@example.test' } as never);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => accepted()));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('TextBee shared SMS transport', () => {
  it('normalizes local and international PH numbers and blocks invalid numbers before HTTP', async () => {
    for (const input of ['9123456789', '09123456789', '+639123456789']) expect(normalizeSmsPhone(input)).toBe('+639123456789');
    for (const input of ['0917123456', '+631234567890', 'letters', '']) await expect(tenantContext.run({ tenantId: 'test-tenant' }, () => sendSms(input, 'Hello'))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires an API key and validates explicit devices while allowing the default device', async () => {
    expect(isSmsConfigured()).toBe(true);
    vi.stubEnv('TEXTBEE_API_KEY', ''); await expect(send()).rejects.toThrow(/Configure/);
    vi.stubEnv('TEXTBEE_API_KEY', 'fixture-key'); vi.stubEnv('TEXTBEE_DEVICE_ID', 'invalid');
    await expect(send()).rejects.toThrow(/Device ID/); expect(fetch).not.toHaveBeenCalled();
  });
  it('submits once with x-api-key, one E164 recipient, optional device and the fixed Camxian footer', async () => {
    expect(await send()).toEqual({ submitted: true, messageId: batchId, status: 'pending' });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'fixture-key' });
    expect(JSON.parse(String(init?.body))).toEqual({ recipients: ['+639171234567'], message: 'Hello\n\nFor inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.' });
    vi.stubEnv('TEXTBEE_DEVICE_ID', '664a9b8cd0e1f2a3b4c5d6e7'); await send();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).deviceId).toBe('664a9b8cd0e1f2a3b4c5d6e7');
  });
  it('does not require organization email for SMS and enforces the application size bound before HTTP', async () => {
    vi.mocked(prisma.tenant.findUnique).mockClear();
    await expect(send()).resolves.toMatchObject({ submitted: true });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    vi.mocked(fetch).mockClear();
    await expect(send('a'.repeat(50000))).rejects.toThrow('50000-character'); expect(fetch).not.toHaveBeenCalled();
  });
  it('personalizes allowed variables and appends the mandatory footer exactly once', () => {
    const input = { body: '  Hi {{first_name}}, your proposal is ready.  ', variables: { first_name: 'John' } };
    const final = buildFinalSms(input);
    expect(final).toBe('Hi John, your proposal is ready.\n\nFor inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.');
    expect(buildFinalSms({ ...input, body: final })).toBe(final);
    const legacy = 'Hi John, your proposal is ready.\n\nFor inquiries regarding our products and services, contact Camxian Technologies:\ninfo@example.test\n\nThis is a no-reply message.';
    expect(buildFinalSms({ ...input, body: legacy })).toBe(final);
    expect(buildFinalSms({ ...input, body: '{{__proto__}} {{process.env.KEY}}' })).not.toContain('{{');
  });
  it('counts GSM extension and Unicode multipart segments without truncating content', async () => {
    expect(smsMessageStats('a'.repeat(160))).toMatchObject({ segments: 1, encoding: 'GSM-7' });
    expect(smsMessageStats('a'.repeat(161))).toMatchObject({ segments: 2 });
    expect(smsMessageStats('^'.repeat(81))).toMatchObject({ characters: 81, segments: 2 });
    expect(smsMessageStats('界'.repeat(71))).toMatchObject({ segments: 2, encoding: 'Unicode' });
    expect(smsMessageStats('😀'.repeat(36))).toMatchObject({ characters: 36, segments: 2 });
    await send('a'.repeat(800));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).message).toContain('a'.repeat(800));
  });
  it.each([400, 401, 403, 404, 422, 429])('sanitizes HTTP %s and never retries rejected sends', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response('private provider body', { status }));
    await expect(send()).rejects.toMatchObject({ outcome: 'rejected', httpStatus: status }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('marks malformed receipts, server errors and network ambiguity unconfirmed without retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{"data":{"successCount":1,"failureCount":0}}')).mockResolvedValueOnce(new Response('private', { status: 500 })).mockResolvedValueOnce(new Response('private', { status: 408 })).mockRejectedValueOnce(new Error('private secret'));
    for (let i = 0; i < 5; i++) await expect(send()).rejects.toMatchObject({ outcome: 'unconfirmed', message: 'SMS submission could not be confirmed. Review the provider history before sending again.' });
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});

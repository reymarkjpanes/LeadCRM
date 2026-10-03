import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSmsConfigured, normalizeSmsPhone, sendSms } from '../sms.service';

beforeEach(() => {
  vi.stubEnv('BREVO_API_KEY', 'test-only');
  vi.stubEnv('BREVO_SMS_SENDER', 'LeadCRM');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('transactional SMS transport', () => {
  it('normalizes international numbers and refuses ambiguous local numbers', () => {
    expect(normalizeSmsPhone('+63 (917) 123-4567')).toBe('+639171234567');
    expect(() => normalizeSmsPhone('09171234567')).toThrow(/country code/);
  });
  it('requires configuration before making a request', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    expect(isSmsConfigured()).toBe(false);
    await expect(sendSms('+639171234567', 'Hello')).rejects.toThrow(/Configure/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('submits exactly once and records the provider receipt', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ messageId: 123 }), { status: 201 }));
    expect(await sendSms('+639171234567', 'Hello')).toEqual({ submitted: true, messageId: '123' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ sender: 'LeadCRM', recipient: '+639171234567', content: 'Hello', type: 'transactional' });
  });
  it('retains acceptance if the receipt is unreadable and never retries an uncertain request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 201 }));
    expect(await sendSms('+639171234567', 'Hello')).toEqual({ submitted: true, messageId: null });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('provider secret'));
    await expect(sendSms('+639171234567', 'Hello')).rejects.toThrow('SMS submission could not be confirmed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('reports provider rejection without exposing its response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('provider secret', { status: 400 }));
    await expect(sendSms('+639171234567', 'Hello')).rejects.toThrow('SMS provider rejected');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

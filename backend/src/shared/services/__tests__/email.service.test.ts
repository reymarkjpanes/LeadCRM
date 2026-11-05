import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMail, buildPasswordResetEmail, buildWelcomeEmail } from '../email.service';
import { sanitizeCampaignHtml } from '../../../modules/marketing/campaigns/campaign-content';
import { verifyWebhookAuthorization, BrevoEventSchema, processBrevoEvent } from '../../../modules/marketing/campaigns/brevo-webhook';
import prisma from '../../../config/database.config';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BREVO_API_KEY', 'xkeysib-test-secret-123456789');
  vi.stubEnv('BREVO_FROM_EMAIL', 'sender@example.com'); vi.stubEnv('BREVO_FROM_NAME', 'Test Sender');
  vi.stubEnv('APP_URL', 'https://lead-crm.tech');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ messageId: '<message-1>' }), { status: 201 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('existing Brevo transport', () => {
  it.each(['unrecognised IP address', 'unrecognized IP address', 'IP address is not authorized'])('explains a blocked server IP (%s) without retaining provider content', async reason => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const privateValue = `${process.env.BREVO_API_KEY} customer@example.com private-message`;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unauthorized', message: `Request from ${reason}. ${privateValue}` }), { status: 401 }));
    const error = await sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' }).catch(error => error);
    expect(error).toMatchObject({ outcome: 'rejected', httpStatus: 401, providerCode: 'BREVO_IP_NOT_AUTHORIZED' });
    expect(error.providerMessage).toContain('authorize the production server IP');
    expect(JSON.stringify(error)).not.toContain(privateValue);
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateValue);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each([401, 403])('explains authentication/access HTTP %s without exposing the response', async status => {
    fetchMock.mockResolvedValueOnce(new Response('invalid api key: private-key', { status }));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).rejects.toMatchObject({
      outcome: 'rejected', providerCode: 'BREVO_AUTH_REJECTED', providerMessage: expect.stringContaining('API key and Brevo account access'),
    });
  });
  it('bounds rejection inspection and preserves rejection when the body cannot be read', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(4096) + ' unrecognised IP address', { status: 401 }));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).rejects.toMatchObject({ providerCode: 'BREVO_AUTH_REJECTED' });
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error('private transport details')); } }), { status: 401 }));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).rejects.toMatchObject({ outcome: 'rejected', providerCode: 'BREVO_AUTH_REJECTED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('retains a rate-limit retry deadline and treats server failures as unconfirmed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
    const before = Date.now();
    const error = await sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' }).catch(error => error);
    expect(error).toMatchObject({ outcome: 'rejected', httpStatus: 429 });
    expect(error.retryAfterAt).toBeGreaterThanOrEqual(before + 120000);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).rejects.toMatchObject({ outcome: 'unconfirmed', httpStatus: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('tags password recovery so its receipts do not retry against campaign tracking', async () => {
    await sendMail({ to: 'staff@example.com', subject: 'Reset', html: 'Reset', requireDelivery: true, category: 'password-reset' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tags).toEqual(['leadcrm-password-reset']);
  });
  it.each([{ tags: ['leadcrm-password-reset'] }, { tag: '["leadcrm-password-reset"]' }])('acknowledges explicitly tagged reset receipts without database access (%j)', async tags => {
    const lookup = vi.spyOn(prisma.emailDeliveryLog, 'findFirst');
    await expect(processBrevoEvent({ event: 'delivered', email: 'staff@example.com', 'message-id': 'reset-message', ...tags })).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([{}, { tag: 'malformed' }, { tags: ['campaign'] }, { tags: ['prefix-leadcrm-password-reset'] }])('retains retry behavior for unclassified campaign receipts (%j)', async tags => {
    const lookup = vi.spyOn(prisma.emailDeliveryLog, 'findFirst').mockResolvedValue(null);
    await expect(processBrevoEvent({ event: 'delivered', email: 'staff@example.com', 'message-id': 'pending-campaign', ...tags })).rejects.toMatchObject({ statusCode: 503 });
    expect(lookup).toHaveBeenCalledOnce();
  });
  it.each(['', 'invalid JSON', 'null', '{}'])('retains HTTP 201 acceptance with an unusable tracking response (%s)', async body => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 201 }));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).resolves.toEqual({ submitted: true, messageId: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('distinguishes an HTTP rejection from a network result that needs review', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).rejects.toMatchObject({ outcome: 'rejected', httpStatus: 401 });
    fetchMock.mockRejectedValueOnce(new TypeError('network failure'));
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hi', html: 'Hi' })).rejects.toMatchObject({ outcome: 'unconfirmed' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('posts the configured sender, recipient, subject and sanitized body and returns messageId', async () => {
    const html = sanitizeCampaignHtml('<p onclick="bad()">Hello</p><script>bad()</script>');
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hello', html })).resolves.toEqual({ messageId: '<message-1>', submitted: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.method).toBe('POST');
    expect(options.headers['api-key']).toBe(process.env.BREVO_API_KEY);
    expect(JSON.parse(options.body)).toEqual({ sender: { email: 'sender@example.com', name: 'Test Sender' }, to: [{ email: 'customer@example.com' }], subject: 'Hello', htmlContent: '<p>Hello</p>' });
  });
  it('does not expose or log provider response secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => process.env.BREVO_API_KEY });
    await expect(sendMail({ to: 'customer@example.com', subject: 'Hello', html: 'Hi' })).rejects.toMatchObject({ statusCode: 502 });
    expect(JSON.stringify(log.mock.calls)).not.toContain(process.env.BREVO_API_KEY);
  });
  it('requires campaign configuration and reports no fake submission in development', async () => {
    vi.stubEnv('BREVO_API_KEY', ''); vi.stubEnv('NODE_ENV', 'development');
    await expect(sendMail({ to: 'a@example.com', subject: 'Hi', html: 'Hi', requireDelivery: true })).rejects.toMatchObject({ statusCode: 503 });
    await expect(sendMail({ to: 'a@example.com', subject: 'Hi', html: 'Hi' })).resolves.toEqual({ messageId: null, submitted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['password reset', () => buildPasswordResetEmail('https://lead-crm.tech/reset-password?token=test')],
    ['welcome', () => buildWelcomeEmail('Juan', 'Workspace')],
    ['administrative reset', () => buildPasswordResetEmail('https://lead-crm.tech/reset-password?token=admin')],
  ])('preserves the %s builder and transport contract', async (_name, build) => {
    const html = build();
    expect(html).toContain('<html');
    await sendMail({ to: 'staff@camxian.com', subject: 'Account email', html });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).htmlContent).toBe(html);
  });
  it('authenticates webhooks and rejects unexpected event types', () => {
    vi.stubEnv('BREVO_WEBHOOK_TOKEN', 'test-token-with-at-least-32-characters');
    expect(() => verifyWebhookAuthorization('Bearer wrong')).toThrow();
    expect(() => verifyWebhookAuthorization(`Bearer ${process.env.BREVO_WEBHOOK_TOKEN}`)).not.toThrow();
    expect(BrevoEventSchema.safeParse({ event: 'delete-user', email: 'a@example.com', 'message-id': '1' }).success).toBe(false);
  });
});

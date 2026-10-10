import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import prisma from '../../../config/database.config';
import { hashPassword, comparePassword } from '../../../shared/helpers/crypto';
import { hashResetToken } from '../password-reset.service';
import app from '../../../app';

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(database.hostname) && database.pathname === '/leadcrm_forms_test_2';
const realFetch = globalThis.fetch;
const provider = vi.fn();
let server: Server, base: string, tenantId: string, sequence = 0;
async function call(path: string, body: unknown, cookie = '') {
  const res = await realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json(), cookie: res.headers.getSetCookie().find(c => c.startsWith('leadcrm_token='))?.split(';')[0] ?? '' };
}
async function account(patch = {}) {
  return prisma.user.create({ data: { tenantId, email: `recovery-${++sequence}@camxian.com`, firstName: 'Recovery', lastName: 'Test', role: 'Sales',
    passwordHash: await hashPassword('Previous1!'), mustChangePassword: false, onboardingCompletedAt: new Date(), ...patch } });
}
function linkToken() {
  const payload = JSON.parse(provider.mock.lastCall![1].body);
  return payload.htmlContent.match(/reset-password\?token=([a-f0-9]{64})/)![1] as string;
}
describe.skipIf(!disposable).sequential('password recovery over HTTP on disposable native PostgreSQL', () => {
  beforeAll(async () => {
    vi.stubEnv('APP_URL', 'https://lead-crm.tech'); vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', '25');
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-disposable-recovery-provider'); vi.stubEnv('BREVO_FROM_EMAIL', 'sender@example.com');
    vi.stubEnv('BREVO_SANDBOX_EMAILS', ''); vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'false');
    vi.stubGlobal('fetch', vi.fn((url, init) => String(url) === 'https://api.brevo.com/v3/smtp/email' ? provider(url, init) : realFetch(url, init)));
    tenantId = (await prisma.tenant.create({ data: { name: 'Recovery test', slug: 'recovery-tests', status: 'ACTIVE' } })).id;
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(done => server.once('listening', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  });
  beforeEach(() => { provider.mockReset(); provider.mockResolvedValue(new Response('{"messageId":"test-recovery"}', { status: 201 })); });
  afterAll(async () => { await new Promise<void>(done => server?.close(() => done())); await prisma.$disconnect(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('A: unknown address returns only approved ACCOUNT_NOT_FOUND and creates no token or email', async () => {
    const before = await prisma.passwordResetToken.count();
    expect(await call('/auth/forgot-password', { email: 'unknown-recovery@example.com' })).toMatchObject({ status: 404,
      body: { success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'No account exists with this email address.' } } });
    expect(await prisma.passwordResetToken.count()).toBe(before); expect(provider).not.toHaveBeenCalled();
  });
  it('B/D/J: normalizes email, accepts provider submission, resets password, revokes sessions and audits safely', async () => {
    const user = await account();
    const session = await call('/auth/login', { email: user.email, password: 'Previous1!' });
    expect(session.status).toBe(200);
    expect(await call('/auth/forgot-password', { email: `  ${user.email.toUpperCase()}  ` })).toMatchObject({ status: 200,
      body: { success: true, expiresInMinutes: 25, resendAfterSeconds: 60 } });
    const token = linkToken();
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.token).toBe(hashResetToken(token)); expect(stored.submissionStatus).toBe('ACCEPTED');
    expect(Math.round((stored.expires.getTime() - stored.createdAt.getTime()) / 60_000)).toBe(25);
    expect(JSON.parse(provider.mock.lastCall![1].body).htmlContent).toContain('This link expires in 25 minutes.');
    expect((await call('/auth/reset-password', { token, password: 'Recovered1!' })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await comparePassword('Recovered1!', updated.passwordHash!)).toBe(true);
    expect((await call('/auth/login', { email: user.email, password: 'Previous1!' })).status).toBe(401);
    expect((await call('/auth/login', { email: user.email, password: 'Recovered1!' })).status).toBe(200);
    expect((await call('/auth/reset-password', { token, password: 'Another1!' })).status).toBe(400);
    const audits = await prisma.auditLog.findMany({ where: { userId: user.id, action: 'PASSWORD_RESET' } });
    expect(audits).toHaveLength(1); expect(JSON.stringify(audits)).not.toContain(token); expect(JSON.stringify(audits)).not.toContain('Recovered1!');
  });
  it('C: invalid input or arbitrary tenant selection starts no recovery', async () => {
    expect((await call('/auth/forgot-password', { email: 'invalid' })).status).toBe(400);
    expect((await call('/auth/forgot-password', { email: 'valid@camxian.com', tenantId })).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([{ status: 'INACTIVE' }, { status: 'PENDING' }, { role: 'Guest', status: 'INACTIVE' }, { email: 'restricted@gmail.com' }])('E: conceals ineligible account state %j', async patch => {
    const user = await account(patch);
    const response = await call('/auth/forgot-password', { email: user.email });
    expect(response.status).toBe(200); expect(Object.keys(response.body).sort()).toEqual(['expiresInMinutes', 'message', 'resendAfterSeconds', 'success']);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0); expect(provider).not.toHaveBeenCalled();
  });
  it('E: denies suspended workspaces and ambiguous cross-tenant identities without disclosure', async () => {
    const other = await prisma.tenant.create({ data: { name: 'Suspended test', slug: 'suspended-recovery', status: 'SUSPENDED' } });
    const suspended = await account({ tenantId: other.id });
    expect((await call('/auth/forgot-password', { email: suspended.email })).status).toBe(200);
    const duplicate = await account(); await account({ tenantId: other.id, email: duplicate.email });
    expect((await call('/auth/forgot-password', { email: duplicate.email })).status).toBe(200);
    expect(provider).not.toHaveBeenCalled();
  });
  it('F/H: definite provider rejection has safe error, removes the failed token, and permits manual retry', async () => {
    const user = await account(); provider.mockResolvedValueOnce(new Response('provider-secret', { status: 401 }));
    const failed = await call('/auth/forgot-password', { email: user.email });
    expect(failed).toMatchObject({ status: 502, body: { error: { code: 'PASSWORD_RESET_EMAIL_FAILED', message: 'Unable to send the password reset email. Please try again later.' } } });
    expect(JSON.stringify(failed.body)).not.toContain('provider-secret'); expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
    expect((await call('/auth/forgot-password', { email: user.email })).status).toBe(200); expect(provider).toHaveBeenCalledTimes(2);
  });
  it('F/H: unconfirmed submission is retained and blocks further sends until expiry', async () => {
    const user = await account(); provider.mockRejectedValueOnce(new DOMException('provider-secret', 'TimeoutError'));
    const failed = await call('/auth/forgot-password', { email: user.email });
    expect(failed).toMatchObject({ status: 502, body: { error: { code: 'PASSWORD_RESET_SUBMISSION_UNCONFIRMED' } } });
    expect(failed.body.error.retryAt).toBeTruthy();
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.submissionStatus).toBe('UNCONFIRMED');
    expect((await call('/auth/forgot-password', { email: user.email })).status).toBe(502); expect(provider).toHaveBeenCalledOnce();
    await prisma.passwordResetToken.update({ where: { id: stored.id }, data: { expires: new Date(Date.now() - 1000) } });
    expect((await call('/auth/forgot-password', { email: user.email })).status).toBe(200); expect(provider).toHaveBeenCalledTimes(2);
  });
  it('G/H: concurrent requests send once; resend after cooldown replaces the link', async () => {
    const user = await account();
    await Promise.all([call('/auth/forgot-password', { email: user.email }), call('/auth/forgot-password', { email: user.email })]);
    expect(provider).toHaveBeenCalledOnce(); const original = linkToken();
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.passwordResetToken.update({ where: { id: stored.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    expect((await call('/auth/forgot-password', { email: user.email })).status).toBe(200); expect(provider).toHaveBeenCalledTimes(2);
    expect((await call('/auth/reset-password', { token: original, password: 'Changed1!' })).status).toBe(400);
  });
  it('I/J: concurrent consumption succeeds once; expiry, reuse, weak password and deactivation cannot bypass reset rules', async () => {
    const user = await account(); await call('/auth/forgot-password', { email: user.email }); const token = linkToken();
    expect((await call('/auth/reset-password', { token, password: 'Previous1!' })).body.error.code).toBe('PASSWORD_REUSE');
    expect((await call('/auth/reset-password', { token, password: 'weak' })).status).toBe(400);
    const responses = await Promise.all([call('/auth/reset-password', { token, password: 'Updated1!' }), call('/auth/reset-password', { token, password: 'Another1!' })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    await call('/auth/forgot-password', { email: user.email }); const expired = linkToken();
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expires: new Date(Date.now() - 1000) } });
    expect((await call('/auth/reset-password', { token: expired, password: 'Changed1!' })).status).toBe(400);
    await call('/auth/forgot-password', { email: user.email }); const restricted = linkToken();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    expect((await call('/auth/reset-password', { token: restricted, password: 'Changed1!' })).body.error.code).toBe('INVALID_RESET_TOKEN');
  }, 20_000);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', async () => ({ default: (await import('../../../core/auth/__tests__/auth-test-db')).db }));
import { db, resetDb, user } from '../../../core/auth/__tests__/auth-test-db';
import { requestPasswordReset, hashResetToken } from '../../../core/auth/password-reset.service';
const fetchMock = vi.fn();
beforeEach(() => {
  resetDb(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BREVO_API_KEY', 'xkeysib-account-regression-test-key');
  vi.stubEnv('BREVO_FROM_EMAIL', 'sender@example.com');
  vi.stubEnv('APP_URL', 'https://lead-crm.tech');
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: '<account-message>' }) });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('account flows using the existing Brevo transport', () => {
  it.each([false, true])('sends password recovery (administrative target: %s)', async targeted => {
    await requestPasswordReset({ email: user.email }, targeted ? { userId: user.id, tenantId: user.tenantId } : undefined);
    expect(db.passwordResetToken.create).toHaveBeenCalled();
    const delivery = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(delivery.subject).toBe('Reset your LeadCRM password');
    expect(delivery.to).toEqual([{ email: user.email }]);
    expect(delivery.htmlContent).toContain(`Hi ${user.firstName},`);
    const created = db.passwordResetToken.create.mock.calls[0][0].data;
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.userId).toBe(user.id);
    const rawToken = delivery.htmlContent.match(/reset-password\?token=([a-f0-9]{64})/)?.[1];
    expect(rawToken).toBeTruthy();
    expect(created.token).toBe(hashResetToken(rawToken!));
    expect(created.token).not.toBe(rawToken);
    if (targeted) expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: user.email, mode: 'insensitive' }, id: user.id, tenantId: user.tenantId } }));
  });
  it('keeps actual expiry aligned with the configured email notice', async () => {
    vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', '25');
    const before = Date.now();
    await requestPasswordReset({ email: user.email });
    const expires = db.passwordResetToken.create.mock.calls[0][0].data.expires.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 25 * 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 25 * 60_000);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).htmlContent).toContain('This link expires in 25 minutes.');
  });
  it('does not invalidate tokens when public link configuration is invalid', async () => {
    vi.stubEnv('APP_URL', 'https://lead-crm.tech/unsafe-path');
    await expect(requestPasswordReset({ email: user.email })).rejects.toThrow(/APP_URL/);
    expect(db.passwordResetToken.deleteMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

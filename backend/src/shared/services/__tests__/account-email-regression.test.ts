import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', async () => ({ default: (await import('../../../core/auth/__tests__/auth-test-db')).db }));
import { db, resetDb, user } from '../../../core/auth/__tests__/auth-test-db';
import { requestPasswordReset } from '../../../core/auth/password-reset.service';
const fetchMock = vi.fn();
beforeEach(() => {
  resetDb(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('BREVO_API_KEY', 'xkeysib-account-regression-test-key');
  vi.stubEnv('BREVO_FROM_EMAIL', 'sender@example.com');
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: '<account-message>' }) });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('account flows using the existing Brevo transport', () => {
  it.each([false, true])('sends password recovery (administrative target: %s)', async targeted => {
    await requestPasswordReset({ email: user.email }, targeted ? { userId: user.id, tenantId: user.tenantId } : undefined);
    expect(db.passwordResetToken.create).toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toBe('Reset your LeadCRM password');
    if (targeted) expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: user.email, id: user.id, tenantId: user.tenantId } }));
  });
});

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProfileEmailChangeSchema } from '@leadcrm/shared';

const mocks = vi.hoisted(() => ({
  randomInt: vi.fn(), sendMail: vi.fn(), available: vi.fn(), password: vi.fn(),
  db: { user: { findFirst: vi.fn() }, session: { findFirst: vi.fn() },
    userPreference: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock('node:crypto', async original => ({ ...await original<object>(), randomInt: mocks.randomInt }));
vi.mock('../../../config/database.config', () => ({ default: mocks.db }));
vi.mock('../../../modules/administration/users/users.repository', () => ({ findUserByEmail: mocks.available }));
vi.mock('../../../shared/helpers/crypto', () => ({ comparePassword: mocks.password }));
vi.mock('../../../shared/services/email.service', () => ({ sendMail: mocks.sendMail }));
vi.mock('../auth-transaction', () => ({ authTransaction: (work: (tx: unknown) => Promise<unknown>) => work(mocks.db) }));

import { requestProfileEmailChange } from '../profile-email.service';

const actor = { userId: 'admin', tenantId: 'tenant', sessionId: 'session' };
const input = { email: 'new@example.test', currentPassword: 'current password' };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T13:00:00Z'));
  vi.stubEnv('JWT_SECRET', 'profile-email-test-secret'); vi.stubEnv('APP_URL', 'https://lead-crm.tech');
  mocks.db.user.findFirst.mockResolvedValue({ id: actor.userId, role: 'Client Admin', email: 'old@camxian.com', passwordHash: 'hash', mustChangePassword: false });
  mocks.db.session.findFirst.mockResolvedValue({ id: actor.sessionId });
  mocks.db.userPreference.findUnique.mockResolvedValue(null);
  mocks.password.mockResolvedValue(true); mocks.available.mockResolvedValue(null);
  mocks.sendMail.mockResolvedValue({ submitted: true, messageId: 'fixture' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it.each([[42, '000042'], [999999, '999999']])('generates %i as %s and persists only a context-bound keyed hash', async (value, code) => {
  mocks.randomInt.mockReturnValue(value);
  await requestProfileEmailChange(actor, input);
  expect(mocks.randomInt).toHaveBeenCalledExactlyOnceWith(0, 1_000_000);
  expect(mocks.sendMail.mock.calls[0][0].html).toContain(`<strong>${code}</strong>`);
  const stored = mocks.db.userPreference.upsert.mock.calls[0][0].create.value;
  const expected = createHmac('sha256', 'profile-email-test-secret').update('leadcrm:profile-email-change:v1:')
    .update(JSON.stringify([actor.tenantId, actor.userId, code])).digest('hex');
  expect(stored.codeHash).toBe(expected);
  expect(stored.codeHash).not.toBe(createHash('sha256').update(String(code)).digest('hex'));
  expect(stored).toMatchObject({ failedAttempts: 0, issuedAt: Date.now(), expiresAt: Date.now() + 15 * 60_000, sessionId: actor.sessionId });
  expect(JSON.stringify(stored)).not.toContain(String(code));
});

it('draws another code if a resend would repeat the previous code', async () => {
  mocks.randomInt.mockReturnValueOnce(42).mockReturnValueOnce(42).mockReturnValueOnce(43);
  await requestProfileEmailChange(actor, input);
  const previous = mocks.db.userPreference.upsert.mock.calls[0][0].create.value;
  mocks.db.userPreference.findUnique.mockResolvedValue({ value: previous, updatedAt: new Date() });
  vi.setSystemTime(new Date(Date.now() + 61_000));
  await requestProfileEmailChange(actor, input);
  expect(mocks.randomInt).toHaveBeenCalledTimes(3);
  expect(mocks.sendMail.mock.calls[1][0].html).toContain('<strong>000043</strong>');
});

it('fails closed without a server secret and never stores or submits a code', async () => {
  vi.stubEnv('JWT_SECRET', ''); mocks.randomInt.mockReturnValue(42);
  await expect(requestProfileEmailChange(actor, input)).rejects.toMatchObject({ statusCode: 503 });
  expect(mocks.db.userPreference.upsert).not.toHaveBeenCalled();
  expect(mocks.sendMail).not.toHaveBeenCalled();
});

it('validates the shared six-digit string contract without losing leading zeros', () => {
  expect(ConfirmProfileEmailChangeSchema.parse({ code: ' 000042 ' })).toEqual({ code: '000042' });
  for (const code of ['', '12345', '1234567', '12345a', '１２３４５６', 'A'.repeat(32), 123456]) {
    expect(ConfirmProfileEmailChangeSchema.safeParse({ code }).success).toBe(false);
  }
});

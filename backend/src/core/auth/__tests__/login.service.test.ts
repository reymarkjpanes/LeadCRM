import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', async () => ({
  default: (await import('./auth-test-db')).db,
}));
vi.mock('../../../shared/helpers/crypto', () => ({
  comparePassword: vi.fn(), hashPassword: vi.fn(),
}));
vi.mock('../session.service', () => ({ createSession: vi.fn(), revokeSession: vi.fn() }));
vi.mock('../jwt.service', () => ({ signToken: vi.fn().mockReturnValue('server-only-token') }));
import { db, user, resetDb } from './auth-test-db';
import { loginUser } from '../auth.service';

it.each(['Guest', 'GUEST', ' guest '])('rejects legacy %s login even with a valid employee email/password', async role => {
  user.role = role;
  vi.mocked(comparePassword).mockResolvedValue(true);
  await expect(loginUser({ email: user.email, password: 'secret' })).rejects.toHaveProperty('code', 'ROLE_RETIRED');
  expect(signToken).not.toHaveBeenCalled();
});
import { readAuthUser } from '../auth-user';
import { login } from '../auth.controller';
import { comparePassword } from '../../../shared/helpers/crypto';
import { signToken } from '../jwt.service';
import { createSession } from '../session.service';

beforeEach(() => {
  resetDb();
  vi.mocked(signToken).mockReturnValue('server-only-token');
  vi.stubEnv('NODE_ENV', 'production');
  vi.mocked(comparePassword).mockResolvedValue(true);
});
it('login and session restore return the same Sales onboarding state', async () => {
  const result = await loginUser({ email: user.email, password: 'secret' });
  expect(result.user).toEqual(await readAuthUser(user.id, user.tenantId));
  expect(result.user).toMatchObject({
    role: 'Sales', onboardingStep: 0, onboardingCompletedAt: null, isTenantOwner: true,
  });
  expect(createSession).toHaveBeenCalledOnce();
});
it.each(['missing', 'passwordless', 'wrong-password'])('rejects %s without issuing a session', async mode => {
  if (mode === 'missing') db.user.findMany.mockResolvedValue([]);
  if (mode === 'passwordless') db.user.findMany.mockResolvedValue([{ ...user, passwordHash: null }]);
  if (mode === 'wrong-password') vi.mocked(comparePassword).mockResolvedValue(false);
  await expect(loginUser({ email: user.email, password: 'incorrect' }))
    .rejects.toMatchObject({ statusCode: 401 });
  expect(createSession).not.toHaveBeenCalled();
});
it.each([
  { status: 'PENDING', emailVerified: null },
  { status: 'INACTIVE', emailVerified: new Date() },
])('blocks ineligible accounts even with dev bypass flags', async override => {
  vi.stubEnv('DEV_OTP_BYPASS', 'true');
  Object.assign(user, override);
  await expect(loginUser({ email: user.email, password: 'secret' }))
    .rejects.toMatchObject({ statusCode: 403 });
});
it('keeps the backend token in its HttpOnly cookie, outside the browser JSON response', async () => {
  const req = { body: { email: user.email, password: 'secret' }, headers: {}, ip: '127.0.0.1' };
  const res = { setHeader: vi.fn(), cookie: vi.fn(), json: vi.fn() };
  await login(req as never, res as never, vi.fn());
  expect(res.cookie).toHaveBeenCalledWith('leadcrm_token', expect.any(String),
    expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }));
  expect(res.json.mock.calls[0][0].data).not.toHaveProperty('token');
  expect(res.json.mock.calls[0][0].data.user).not.toHaveProperty('passwordHash');
});

it.each(['employee@example.com', 'employee@camxian.com.attacker.test', 'employee@sub.camxian.com'])('rejects external Client Admin email %s server-side', async email => {
  user.role = 'Client Admin'; user.email = email;
  await expect(loginUser({ email, password: 'secret' })).rejects.toHaveProperty('code', 'EMPLOYEE_ACCOUNT_REQUIRED');
  expect(createSession).not.toHaveBeenCalled();
});
it('accepts an unverified internally provisioned employee without OTP and returns the password gate', async () => {
  user.role = 'Client Admin'; user.email = 'employee@camxian.com'; user.emailVerified = null as never; user.mustChangePassword = true;
  const result = await loginUser({ email: 'EMPLOYEE@CAMXIAN.COM', password: 'secret' });
  expect(result.user.mustChangePassword).toBe(true);
  expect(createSession).toHaveBeenCalledOnce();
});

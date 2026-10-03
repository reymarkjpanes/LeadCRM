import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../core/auth/auth-user', () => ({ readAuthUser: vi.fn() }));
vi.mock('../../../core/auth/session.service', () => ({ validateSession: vi.fn() }));
vi.mock('../../../config/app.config', () => ({ appConfig: { jwtSecret: 'test-only-secret' } }));
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../auth.middleware';
import { readAuthUser } from '../../../core/auth/auth-user';
import { validateSession } from '../../../core/auth/session.service';
import { appConfig } from '../../../config/app.config';

const claims = { userId: 'user-1', tenantId: 'tenant-1', role: 'Client Admin' };
it('rejects an existing session after its current database role is retired', async () => {
  vi.mocked(readAuthUser).mockResolvedValue({ role: 'Guest', email: 'staff@camxian.com', status: 'ACTIVE' } as never);
  const next = vi.fn();
  await authMiddleware(request() as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ROLE_RETIRED' }));
});
const request = () => ({
  cookies: { leadcrm_token: jwt.sign(claims, appConfig.jwtSecret) }, headers: {},
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(validateSession).mockResolvedValue(claims);
  vi.mocked(readAuthUser).mockResolvedValue({
    id: 'user-1', tenantId: 'tenant-1', role: 'Sales', status: 'ACTIVE',
    email: 'owner@camxian.com',
  } as never);
});
it('uses the current database role instead of a stale Client Admin JWT role', async () => {
  const req = request();
  const next = vi.fn();
  await authMiddleware(req as never, {} as never, next);
  expect(req).toHaveProperty('user.role', 'Sales');
  expect(req).toHaveProperty('authUser.id', 'user-1');
  expect(next).toHaveBeenCalledWith();
});
it('does not disguise database failures as unauthenticated sessions', async () => {
  const error = new Error('database unavailable');
  vi.mocked(readAuthUser).mockRejectedValue(error);
  const next = vi.fn();
  await authMiddleware(request() as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(error);
});
it('rejects a session whose tenant differs from its signed identity', async () => {
  vi.mocked(validateSession).mockResolvedValue({ ...claims, tenantId: 'another-tenant' });
  const next = vi.fn();
  await authMiddleware(request() as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  expect(readAuthUser).not.toHaveBeenCalled();
});
it('rejects forged tokens before session lookup', async () => {
  const next = vi.fn();
  await authMiddleware({ cookies: { leadcrm_token: 'forged' }, headers: {} } as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  expect(validateSession).not.toHaveBeenCalled();
});

it.each(['/api/v1/crm', '/api/v1/administration', '/api/v1/preferences', '/api/v1/billing'])('blocks temporary-password sessions at %s', async baseUrl => {
  vi.mocked(readAuthUser).mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'Client Admin', status: 'ACTIVE', email: 'employee@camxian.com', mustChangePassword: true } as never);
  const next = vi.fn();
  await authMiddleware({ ...request(), baseUrl, path: '/anything' } as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
});
it.each(['/me', '/change-password'])('permits only required recovery actions: %s', async path => {
  vi.mocked(readAuthUser).mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'Client Admin', status: 'ACTIVE', email: 'employee@camxian.com', mustChangePassword: true } as never);
  const next = vi.fn();
  await authMiddleware({ ...request(), baseUrl: '/api/v1/auth', path } as never, {} as never, next);
  expect(next).toHaveBeenCalledWith();
});
it('does not allow the onboarding endpoint to bypass a temporary password', async () => {
  vi.mocked(readAuthUser).mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', role: 'Client Admin', status: 'ACTIVE', email: 'employee@camxian.com', mustChangePassword: true } as never);
  const next = vi.fn();
  await authMiddleware({ ...request(), baseUrl: '/api/v1/auth', path: '/onboarding/complete' } as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
});
it('blocks CRM access until persisted onboarding is complete', async () => {
  vi.mocked(readAuthUser).mockResolvedValue({ role: 'Client Admin', status: 'ACTIVE', email: 'employee@camxian.com', mustChangePassword: false, onboardingCompletedAt: null } as never);
  const next = vi.fn();
  await authMiddleware({ ...request(), baseUrl: '/api/v1/crm', path: '/leads' } as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'ONBOARDING_REQUIRED' }));
});
it('rejects an external employee account even with an existing signed session', async () => {
  vi.mocked(readAuthUser).mockResolvedValue({ role: 'Client Admin', status: 'ACTIVE', email: 'employee@example.com' } as never);
  const next = vi.fn();
  await authMiddleware(request() as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMPLOYEE_ACCOUNT_REQUIRED' }));
});


it('returns Authentication required for a genuinely signed-out request', async () => {
  const next = vi.fn();
  await authMiddleware({ cookies: {}, headers: {} } as never, {} as never, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: 'Authentication required' }));
  expect(validateSession).not.toHaveBeenCalled();
});

import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: {
    mailboxOAuthState: { findUnique: vi.fn(), deleteMany: vi.fn() },
    session: { findUnique: vi.fn() },
    emailAccount: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  readUser: vi.fn(), permission: vi.fn(), exchange: vi.fn(), info: vi.fn(),
}));
vi.mock('../../config/database.config', () => ({ default: state.db }));
vi.mock('../../core/auth/auth-user', () => ({ readAuthUser: state.readUser }));
vi.mock('../../core/auth/session.service', () => ({ hashToken: (value: string) => value }));
vi.mock('../../core/permissions/permission.service', () => ({ assertPermissions: state.permission }));
vi.mock('../../core/encryption/crypto.service', () => ({ encryptToken: (value: string) => value, decryptToken: (value: string) => value }));
vi.mock('../../core/audit/audit.service', () => ({ writeAuditLog: vi.fn() }));
vi.mock('./gmail.oauth', () => ({ getAuthorizationUrl: vi.fn(), exchangeCodeForTokens: state.exchange, getUserInfo: state.info }));

import { finishMailboxConnection } from './mailbox-auth.service';
import { AppError } from '../../shared/errors/app-error';

const user = () => ({ id: 'u', tenantId: 't', email: 'staff@camxian.com', role: 'Sales', status: 'ACTIVE',
  tenantStatus: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: '2026-01-01' });
beforeEach(() => {
  vi.resetAllMocks();
  state.db.mailboxOAuthState.findUnique.mockResolvedValue({ userId: 'u', tenantId: 't', sessionHash: 'session', verifier: 'verifier', expiresAt: new Date(Date.now() + 60000) });
  state.db.mailboxOAuthState.deleteMany.mockResolvedValue({ count: 1 });
  state.db.session.findUnique.mockResolvedValue({ userId: 'u', tenantId: 't', revokedAt: null, expiresAt: new Date(Date.now() + 60000) });
  state.readUser.mockResolvedValue(user());
  state.db.emailAccount.findUnique.mockResolvedValue(null);
  state.exchange.mockResolvedValue({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify' });
  state.info.mockResolvedValue({ email: 'staff@camxian.com' });
});

it.each(['leads.view', 'contacts.view'])('completes OAuth for a staff member with only %s', async permission => {
  state.permission.mockImplementation(async (_actor, required) => {
    if (!required.includes(permission)) throw new AppError('Access denied', 403);
  });
  await finishMailboxConnection('state', 'code');
  expect(state.exchange).toHaveBeenCalledWith('code', 'verifier');
  expect(state.db.emailAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: 't', userId: 'u', email: 'staff@camxian.com' }) }));
});

it('denies a staff member with no CRM visibility before exchanging provider tokens', async () => {
  state.permission.mockRejectedValue(new AppError('Access denied', 403));
  await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 403 });
  expect(state.exchange).not.toHaveBeenCalled();
});

it.each(['SUSPENDED', 'CANCELLED', 'DELETED', 'REJECTED', null, undefined])('denies unavailable workspace %s before contacting Google', async tenantStatus => {
  state.readUser.mockResolvedValue({ ...user(), tenantStatus });
  await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 403 });
  expect(state.permission).not.toHaveBeenCalled();
  expect(state.exchange).not.toHaveBeenCalled();
  expect(state.db.emailAccount.upsert).not.toHaveBeenCalled();
});

it('propagates permission database failures without attempting a second permission', async () => {
  const failure = new Error('database unavailable');
  state.permission.mockRejectedValue(failure);
  await expect(finishMailboxConnection('state', 'code')).rejects.toBe(failure);
  expect(state.permission).toHaveBeenCalledOnce();
  expect(state.exchange).not.toHaveBeenCalled();
});

it('retains session revocation and one-time OAuth state guards', async () => {
  state.db.session.findUnique.mockResolvedValue({ userId: 'u', tenantId: 't', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 401 });
  state.db.mailboxOAuthState.deleteMany.mockResolvedValue({ count: 0 });
  await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 400 });
  expect(state.exchange).not.toHaveBeenCalled();
});

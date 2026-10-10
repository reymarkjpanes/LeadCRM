import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMailboxTestOverride, isMailboxOwner } from './mailbox-ownership';
import { getConnectionStatus, getValidAccessToken } from './gmail.service';
import { beginMailboxConnection, finishMailboxConnection } from './mailbox-auth.service';

const mocks = vi.hoisted(() => ({
  config: { gmail: { testMailboxOverride: '' } },
  account: { findUnique: vi.fn(), upsert: vi.fn() },
  state: { deleteMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  session: { findUnique: vi.fn() },
  readUser: vi.fn(), decrypt: vi.fn(), exchange: vi.fn(), info: vi.fn(), refresh: vi.fn(), audit: vi.fn(), authorize: vi.fn(),
}));
vi.mock('../../config/mail.config', () => ({ mailConfig: mocks.config }));
vi.mock('../../config/database.config', () => ({ default: { emailAccount: mocks.account, mailboxOAuthState: mocks.state, session: mocks.session } }));
vi.mock('../../core/auth/auth-user', () => ({ readAuthUser: mocks.readUser }));
vi.mock('../../core/encryption/crypto.service', () => ({ decryptToken: mocks.decrypt, encryptToken: (value: string) => `encrypted:${value}` }));
vi.mock('../../core/permissions/permission.service', () => ({ assertPermissions: vi.fn() }));
vi.mock('../../core/audit/audit.service', () => ({ writeAuditLog: mocks.audit }));
vi.mock('./gmail.oauth', () => ({ getAuthorizationUrl: mocks.authorize, exchangeCodeForTokens: mocks.exchange, getUserInfo: mocks.info, refreshAccessToken: mocks.refresh }));

const user = { userId: '00000000-0000-4000-8000-000000000001', tenantId: '00000000-0000-4000-8000-000000000002', email: 'tester@camxian.com' };
const entry = { userId: user.userId, tenantId: user.tenantId, staffEmail: user.email, mailboxEmail: 'tester@gmail.com', startsAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-08T00:00:00.000Z' };
const account = { id: 'account', isActive: true, email: entry.mailboxEmail, accessToken: 'encrypted:test', refreshToken: 'encrypted:refresh', tokenExpiresAt: new Date('2026-10-07'), connectedAt: new Date('2026-10-01'), lastSyncAt: null };
const configure = (value: unknown) => { mocks.config.gmail.testMailboxOverride = JSON.stringify(value); };

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02'));
  configure(entry);
  mocks.readUser.mockResolvedValue({ ...user, id: user.userId, role: 'Sales', status: 'ACTIVE', tenantStatus: 'ACTIVE', mustChangePassword: false, onboardingCompletedAt: new Date() });
  mocks.account.findUnique.mockResolvedValue(account);
  mocks.decrypt.mockReturnValue('test-token');
  mocks.state.deleteMany.mockResolvedValue({ count: 1 });
  mocks.state.findUnique.mockResolvedValue({ ...user, expiresAt: new Date('2026-10-03'), verifier: 'encrypted:verifier', sessionHash: 'session' });
  mocks.session.findUnique.mockResolvedValue({ ...user, expiresAt: new Date('2026-10-03'), revokedAt: null });
  mocks.exchange.mockResolvedValue({ access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.modify' });
  mocks.info.mockResolvedValue({ email: entry.mailboxEmail });
});
afterEach(() => vi.useRealTimers());

describe('temporary mailbox ownership exception', () => {
  it('accepts only the exact configured staff, tenant and normalized mailbox', () => {
    expect(isMailboxOwner(user, ' TESTER@gmail.com ')).toBe(true);
    expect(isMailboxOwner(user, 'someone-else@gmail.com')).toBe(false);
    expect(isMailboxOwner({ ...user, userId: entry.tenantId }, entry.mailboxEmail)).toBe(false);
    expect(isMailboxOwner({ ...user, tenantId: entry.userId }, entry.mailboxEmail)).toBe(false);
    expect(isMailboxOwner({ ...user, email: 'other@camxian.com' }, entry.mailboxEmail)).toBe(false);
  });
  it.each(['', '{', 'null', '[]', '{}'])('fails closed for invalid configuration %s', raw => {
    mocks.config.gmail.testMailboxOverride = raw;
    expect(isMailboxOwner(user, entry.mailboxEmail)).toBe(false);
    expect(isMailboxOwner(user, ' TESTER@CAMXIAN.COM ')).toBe(true);
  });
  it.each([
    { expiresAt: '2026-10-09T00:00:00.000Z' }, { startsAt: '2026-10-03T00:00:00.000Z' },
    { expiresAt: '2026-10-02T00:00:00.000Z' }, { expiresAt: 'invalid' }, { mailboxEmail: '*' }, { tenantId: '*' },
  ])('rejects invalid or inactive exception %j', changes => {
    configure({ ...entry, ...changes }); expect(getMailboxTestOverride(user)).toBeNull();
  });
  it('uses the approved mailbox only as the bound staff login hint', async () => {
    await beginMailboxConnection(user, 'session');
    expect(mocks.authorize).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), entry.mailboxEmail);
    await beginMailboxConnection({ ...user, userId: entry.tenantId }, 'session');
    expect(mocks.authorize).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), user.email);
  });
  it('accepts the approved callback, encrypts tokens and audits expiry', async () => {
    await finishMailboxConnection('opaque-state', 'test-code');
    expect(mocks.account.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ email: entry.mailboxEmail, accessToken: 'encrypted:new-token', refreshToken: 'encrypted:new-refresh' }) }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ after: { email: entry.mailboxEmail, access: 'temporary-test', expiresAt: entry.expiresAt } }));
  });
  it('still rejects an unrelated Google mailbox in the callback', async () => {
    mocks.info.mockResolvedValue({ email: 'another@gmail.com' });
    await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.account.upsert).not.toHaveBeenCalled();
  });
  it('does not replace historical messages from a different mailbox', async () => {
    mocks.account.findUnique.mockResolvedValue({ ...account, email: user.email });
    await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.account.upsert).not.toHaveBeenCalled();
  });
  it('does not bypass employee-domain login restrictions', async () => {
    mocks.readUser.mockResolvedValue({ ...user, email: 'personal@gmail.com', role: 'Sales', status: 'ACTIVE' });
    await expect(finishMailboxConnection('state', 'code')).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it('allows active test access and returns only safe status fields', async () => {
    expect(await getValidAccessToken(user.tenantId, user.userId)).toBe('test-token');
    expect(await getConnectionStatus(user.tenantId, user.userId)).toEqual({ isConnected: true, email: entry.mailboxEmail, connectedAt: account.connectedAt.toISOString(), lastSyncAt: null, syncError: null, retryAt: null });
  });
  it('blocks expired access before decrypting or refreshing any provider token', async () => {
    vi.setSystemTime(new Date(entry.expiresAt));
    await expect(getValidAccessToken(user.tenantId, user.userId)).rejects.toMatchObject({ statusCode: 403 });
    expect((await getConnectionStatus(user.tenantId, user.userId)).isConnected).toBe(false);
    expect(mocks.decrypt).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('removing the exception revokes test access without altering history', async () => {
    mocks.config.gmail.testMailboxOverride = '';
    await expect(getValidAccessToken(user.tenantId, user.userId)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.account.upsert).not.toHaveBeenCalled();
  });
});

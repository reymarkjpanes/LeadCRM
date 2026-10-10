import { randomBytes } from 'node:crypto';
import prisma from '../../config/database.config';
import { hashToken } from '../../core/auth/session.service';
import { readAuthUser } from '../../core/auth/auth-user';
import { assertPermissions } from '../../core/permissions/permission.service';
import { requireEmployeeAccount } from '../../core/auth/account-access';
import { encryptToken, decryptToken } from '../../core/encryption/crypto.service';
import { writeAuditLog } from '../../core/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { getAuthorizationUrl, exchangeCodeForTokens, getUserInfo } from './gmail.oauth';
import { normalizeEmail } from './engagement-rules';
import { isOnboardingComplete, isWorkspaceAccessible } from '@leadcrm/shared';
import { getMailboxTestOverride, isMailboxOwner } from './mailbox-ownership';

export async function beginMailboxConnection(user: { userId: string; tenantId: string; email: string }, sessionToken: string) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const url = getAuthorizationUrl(state, verifier, getMailboxTestOverride(user)?.mailboxEmail ?? user.email);
  await prisma.mailboxOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.mailboxOAuthState.create({ data: { stateHash: hashToken(state), userId: user.userId, tenantId: user.tenantId,
    sessionHash: hashToken(sessionToken), verifier: encryptToken(verifier), expiresAt: new Date(Date.now() + 600000) } });
  return { url };
}

export async function finishMailboxConnection(state: string, code: string) {
  const stateHash = hashToken(state);
  const challenge = await prisma.mailboxOAuthState.findUnique({ where: { stateHash } });
  if (!challenge || challenge.expiresAt <= new Date()) throw new AppError('This connection request expired. Start again from Messages.', 400);
  // Atomic consumption prevents callback replay, even across backend replicas.
  if (!(await prisma.mailboxOAuthState.deleteMany({ where: { stateHash, expiresAt: { gt: new Date() } } })).count) throw new AppError('Connection request already used.', 400);
  const { userId, tenantId } = challenge;
  const session = await prisma.session.findUnique({ where: { tokenHash: challenge.sessionHash } });
  if (!session || session.userId !== userId || session.tenantId !== tenantId || session.revokedAt || session.expiresAt <= new Date()) throw new AppError('Sign in again before connecting email.', 401);
  const user = await readAuthUser(userId, tenantId);
  requireEmployeeAccount(user);
  if (user.status !== 'ACTIVE' || user.mustChangePassword || !isWorkspaceAccessible(user.tenantStatus) || !isOnboardingComplete(user)) throw new AppError('Workspace access is unavailable.', 403);
  const identityPermissions = { userId, tenantId, role: user.role };
  try { await assertPermissions(identityPermissions, ['leads.view']); }
  catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 403) throw error;
    await assertPermissions(identityPermissions, ['contacts.view']);
  }
  const tokens = await exchangeCodeForTokens(code, decryptToken(challenge.verifier));
  const info = await getUserInfo(tokens.access_token);
  const identity = { userId, tenantId, email: user.email };
  if (!isMailboxOwner(identity, info.email)) throw new AppError('Select your staff work email or the exact mailbox approved for temporary testing.', 400);
  if (!tokens.scope.split(' ').includes('https://www.googleapis.com/auth/gmail.modify')) throw new AppError('Gmail permission was not granted. Reconnect and allow the requested mailbox access.', 400);
  const existing = await prisma.emailAccount.findUnique({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } } });
  if (existing && normalizeEmail(existing.email) !== normalizeEmail(info.email)) throw new AppError('This mailbox has historical messages under a different address. Ask your administrator to resolve the account association.', 409);
  const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing?.refreshToken;
  if (!refreshToken) throw new AppError('Offline Gmail access is required. Reconnect and approve access.', 400);
  const data = { email: normalizeEmail(info.email), accessToken: encryptToken(tokens.access_token), refreshToken,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), scopes: tokens.scope.split(' '), isActive: true, syncError: null,
    syncRequestedAt: new Date(), syncRetryAt: null };
  await prisma.emailAccount.upsert({ where: { tenantId_userId_provider: { tenantId, userId, provider: 'gmail' } },
    create: { tenantId, userId, provider: 'gmail', ...data }, update: data });
  const testOverride = normalizeEmail(info.email) !== normalizeEmail(user.email) ? getMailboxTestOverride(identity) : null;
  await writeAuditLog({ tenantId, userId, action: 'integration.gmail_connected', entityType: 'EmailAccount', entityId: existing?.id ?? userId,
    after: { email: info.email, ...(testOverride ? { access: 'temporary-test', expiresAt: testOverride.expiresAt } : {}) } });
}

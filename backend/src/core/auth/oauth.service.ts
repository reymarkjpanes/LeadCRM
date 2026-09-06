import prisma from '../../config/database.config';
import { randomUUID } from 'crypto';
import { AppError } from '../../shared/errors/app-error';
import { signToken } from './jwt.service';
import { createSession } from './session.service';
import { writeAuditLog } from '../audit/audit.service';



const JWT_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Input / output types ────────────────────────────────────────────────────

export interface OAuthProfileDto {
  /** The stable subject identifier from the provider (e.g. Google sub claim) */
  providerAccountId: string;
  provider: 'google';
  email: string;
  firstName: string;
  lastName: string;
  /** Provider-supplied avatar URL — stored but never blindly rendered */
  avatarUrl?: string;
  /** Whether the provider has verified ownership of this email address */
  emailVerified: boolean;
  /** Raw OIDC id_token for auditing */
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Access token expiry as Unix epoch seconds (from provider) */
  expiresAtEpoch?: number;
  scope?: string;
}

export interface OAuthSessionContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface OAuthAuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    avatarUrl: string | null;
  };
  /** True when the account was just created — frontend may redirect to complete-profile */
  isNewUser: boolean;
  /** True when required profile fields (companyName etc.) are still missing */
  requiresProfileCompletion: boolean;
}

// ─── Core service function ───────────────────────────────────────────────────

/**
 * findOrCreateUserByOAuth
 *
 * Security model:
 *  1. Look up by (provider, providerAccountId) — the stable, unforgeable identifier.
 *  2. If found → update tokens, sign new JWT, create session.
 *  3. If not found → check for an existing User with the same *verified* email.
 *     - Link the OAuth account to that user (prevents duplicate accounts).
 *  4. If no existing user → create Tenant + User + OAuthAccount in a transaction.
 *  5. Always validate tenantId comes from the DB — never from the OAuth profile.
 */
export async function findOrCreateUserByOAuth(
  profile: OAuthProfileDto,
  ctx: OAuthSessionContext = {},
): Promise<OAuthAuthResult> {
  // ── 1. Look up by stable provider identifier ──────────────────────────────
  const existingOAuthAccount = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider:          profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingOAuthAccount) {
    const { user } = existingOAuthAccount;

    if (user.status !== 'ACTIVE') {
      throw new AppError('Account is inactive. Contact your administrator.', 403);
    }

    // Refresh tokens in DB (fire-and-forget — non-blocking)
    prisma.oAuthAccount
      .update({
        where: { id: existingOAuthAccount.id },
        data:  {
          accessToken:  profile.accessToken  ?? existingOAuthAccount.accessToken,
          refreshToken: profile.refreshToken ?? existingOAuthAccount.refreshToken,
          idToken:      profile.idToken      ?? existingOAuthAccount.idToken,
          expiresAt:    profile.expiresAtEpoch
            ? new Date(profile.expiresAtEpoch * 1000)
            : existingOAuthAccount.expiresAt,
          updatedAt: new Date(),
        },
      })
      .catch(() => { /* non-critical — token refresh */ });

    // Update avatarUrl if provider gave us a newer one
    if (profile.avatarUrl && profile.avatarUrl !== user.avatarUrl) {
      prisma.user
        .update({ where: { id: user.id }, data: { avatarUrl: profile.avatarUrl } })
        .catch(() => { /* non-critical */ });
    }

    const token = await issueSession(user, ctx);

    await writeAuditLog({
      tenantId:   user.tenantId,
      userId:     user.id,
      action:     'LOGIN_OAUTH',
      entityType: 'User',
      entityId:   user.id,
      metadata:   { provider: profile.provider },
      ipAddress:  ctx.ipAddress,
    });

    return {
      token,
      user:                    toPublicUser(user),
      isNewUser:               false,
      requiresProfileCompletion: false,
    };
  }

  // ── 2. No OAuth account found — look for existing user by verified email ──
  if (!profile.emailVerified) {
    // Never auto-link unverified email addresses — security risk
    throw new AppError(
      'Google did not verify this email address. Please use a verified Google account.',
      400,
    );
  }

  const existingUser = await prisma.user.findFirst({
    where:   { email: profile.email },
    include: { tenant: { select: { industry: true, companySize: true, name: true } } },
  });

  if (existingUser) {
    if (existingUser.status !== 'ACTIVE') {
      throw new AppError('Account is inactive. Contact your administrator.', 403);
    }

    // Link OAuth account to the existing user
    await prisma.oAuthAccount.create({
      data: {
        id:                randomUUID(),
        userId:            existingUser.id,
        tenantId:          existingUser.tenantId,
        provider:          profile.provider,
        providerAccountId: profile.providerAccountId,
        accessToken:       profile.accessToken  ?? null,
        refreshToken:      profile.refreshToken ?? null,
        idToken:           profile.idToken      ?? null,
        tokenType:         'Bearer',
        scope:             profile.scope        ?? null,
        expiresAt:         profile.expiresAtEpoch
          ? new Date(profile.expiresAtEpoch * 1000)
          : null,
        updatedAt:         new Date(),
      },
    });

    // Update avatar if missing
    if (profile.avatarUrl && !existingUser.avatarUrl) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data:  { avatarUrl: profile.avatarUrl },
      });
    }

    const token = await issueSession(existingUser, ctx);

    await writeAuditLog({
      tenantId:   existingUser.tenantId,
      userId:     existingUser.id,
      action:     'OAUTH_ACCOUNT_LINKED',
      entityType: 'User',
      entityId:   existingUser.id,
      metadata:   { provider: profile.provider },
      ipAddress:  ctx.ipAddress,
    });

    // Seeder / existing accounts already have a fully provisioned tenant.
    // Only ask for profile completion if the tenant is missing required fields.
    const tenant = existingUser.tenant;
    const needsCompletion = !tenant?.industry || !tenant?.companySize;

    return {
      token,
      user:                    toPublicUser(existingUser),
      isNewUser:               false,
      requiresProfileCompletion: needsCompletion,
    };
  }

  // ── 3. Brand-new user — provision Tenant + User + OAuthAccount atomically ─
  const newUserAndToken = await prisma.$transaction(async (tx) => {
    // Build a unique tenant slug from the user's name
    const rawSlug  = `${profile.firstName}-${profile.lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const slug = `${rawSlug}-${Date.now().toString(36)}`;

    const tenant = await tx.tenant.create({
      data: {
        name:               `${profile.firstName} ${profile.lastName}`,
        slug,
        status:             'SANDBOX',
        subscriptionStatus: 'NONE',
        plan:               null,
        onboardingStep:     3,
        onboardingCompletedAt: new Date(),
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId:      tenant.id,
        email:         profile.email,
        firstName:     profile.firstName,
        lastName:      profile.lastName,
        // OAuth-only user — no password. passwordHash is nullable in schema.
        passwordHash:  null,
        avatarUrl:     profile.avatarUrl ?? null,
        emailVerified: profile.emailVerified ? new Date() : null,
        status:        'ACTIVE',
        role:          'Client Admin',
      },
    });

    await tx.oAuthAccount.create({
      data: {
        id:                randomUUID(),
        userId:            user.id,
        tenantId:          tenant.id,
        provider:          profile.provider,
        providerAccountId: profile.providerAccountId,
        accessToken:       profile.accessToken  ?? null,
        refreshToken:      profile.refreshToken ?? null,
        idToken:           profile.idToken      ?? null,
        tokenType:         'Bearer',
        scope:             profile.scope        ?? null,
        expiresAt:         profile.expiresAtEpoch
          ? new Date(profile.expiresAtEpoch * 1000)
          : null,
        updatedAt:         new Date(),
      },
    });

    return user;
  });

  const token = await issueSession(newUserAndToken, ctx);

  await writeAuditLog({
    tenantId:   newUserAndToken.tenantId,
    userId:     newUserAndToken.id,
    action:     'REGISTER_OAUTH',
    entityType: 'User',
    entityId:   newUserAndToken.id,
    metadata:   { provider: profile.provider },
    ipAddress:  ctx.ipAddress,
  });

  return {
    token,
    user:                    toPublicUser(newUserAndToken),
    isNewUser:               true,
    // New OAuth users need to complete company name + other required fields
    requiresProfileCompletion: true,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function issueSession(
  user: { id: string; tenantId: string; role: string; email: string },
  ctx:  OAuthSessionContext,
): Promise<string> {
  const token = signToken({
    userId:   user.id,
    tenantId: user.tenantId,
    role:     user.role,
    email:    user.email,
  });

  await createSession({
    userId:      user.id,
    tenantId:    user.tenantId,
    token,
    userAgent:   ctx.userAgent,
    ipAddress:   ctx.ipAddress,
    expiresInMs: JWT_EXPIRES_MS,
  });

  return token;
}

function toPublicUser(user: {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  avatarUrl: string | null;
  tenant?: { industry: string | null; companySize: string | null; name: string } | null;
}) {
  return {
    id:        user.id,
    email:     user.email,
    role:      user.role,
    firstName: user.firstName,
    lastName:  user.lastName,
    tenantId:  user.tenantId,
    avatarUrl: user.avatarUrl,
  };
}

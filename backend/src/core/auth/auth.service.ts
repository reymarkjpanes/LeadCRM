import prisma from '../../config/database.config';
import crypto from 'crypto';
import { comparePassword, hashPassword } from '../../shared/helpers/crypto';
import { signToken } from './jwt.service';
import { createSession } from './session.service';
import { AppError } from '../../shared/errors/app-error';
import { ConflictError } from '../../shared/errors/http-error';
import { sendMail, buildPasswordResetEmail, buildRegistrationOtpEmail, buildVerificationEmail } from '../../shared/services/email.service';
import type { ForgotPasswordDto, ResetPasswordDto } from './auth.dto';
import { seedSystemRoles } from '../../database/seeders/roles.seed';
import { seedSandboxData } from '../../database/seeders/sandbox.seed';
import { Role } from '../../shared/constants/roles';

/**
 * ROLE STATE INVARIANT (see also rbac.middleware.ts)
 *
 * When assigning or changing a user's role, always update BOTH:
 *   1. User.role (string column) — drives JWT payload and super-role bypass in rbac.middleware.ts
 *   2. UserRole junction row    — drives RolePermission lookup for non-super roles (live DB query)
 * These two must be updated in the same Prisma $transaction.
 *
 * Never update one without the other. A stale User.role in the JWT retains the previous
 * super-role bypass until the user logs out and back in (JWTs are not auto-invalidated
 * on role change — force re-login or revoke the session if immediate effect is required).
 */



// JWT lifetime in milliseconds (must match jwt.service expiresIn)
const JWT_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  tenantId: string;
}

export interface LoginContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Minimal user + flattened tenant fields needed to build the canonical auth
 * user response. Kept intentionally narrow so no sensitive field (e.g.
 * passwordHash) can leak into the payload — see buildAuthUserResponse.
 */
export interface AuthUserSource {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  status?: string;
  emailVerified?: Date | null;
  tenant?: {
    name?: string | null;
    status?: string | null;
    subscriptionStatus?: string | null;
    plan?: string | null;
    industry?: string | null;
    companySize?: string | null;
    currency?: string | null;
    onboardingStep?: number | null;
    onboardingCompletedAt?: Date | null;
  } | null;
}

/**
 * The single canonical auth user shape returned by BOTH POST /auth/login and
 * GET /auth/me. Flattens the tenant relation onto the user object.
 *
 * SECURITY: This helper is the ONLY place the auth user payload is assembled,
 * and it explicitly enumerates every exposed field. It MUST NOT include
 * passwordHash or any other sensitive/credential field.
 */
export interface AuthUserResponse {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  status: string | null;
  emailVerified: Date | null;
  tenantName: string | null;
  tenantStatus: string | null;
  subscriptionStatus: string | null;
  plan: string | null;
  industry: string | null;
  companySize: string | null;
  currency: string | null;
  onboardingStep: number;
  onboardingCompletedAt: Date | null;
}

/**
 * Builds the canonical, flattened auth user response used by both the login
 * and /auth/me contracts so the two payloads are guaranteed identical in shape.
 *
 * Only intended gate/display fields are exposed. No sensitive fields
 * (passwordHash, tokens, secrets) are ever included.
 */
export function buildAuthUserResponse(user: AuthUserSource): AuthUserResponse {
  const tenant = user.tenant ?? null;
  return {
    id:                    user.id,
    email:                 user.email,
    role:                  user.role,
    firstName:             user.firstName,
    lastName:              user.lastName,
    tenantId:              user.tenantId,
    status:                user.status ?? null,
    emailVerified:         user.emailVerified ?? null,
    tenantName:            tenant?.name                 ?? null,
    tenantStatus:          tenant?.status               ?? null,
    subscriptionStatus:    tenant?.subscriptionStatus   ?? null,
    plan:                  tenant?.plan                 ?? null,
    industry:              tenant?.industry             ?? null,
    companySize:           tenant?.companySize          ?? null,
    currency:              tenant?.currency             ?? null,
    onboardingStep:        tenant?.onboardingStep       ?? 0,
    onboardingCompletedAt: tenant?.onboardingCompletedAt ?? null,
  };
}

export async function loginUser(dto: LoginDto, ctx: LoginContext = {}) {
  // Normalise the incoming email so casing differences never cause a lookup
  // failure (e.g. "Admin@Gmail.com" → "admin@gmail.com").
  const normalisedEmail = dto.email.toLowerCase().trim();

  // Fetch ALL rows for this email across tenants, ordered oldest-first so the
  // canonical seeded account is preferred when duplicates exist.
  //
  // Background: the email column is unique per (tenantId, email) pair, not
  // globally unique. A seed refactor previously wrote admin@gmail.com into two
  // different tenants (leadcrm-system-demo and leadcrm-system). A plain
  // findFirst() with no ordering would non-deterministically pick either row,
  // causing "invalid credentials" whenever the stale row came first.
  //
  // The fix: fetch all candidates and find the first whose password hash
  // actually matches the supplied password. This is safe because bcrypt.compare
  // is constant-time — iterating a small list of candidates does not leak
  // timing information about which row matched.
  const candidates = await prisma.user.findMany({
    where: { email: normalisedEmail },
    include: {
      tenant: {
        select: {
          name: true, industry: true, companySize: true, status: true,
          subscriptionStatus: true, plan: true,
          currency: true,
          onboardingStep: true, onboardingCompletedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Generic message — do not reveal whether the email exists.
  if (candidates.length === 0) throw new AppError('Invalid email or password', 401);

  // Find the first candidate whose password hash matches.
  let user: typeof candidates[0] | null = null;
  for (const candidate of candidates) {
    if (!candidate.passwordHash) continue;
    const matches = await comparePassword(dto.password, candidate.passwordHash);
    if (matches) {
      user = candidate;
      break;
    }
  }

  // No candidate matched the password — use a generic 401.
  if (!user) throw new AppError('Invalid email or password', 401);

  // Block unverified users — they must complete email verification first.
  // DEMO/DEV bypass: allowed only in non-production environments.
  // The NODE_ENV check is a hard structural gate — the bypass cannot activate
  // in production even if DEV_OTP_BYPASS or DEMO_MODE is accidentally set.
  const isDevBypassAllowed = process.env.NODE_ENV !== 'production' &&
    (process.env.DEV_OTP_BYPASS === 'true' || process.env.DEMO_MODE === 'true');
  if (!user.emailVerified && !(isDevBypassAllowed && user.status === 'ACTIVE')) {
    throw new AppError(
      'Please verify your email address before logging in. Check your inbox for a verification link, or request a new one.',
      403,
    );
  }

  if (user.status !== 'ACTIVE') {
    throw new AppError('Account is inactive. Contact your administrator.', 403);
  }

  const token = signToken({
    userId:   user.id,
    tenantId: user.tenantId,
    role:     user.role,
    email:    user.email,
  });

  // Persist session for revocation support
  await createSession({
    userId:      user.id,
    tenantId:    user.tenantId,
    token,
    userAgent:   ctx.userAgent,
    ipAddress:   ctx.ipAddress,
    expiresInMs: JWT_EXPIRES_MS,
  });

  return {
    token,
    // Align the login response contract with GET /auth/me by returning the
    // same canonical, flattened shape via the shared helper.
    user: buildAuthUserResponse(user),
  };
}

export async function registerUser(dto: RegisterDto) {
  const existing = await prisma.user.findFirst({
    where: { email: dto.email, tenantId: dto.tenantId },
  });

  if (existing) throw new ConflictError('A user with this email already exists');

  const passwordHash = await hashPassword(dto.password);

  const user = await prisma.user.create({
    data: {
      // tenantId always from system context — never from client body
      tenantId:     dto.tenantId,
      firstName:    dto.firstName,
      lastName:     dto.lastName,
      email:        dto.email,
      passwordHash,
    },
  });

  return { id: user.id, email: user.email, role: user.role };
}

import { ClientAdminRegisterDto, GuestRegisterDto } from './auth.dto';

// ── Verification Token TTL ─────────────────────────────────────────
const EMAIL_VERIFICATION_TOKEN_TTL_MS = parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS ?? '24', 10) * 60 * 60 * 1000;

/**
 * Generates dual verification credentials (magic link token + OTP code).
 * Stores SHA-256 hash of the link token in EmailVerificationToken table.
 * Stores bcrypt hash of the OTP in RegistrationOtpToken table.
 * Returns plaintext values for email composition.
 */
async function generateVerificationCredentials(email: string, userId: string): Promise<{ token: string; otpCode: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Generate magic link token (cryptographically secure)
  const token     = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const linkExpiry = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS);

  // Clean up any previous tokens for this email
  await prisma.emailVerificationToken.deleteMany({ where: { email: normalizedEmail } });

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      email: normalizedEmail,
      tokenHash,
      type: 'EMAIL_VERIFICATION',
      expiresAt: linkExpiry,
    },
  });

  // 2. Generate 6-digit OTP code
  const otpCode   = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash  = await hashPassword(otpCode);
  const otpExpiry = new Date(Date.now() + REG_OTP_TTL_MS);

  await prisma.registrationOtpToken.upsert({
    where:  { email: normalizedEmail },
    update: { codeHash, expires: otpExpiry, attempts: 0 },
    create: { email: normalizedEmail, codeHash, expires: otpExpiry },
  });

  return { token, otpCode };
}

/**
 * Sends the combined verification email (magic link button + OTP code).
 * Returns true if email was sent, false if send failed (non-blocking).
 * Logs prominently on failure so the issue is visible in production logs.
 */
async function sendVerificationEmail(email: string, token: string, otpCode: string): Promise<boolean> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const verificationUrl = `${appUrl}/api/v1/auth/verify-email?token=${token}`;

  try {
    await sendMail({
      to:      email,
      subject: `${otpCode} - Verify your LeadCRM email`,
      html:    buildVerificationEmail(verificationUrl, otpCode),
    });
    // eslint-disable-next-line no-console
    console.info(`[Auth] Verification email sent successfully to ${email}`);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // eslint-disable-next-line no-console
    console.error(
      `[Auth] ⚠️  FAILED to send verification email to ${email}. User is stuck in PENDING status.\n` +
      `[Auth] Error: ${message}\n` +
      `[Auth] Check: GMAIL_SYSTEM_SENDER_USER_ID, ENCRYPTION_KEY, RESEND_API_KEY env vars on Render.`,
    );
    return false;
  }
}

export async function registerClientAdmin(dto: ClientAdminRegisterDto) {
  const normalizedEmail = dto.email.toLowerCase().trim();

  const existingUser = await prisma.user.findFirst({
    where: { email: normalizedEmail },
  });

  if (existingUser) throw new ConflictError('A user with this email already exists');

  const passwordHash = await hashPassword(dto.password);

  // Check for invitation token — if present, join existing tenant
  if (dto.invitationToken) {
    return registerWithInvitation(dto, normalizedEmail, passwordHash, 'Client Admin');
  }

  // At this point, invitationToken is absent, so companyName is guaranteed by Zod superRefine
  const companyName = dto.companyName ?? '';

  // Generate a unique slug for the tenant
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + crypto.randomBytes(3).toString('hex');

  // Create tenant + user in transaction — user starts as PENDING until email verified
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create Tenant — SANDBOX state, no subscription yet (NONE), no plan.
    //    Tenant will be promoted to ACTIVE only after Stripe payment is confirmed via webhook.
    const tenant = await tx.tenant.create({
      data: {
        name: companyName,
        slug,
        industry: dto.industry,
        companySize: dto.companySize,
        status: 'SANDBOX',
        subscriptionStatus: 'NONE', // No subscription until Stripe checkout completes
        plan: null,                  // No plan until payment — never pre-assign a plan
        onboardingStep: 0,
        onboardingCompletedAt: null,
      },
    });

    // 2. Create User as PENDING (will be ACTIVE after email verification).
    //    Role: Restricted User — the sandbox/pre-subscription role.
    //    Promoted to Client Admin ONLY after Stripe checkout.session.completed webhook fires.
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        passwordHash,
        role: Role.RESTRICTED_USER, // Sandbox role — NOT Client Admin until payment confirmed
        status: 'PENDING',
      },
    });

    // 3. Set ownerUserId — immutable after registration, authoritative founding-user reference.
    //    The Stripe webhook uses this to promote the correct user to Client Admin on payment.
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { ownerUserId: user.id },
    });
    await tx.account.create({
      data: {
        tenantId: tenant.id,
        name: companyName,
        industry: dto.industry,
        size: dto.companySize,
        country: dto.country,
      } as never,
    });

    // 4. Seed default pipeline
    await tx.pipeline.create({
      data: {
        tenantId: tenant.id,
        name: 'Sales Pipeline',
        isDefault: true,
        stages: {
          create: [
            { name: 'Lead', order: 1, isDefault: true, tenantId: tenant.id },
            { name: 'Contacted', order: 2, tenantId: tenant.id },
            { name: 'Qualified', order: 3, tenantId: tenant.id },
            { name: 'Won', order: 4, isWon: true, tenantId: tenant.id },
            { name: 'Lost', order: 5, isLost: true, tenantId: tenant.id },
          ],
        },
      },
    });

    return { tenant, user };
  });

  // Seed system roles for the new tenant (idempotent — safe to call here)
  await seedSystemRoles(result.tenant.id).catch((err) => {
    console.error('[Auth] Failed to seed system roles for new tenant:', err instanceof Error ? err.message : err);
    // Non-blocking — registration should still succeed even if role seeding fails
  });

  // Create UserRole junction — ROLE STATE INVARIANT: User.role = Restricted User
  // ↔ UserRole → Restricted User RoleDefinition. Both are in sync from registration.
  // The Stripe webhook promotes this user to Client Admin by updating BOTH transactionally.
  // Tenant safety: role is looked up within the same tenant as the user — never cross-tenant.
  try {
    const restrictedRoleDef = await prisma.roleDefinition.findFirst({
      where: { tenantId: result.tenant.id, name: Role.RESTRICTED_USER },
    });
    if (restrictedRoleDef && restrictedRoleDef.tenantId === result.tenant.id) {
      await prisma.userRole.upsert({
        where: { userId_roleId_tenantId: { userId: result.user.id, roleId: restrictedRoleDef.id, tenantId: result.tenant.id } },
        update: {},
        create: { userId: result.user.id, roleId: restrictedRoleDef.id, tenantId: result.tenant.id },
      });
    }
  } catch (err) {
    console.error('[Auth] Failed to create UserRole for new user (sandbox):', err instanceof Error ? err.message : err);
    // Non-blocking — the user can still log in via the User.role string fallback
  }

  // Generate dual verification tokens (outside transaction — non-blocking on failure)
  const { token, otpCode } = await generateVerificationCredentials(normalizedEmail, result.user.id);
  const emailSent = await sendVerificationEmail(normalizedEmail, token, otpCode);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    tenantId: result.tenant.id,
    emailSent,
  };
}

export async function registerGuest(dto: GuestRegisterDto) {
  const normalizedEmail = dto.email.toLowerCase().trim();

  const existingUser = await prisma.user.findFirst({
    where: { email: normalizedEmail },
  });

  if (existingUser) throw new ConflictError('A user with this email already exists');

  const passwordHash = await hashPassword(dto.password);

  // Check for invitation token — if present, join existing tenant
  if (dto.invitationToken) {
    return registerWithInvitation(dto, normalizedEmail, passwordHash, 'Sales Rep');
  }

  // Guest gets their own sandbox tenant
  const slug = 'sandbox-' + crypto.randomBytes(4).toString('hex');

  const result = await prisma.$transaction(async (tx) => {
    // Tenant — SANDBOX state, no subscription yet (NONE), no plan
    const tenant = await tx.tenant.create({
      data: {
        name: dto.companyName || 'Demo Sandbox',
        slug,
        industry: dto.industry,
        companySize: dto.companySize,
        status: 'SANDBOX',
        subscriptionStatus: 'NONE', // No subscription until Stripe checkout completes
        plan: null,                  // No plan until payment
        onboardingStep: 0,
        onboardingCompletedAt: null,
      },
    });

    // Role: Restricted User — sandbox/pre-subscription role, NOT Client Admin.
    // Promoted to Client Admin ONLY after Stripe checkout.session.completed webhook fires.
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        passwordHash,
        role: Role.RESTRICTED_USER, // Sandbox role — not Client Admin until payment confirmed
        status: 'PENDING',
      },
    });

    // Set ownerUserId — immutable after registration, authoritative founding-user reference.
    // The Stripe webhook uses this to promote the correct user to Client Admin on payment.
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { ownerUserId: user.id },
    });

    await tx.account.create({
      data: {
        tenantId: tenant.id,
        name: dto.companyName || 'Demo Sandbox Org',
      } as never,
    });

    // Seed default pipeline
    await tx.pipeline.create({
      data: {
        tenantId: tenant.id,
        name: 'Sales Pipeline',
        isDefault: true,
        stages: {
          create: [
            { name: 'Lead', order: 1, isDefault: true, tenantId: tenant.id },
            { name: 'Contacted', order: 2, tenantId: tenant.id },
            { name: 'Qualified', order: 3, tenantId: tenant.id },
            { name: 'Won', order: 4, isWon: true, tenantId: tenant.id },
            { name: 'Lost', order: 5, isLost: true, tenantId: tenant.id },
          ],
        },
      },
    });

    return { tenant, user };
  });

  // Seed system roles for the guest's new sandbox tenant
  await seedSystemRoles(result.tenant.id).catch((err) => {
    console.error('[Auth] Failed to seed system roles for guest tenant:', err instanceof Error ? err.message : err);
    // Non-blocking — registration should still succeed even if role seeding fails
  });

  // Create UserRole junction — ROLE STATE INVARIANT: User.role = Restricted User
  // ↔ UserRole → Restricted User RoleDefinition. Tenant safety: same-tenant lookup only.
  try {
    const restrictedRoleDef = await prisma.roleDefinition.findFirst({
      where: { tenantId: result.tenant.id, name: Role.RESTRICTED_USER },
    });
    if (restrictedRoleDef && restrictedRoleDef.tenantId === result.tenant.id) {
      await prisma.userRole.upsert({
        where: { userId_roleId_tenantId: { userId: result.user.id, roleId: restrictedRoleDef.id, tenantId: result.tenant.id } },
        update: {},
        create: { userId: result.user.id, roleId: restrictedRoleDef.id, tenantId: result.tenant.id },
      });
    }
  } catch (err) {
    console.error('[Auth] Failed to create UserRole for guest (sandbox):', err instanceof Error ? err.message : err);
    // Non-blocking — the user can still log in via the User.role string fallback
  }

  // Seed sandbox CRM data atomically — failure propagates to fail registration.
  // This ensures the guest workspace is fully populated on first login.
  // seedSandboxData checks idempotency first (returns early if already seeded).
  await seedSandboxData(result.tenant.id, result.user.id);

  // Generate dual verification tokens
  const { token, otpCode } = await generateVerificationCredentials(normalizedEmail, result.user.id);
  const emailSent = await sendVerificationEmail(normalizedEmail, token, otpCode);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    tenantId: result.tenant.id,
    emailSent,
  };
}

/**
 * Handles registration with an invitation token.
 * Validates the invitation, creates the user in the inviting tenant,
 * marks the invitation as accepted, and sends verification email.
 *
 * Looks up the invitation by SHA-256 hash of the raw token (tokens are
 * stored as tokenHash in TenantInvitation, never as plaintext). The token
 * is the authoritative credential � email alone is not sufficient.
 */
async function registerWithInvitation(
  dto: { firstName: string; lastName: string; email: string; invitationToken?: string },
  normalizedEmail: string,
  passwordHash: string,
  defaultRole: string,
): Promise<{ id: string; email: string; role: string; tenantId: string; emailSent: boolean }> {
  if (!dto.invitationToken) {
    throw new AppError('Invitation token is required.', 400);
  }

  // Hash the raw token before lookup � tokens are stored as SHA-256 hashes (tokenHash), never raw.
  const tokenHash = crypto.createHash('sha256').update(dto.invitationToken).digest('hex');

  const invitation = await prisma.tenantInvitation.findFirst({
    where: { tokenHash },
    include: {
      tenant: { select: { id: true, name: true } },
      role: { select: { id: true, name: true } },
    },
  });

  if (!invitation) {
    throw new AppError('Invalid invitation link. Please request a new one from your administrator.', 400);
  }

  // Validate all terminal states with explicit messages
  if (invitation.revokedAt) {
    throw new AppError('This invitation has been revoked. Please request a new one from your administrator.', 400);
  }

  if (invitation.acceptedAt) {
    throw new AppError('This invitation has already been accepted.', 400);
  }

  if (invitation.expiresAt < new Date()) {
    throw new AppError('This invitation has expired. Please request a new one from your administrator.', 400);
  }

  // Email on the invitation must match the registering email (case-insensitive)
  if (invitation.email.toLowerCase() !== normalizedEmail) {
    throw new AppError('The email address does not match the invitation. Please use the email address the invitation was sent to.', 400);
  }

  const roleName = invitation.role?.name ?? defaultRole;

  const result = await prisma.$transaction(async (tx) => {
    // Create user in the inviting tenant — tenantId always from invitation, never from request body
    const user = await tx.user.create({
      data: {
        tenantId: invitation.tenantId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: normalizedEmail,
        passwordHash,
        role: roleName,
        status: 'PENDING', // Still requires email verification
      },
    });

    // Mark invitation as accepted atomically with user creation
    await tx.tenantInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    return { user, tenant: invitation.tenant };
  });

  // Create UserRole junction for the invited user.
  // Tenant safety: RoleDefinition is looked up within invitation.tenantId only.
  try {
    if (invitation.role?.id && invitation.role.id === invitation.roleId) {
      await prisma.userRole.upsert({
        where: {
          userId_roleId_tenantId: {
            userId: result.user.id,
            roleId: invitation.roleId,
            tenantId: invitation.tenantId,
          },
        },
        update: {},
        create: {
          userId: result.user.id,
          roleId: invitation.roleId,
          tenantId: invitation.tenantId,
        },
      });
    }
  } catch (err) {
    console.error('[Auth] Failed to create UserRole for invited user:', err instanceof Error ? err.message : err);
    // Non-blocking — user can still log in via User.role string fallback
  }

  // Generate dual verification tokens
  const { token, otpCode } = await generateVerificationCredentials(normalizedEmail, result.user.id);
  const emailSent = await sendVerificationEmail(normalizedEmail, token, otpCode);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    tenantId: result.tenant.id,
    emailSent,
  };
}

// ── Registration Email Verification (OTP) ─────────────────────────

const REG_OTP_TTL_MS       = 10 * 60 * 1000; // 10 minutes
const REG_OTP_MAX_ATTEMPTS = 5;

/**
 * Sends a 6-digit verification code to the given email during registration.
 * Does NOT require an existing user account — called before the account is activated.
 */
export async function sendRegistrationOtp(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const code     = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashPassword(code);
  const expires  = new Date(Date.now() + REG_OTP_TTL_MS);

  await prisma.registrationOtpToken.upsert({
    where:  { email: normalizedEmail },
    update: { codeHash, expires, attempts: 0 },
    create: { email: normalizedEmail, codeHash, expires },
  });

  await sendMail({
    to:      normalizedEmail,
    subject: `${code} is your LeadCRM verification code`,
    html:    buildRegistrationOtpEmail(code),
  });
}

/**
 * Verifies a registration OTP code. Returns true on success.
 * Throws AppError on failure (expired, wrong code, too many attempts).
 * Activates the user account upon successful verification.
 */
export async function verifyRegistrationOtp(email: string, code: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  // ── DEMO/DEV bypass: accept "000000" only in non-production environments ──
  // NODE_ENV !== 'production' is a hard structural gate — this branch is
  // unreachable in production even if DEV_OTP_BYPASS or DEMO_MODE is set.
  const isDemoBypass = process.env.NODE_ENV !== 'production' &&
    (process.env.DEV_OTP_BYPASS === 'true' || process.env.DEMO_MODE === 'true');
  if (isDemoBypass && code === '000000') {
    const user = await prisma.user.findFirst({ where: { email: normalizedEmail } });
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerified: new Date() },
      });
    }
    // Clean up any existing token
    await prisma.registrationOtpToken.deleteMany({ where: { email: normalizedEmail } });
    return true;
  }

  const record = await prisma.registrationOtpToken.findUnique({ where: { email: normalizedEmail } });

  if (!record) throw new AppError('No verification code found for this email. Please request a new one.', 400);

  if (record.expires < new Date()) {
    await prisma.registrationOtpToken.delete({ where: { email: normalizedEmail } });
    throw new AppError('Verification code has expired. Please request a new one.', 400);
  }

  if (record.attempts >= REG_OTP_MAX_ATTEMPTS) {
    await prisma.registrationOtpToken.delete({ where: { email: normalizedEmail } });
    throw new AppError('Too many incorrect attempts. Please request a new code.', 429);
  }

  const valid = await comparePassword(code, record.codeHash);
  if (!valid) {
    await prisma.registrationOtpToken.update({
      where: { email: normalizedEmail },
      data:  { attempts: { increment: 1 } },
    });
    const remaining = REG_OTP_MAX_ATTEMPTS - record.attempts - 1;
    throw new AppError(`Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 400);
  }

  // Code verified — activate the user account
  const user = await prisma.user.findFirst({ where: { email: normalizedEmail } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data:  { status: 'ACTIVE', emailVerified: new Date() },
    });
  }

  await prisma.registrationOtpToken.delete({ where: { email: normalizedEmail } });
  return true;
}

// ── Password Reset ────────────────────────────────────────────────
const RESET_TTL_MS = parseInt(process.env.PASSWORD_RESET_TTL_MINUTES ?? '60', 10) * 60 * 1000;

/**
 * Step 1 — Request a password reset.
 * Generates a secure token, stores it in PasswordResetToken, and emails the link.
 * Always returns success to avoid leaking whether an email exists.
 * In development, if SMTP is not configured, logs the reset URL to the console.
 */
export async function requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email: dto.email } });

  // Silently return if user not found — do not reveal email existence
  if (!user) return;

  // Invalidate any previous tokens for this email
  await prisma.passwordResetToken.deleteMany({ where: { email: dto.email } });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires  = new Date(Date.now() + RESET_TTL_MS);

  await prisma.passwordResetToken.create({
    data: { email: dto.email, token: rawToken, expires },
  });

  const appUrl   = process.env.APP_URL ?? 'http://localhost:3000';
  const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

  await sendMail({
    to:      dto.email,
    subject: 'Reset your LeadCRM password',
    html:    buildPasswordResetEmail(resetUrl),
  });
}

/**
 * Step 2 — Confirm the reset using the token and set a new password.
 * Deletes the used token on success.
 */
export async function resetPasswordWithToken(dto: ResetPasswordDto): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token: dto.token },
  });

  if (!record) {
    throw new AppError('Invalid or expired password reset link.', 400);
  }

  if (record.expires < new Date()) {
    await prisma.passwordResetToken.delete({ where: { token: dto.token } });
    throw new AppError('Password reset link has expired. Please request a new one.', 400);
  }

  const user = await prisma.user.findFirst({ where: { email: record.email } });
  if (!user) throw new AppError('User not found.', 404);

  const passwordHash = await hashPassword(dto.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data:  { passwordHash },
    }),
    // Invalidate all sessions so the old password can't be reused
    prisma.session.deleteMany({ where: { userId: user.id } }),
    // Clean up the used token
    prisma.passwordResetToken.delete({ where: { token: dto.token } }),
  ]);
}



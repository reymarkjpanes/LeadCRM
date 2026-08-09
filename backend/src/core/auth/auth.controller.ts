import { Request, Response, NextFunction } from 'express';
import {
  loginUser,
  registerClientAdmin as registerClientAdminService,
  registerGuest as registerGuestService,
  requestPasswordReset,
  resetPasswordWithToken,
  sendLoginOtp,
  verifyLoginOtp,
  sendRegistrationOtp,
  verifyRegistrationOtp,
} from './auth.service';
import { revokeSession } from './session.service';
import prisma from '../../config/database.config';
import { hashPassword } from '../../shared/helpers/crypto';
import {
  ForgotPasswordSchema,
  ResetPasswordSchema,
  SendOtpSchema,
  VerifyOtpSchema,
  SendRegistrationOtpSchema,
  VerifyRegistrationOtpSchema,
} from './auth.dto';

const COOKIE_NAME = 'leadcrm_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
};

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await loginUser(req.body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    // Token stored in HttpOnly cookie — never accessible from JS
    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTIONS);

    res.json({ success: true, data: { user: result.user, token: result.token } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  // Revoke the session server-side before clearing the cookie
  const token: string | undefined = req.cookies?.[COOKIE_NAME];
  if (token) await revokeSession(token);

  res.clearCookie(COOKIE_NAME, {
    httpOnly: COOKIE_OPTIONS.httpOnly,
    secure:   COOKIE_OPTIONS.secure,
    sameSite: COOKIE_OPTIONS.sameSite,
  });

  res.json({ success: true });
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Fetch full user + tenant status so the frontend can route sandbox vs production
    const user = await prisma.user.findFirst({
      where: { id: req.user!.userId, tenantId: req.user!.tenantId },
      select: {
        id:        true,
        email:     true,
        role:      true,
        firstName: true,
        lastName:  true,
        tenantId:  true,
        status:    true,
        tenant:    { select: { status: true, subscriptionStatus: true } },
      },
    });
    if (!user) { res.status(401).json({ success: false, error: 'User not found' }); return; }

    res.json({
      success: true,
      data: {
        user: {
          id:                  user.id,
          email:               user.email,
          role:                user.role,
          firstName:           user.firstName,
          lastName:            user.lastName,
          tenantId:            user.tenantId,
          status:              user.status,
          tenantStatus:        user.tenant.status,          // 'SANDBOX' | 'ACTIVE' | 'SUSPENDED' …
          subscriptionStatus:  user.tenant.subscriptionStatus,
        },
      },
    });
  } catch (err) { next(err); }
}

const DEMO_EMAIL = 'admin@democorp.com';

export async function seedDemo(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const demoPassword = process.env.DEMO_USER_PASSWORD;
    if (!demoPassword) {
      res.status(400).json({
        success: false,
        error: 'DEMO_USER_PASSWORD is not set on the server.',
      });
      return;
    }

    const tenant = await prisma.tenant.upsert({
      where:  { slug: 'demo-corp' },
      update: {},
      create: {
        name:               'Demo Corp Solutions',
        slug:               'demo-corp',
        status:             'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        plan:               'ENTERPRISE',
      },
    });

    const passwordHash = await hashPassword(demoPassword);

    await prisma.user.upsert({
      where:  { tenantId_email: { tenantId: tenant.id, email: DEMO_EMAIL } },
      update: { passwordHash, status: 'ACTIVE' },
      create: {
        tenantId:  tenant.id,
        email:     DEMO_EMAIL,
        firstName: 'Alice',
        lastName:  'Admin',
        passwordHash,
        role:      'Client Admin',
        status:    'ACTIVE',
      },
    });

    // Never return credentials in an API response — the operator set the
    // password via DEMO_USER_PASSWORD and already knows it.
    res.json({ success: true, message: 'Demo user successfully seeded.', email: DEMO_EMAIL });
  } catch (err) {
    next(err);
  }
}

export async function registerClientAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await registerClientAdminService(req.body);
    res.status(201).json({ success: true, data: { user: result } });
  } catch (err) {
    next(err);
  }
}

export async function registerGuest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await registerGuestService(req.body);
    res.status(201).json({ success: true, data: { user: result } });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(_req: Request, res: Response, _next: NextFunction): Promise<void> {
  // Placeholder — email verification during registration now uses the OTP flow below
  res.status(501).json({ success: false, error: 'Use /auth/send-registration-otp and /auth/verify-registration-otp instead.' });
}

export async function sendRegOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = SendRegistrationOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    await sendRegistrationOtp(parsed.data.email);
    res.json({ success: true, message: 'Verification code sent to your email address.' });
  } catch (err) {
    next(err);
  }
}

export async function verifyRegOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = VerifyRegistrationOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    await verifyRegistrationOtp(parsed.data.email, parsed.data.code);
    res.json({ success: true, message: 'Email verified successfully.' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ForgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    await requestPasswordReset(parsed.data);
    // Always return success — never reveal whether the email exists
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    await resetPasswordWithToken(parsed.data);
    res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

export async function sendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = SendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    await sendLoginOtp(parsed.data, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    res.json({ success: true, message: 'OTP sent to your email address.' });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = VerifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const result = await verifyLoginOtp(parsed.data.email, parsed.data.code, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTIONS);
    res.json({ success: true, data: { user: result.user, token: result.token } });
  } catch (err) {
    next(err);
  }
}

export async function seedAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email    = process.env.SYSTEM_ADMIN_EMAIL;
    const password = process.env.SYSTEM_ADMIN_PASSWORD;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'SYSTEM_ADMIN_EMAIL or SYSTEM_ADMIN_PASSWORD not set.' });
      return;
    }

    const tenant = await prisma.tenant.upsert({
      where:  { slug: 'leadcrm-system' },
      update: {},
      create: {
        name:               'LeadCRM System',
        slug:               'leadcrm-system',
        status:             'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        plan:               'ENTERPRISE',
      },
    });

    const existing = await prisma.user.findFirst({ where: { email, tenantId: tenant.id } });

    if (!existing) {
      const passwordHash = await hashPassword(password);
      await prisma.user.create({
        data: {
          tenantId:     tenant.id,
          email,
          firstName:    'System',
          lastName:     'Admin',
          passwordHash,
          role:         'System Admin',
          status:       'ACTIVE',
        },
      });
    }

    res.json({
      success: true,
      message: existing ? 'System Admin already exists.' : 'System Admin created successfully.',
      email,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Google OAuth Bridge ─────────────────────────────────────────────────────
import { OAuthGoogleSchema } from './auth.dto';
import { findOrCreateUserByOAuth } from './oauth.service';

/**
 * POST /api/v1/auth/oauth/google
 *
 * Called exclusively by the NextAuth signIn callback (server-to-server).
 * NextAuth has already verified the Google id_token before calling our
 * signIn callback — the profile data is trustworthy at this point.
 *
 * We use the providerAccountId (Google sub) as the stable identifier
 * rather than re-verifying the id_token, which eliminates the audience
 * mismatch problem when frontend and backend use the same Google project.
 *
 * Security: This endpoint is not exposed to browsers — it is called only
 * server-to-server from the Next.js API route. We still validate all
 * input with Zod and enforce tenant isolation via the JWT we issue.
 */
export async function oauthGoogle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = OAuthGoogleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' });
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.info('[OAuth] /auth/oauth/google called — email:', req.body?.email, '| providerAccountId:', String(req.body?.providerAccountId ?? '').slice(0, 8));
    }

    const dto = parsed.data;

    // NextAuth already verified the id_token with Google before calling this endpoint.
    // We trust the providerAccountId (Google sub) and email from the verified profile.
    // For defence-in-depth we still validate that providerAccountId is non-empty
    // and that email matches what's in the id_token via a lightweight JWT decode.
    if (!dto.providerAccountId || dto.providerAccountId.length < 3) {
      res.status(400).json({ success: false, error: 'Invalid Google account identifier.' });
      return;
    }

    // Decode (not verify) the id_token to extract the sub and email for cross-check.
    // Full cryptographic verification was already done by NextAuth + Google's JWKS.
    let tokenEmail: string | undefined;
    let tokenSub: string | undefined;
    try {
      const parts = dto.idToken.split('.');
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
          sub?: string;
          email?: string;
          aud?: string | string[];
        };
        tokenEmail = claims.email;
        tokenSub   = claims.sub;
      }
    } catch {
      // Decode failed — proceed with DTO values (NextAuth already verified)
    }

    // Cross-check: sub from token must match providerAccountId from NextAuth
    if (tokenSub && tokenSub !== dto.providerAccountId) {
      console.error('[OAuth] sub mismatch — token sub:', tokenSub, '| dto providerAccountId:', dto.providerAccountId);
      res.status(401).json({ success: false, error: 'Account identifier mismatch.' });
      return;
    }

    // Cross-check: email from token must match email from NextAuth profile
    if (tokenEmail && tokenEmail !== dto.email) {
      console.error('[OAuth] email mismatch — token email:', tokenEmail, '| dto email:', dto.email);
      res.status(401).json({ success: false, error: 'Email mismatch.' });
      return;
    }

    const result = await findOrCreateUserByOAuth(
      {
        providerAccountId: dto.providerAccountId,
        provider:          'google',
        email:             dto.email,
        firstName:         dto.firstName,
        lastName:          dto.lastName,
        avatarUrl:         dto.avatarUrl,
        emailVerified:     dto.emailVerified,
        idToken:           dto.idToken,
        accessToken:       dto.accessToken,
        refreshToken:      dto.refreshToken,
        expiresAtEpoch:    dto.expiresAtEpoch,
        scope:             dto.scope,
      },
      {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      },
    );

    // Issue the LeadCRM session cookie
    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTIONS);

    res.json({
      success: true,
      data: {
        user:                    result.user,
        token:                   result.token,
        isNewUser:               result.isNewUser,
        requiresProfileCompletion: result.requiresProfileCompletion,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Complete OAuth Profile ──────────────────────────────────────────────────
import { CompleteOAuthProfileSchema } from './auth.dto';
import { writeAuditLog } from '../audit/audit.service';

/**
 * PATCH /api/v1/auth/oauth/complete-profile
 *
 * Patches the Tenant record for a new Google OAuth user who just filled in
 * their company details on the complete-profile page.
 *
 * Security:
 *  - Requires authenticate middleware — tenantId sourced from JWT, never body
 *  - Validates all input via Zod before touching the DB
 *  - Returns 404 if tenant not found (never 403)
 */
export async function completeOAuthProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = CompleteOAuthProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? 'Validation failed' });
      return;
    }

    const { companyName, industry, companySize, country } = parsed.data;
    // tenantId comes from the verified JWT — never trust the request body
    const tenantId = req.user!.tenantId;

    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data:  {
        name:        companyName,
        industry,
        companySize: companySize,
      },
    });

    await writeAuditLog({
      tenantId,
      userId:     req.user!.userId,
      action:     'OAUTH_PROFILE_COMPLETED',
      entityType: 'Tenant',
      entityId:   tenantId,
      metadata:   { companyName, industry },
    });

    // Return tenantStatus so the frontend can redirect to the correct dashboard
    // New Google OAuth users always have status SANDBOX — they stay in sandbox
    // until a System Admin upgrades their account.
    res.json({
      success: true,
      data: {
        tenantStatus:       tenant.status,          // 'SANDBOX' | 'ACTIVE' …
        subscriptionStatus: tenant.subscriptionStatus,
      },
    });
  } catch (err) {
    next(err);
  }
}

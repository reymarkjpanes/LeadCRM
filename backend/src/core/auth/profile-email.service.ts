import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ConfirmProfileEmailChangeSchema, EmployeeEmailSchema, RequestProfileEmailChangeSchema } from '@leadcrm/shared';
import { z } from 'zod';
import prisma from '../../config/database.config';
import { findUserByEmail } from '../../modules/administration/users/users.repository';
import { AppError } from '../../shared/errors/app-error';
import { comparePassword } from '../../shared/helpers/crypto';
import { sendMail } from '../../shared/services/email.service';
import { buildProfileEmailChangeEmail } from '../../shared/services/auth-email.templates';
import { authTransaction } from './auth-transaction';
import { hashToken } from './session.service';

type Actor = { userId: string; tenantId: string; sessionId: string };
const preferenceKey = ({ userId, tenantId }: Actor) => ({ userId, tenantId, module: 'auth', key: 'profile-email-change' });
const challengeSchema = z.object({
  email: RequestProfileEmailChangeSchema.shape.email,
  previousEmail: z.string(),
  sessionId: z.string(),
  passwordVersion: z.string(),
  codeHash: z.string().regex(/^[a-f\d]{64}$/),
  issuedAt: z.number(),
  failedAttempts: z.number().int().min(0).max(5),
  expiresAt: z.number(),
});
const expiryMs = 15 * 60_000;
const maxAttempts = 5;

function hashCode(actor: Actor, code: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('Email verification is unavailable. Please try again later.', 503);
  return createHmac('sha256', secret).update('leadcrm:profile-email-change:v1:')
    .update(JSON.stringify([actor.tenantId, actor.userId, code])).digest('hex');
}

async function activeAdmin(tx: Prisma.TransactionClient, actor: Actor) {
  const user = await tx.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId, status: 'ACTIVE', securityLockedAt: null } });
  if (!user || user.role !== 'Client Admin') throw new AppError('Only the Client Administrator can change their email address.', 403);
  const session = await tx.session.findFirst({ where: { id: actor.sessionId, tenantId: actor.tenantId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
  if (!session || !user.passwordHash || user.mustChangePassword) throw new AppError('Sign in again to change your email address.', 401);
  return { ...user, passwordHash: user.passwordHash };
}

async function assertAvailable(tx: Prisma.TransactionClient, tenantId: string, email: string) {
  if (await findUserByEmail(email, tenantId, tx)) throw new AppError('A user with this email already exists in this tenant', 409, 'EMAIL_IN_USE');
}

export async function requestProfileEmailChange(actor: Actor, input: unknown) {
  const { email, currentPassword } = RequestProfileEmailChangeSchema.parse(input);
  const key = preferenceKey(actor);
  const { code, codeHash, issuedAt } = await authTransaction(async tx => {
    const user = await activeAdmin(tx, actor);
    if (!await comparePassword(currentPassword, user.passwordHash)) throw new AppError('Current password is incorrect.', 400, 'CURRENT_PASSWORD_INCORRECT');
    if (email === user.email.toLowerCase()) throw new AppError('Enter a different email address.', 400);
    await assertAvailable(tx, actor.tenantId, email);
    const previous = await tx.userPreference.findUnique({ where: { tenantId_userId_module_key: key } });
    const previousChallenge = challengeSchema.safeParse(previous?.value);
    const now = Date.now();
    if (previous && now - (previousChallenge.success ? previousChallenge.data.issuedAt : +previous.updatedAt) < 60_000) {
      throw new AppError('Wait one minute before requesting another code.', 429);
    }
    let code: string, codeHash: string;
    do {
      code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      codeHash = hashCode(actor, code);
    } while (previousChallenge.success && previousChallenge.data.codeHash === codeHash);
    const value = { email, previousEmail: user.email, sessionId: actor.sessionId, passwordVersion: hashToken(user.passwordHash),
      codeHash, issuedAt: now, failedAttempts: 0, expiresAt: now + expiryMs };
    await tx.userPreference.upsert({ where: { tenantId_userId_module_key: key }, create: { ...key, value }, update: { value } });
    return { code, codeHash, issuedAt: now };
  });
  try {
    const result = await sendMail({ to: email, subject: 'Confirm your LeadCRM email address',
      html: buildProfileEmailChangeEmail(code),
      category: 'profile-email-change', requireDelivery: true });
    if (!result.submitted) throw new Error('Email not submitted');
  } catch {
    await prisma.userPreference.deleteMany({ where: { ...key, AND: [
      { value: { path: ['codeHash'], equals: codeHash } }, { value: { path: ['issuedAt'], equals: issuedAt } },
    ] } });
    throw new AppError('Unable to send the verification email. Please try again.', 503);
  }
}

export async function confirmProfileEmailChange(actor: Actor, input: unknown) {
  const { code } = ConfirmProfileEmailChangeSchema.parse(input);
  const key = preferenceKey(actor);
  const outcome = await authTransaction(async tx => {
    const user = await activeAdmin(tx, actor);
    const row = await tx.userPreference.findUnique({ where: { tenantId_userId_module_key: key } });
    const pending = challengeSchema.safeParse(row?.value);
    const now = new Date();
    if (!pending.success || pending.data.sessionId !== actor.sessionId ||
      pending.data.previousEmail !== user.email || pending.data.passwordVersion !== hashToken(user.passwordHash)) return 'invalid';
    if (pending.data.expiresAt <= +now) {
      await tx.userPreference.delete({ where: { tenantId_userId_module_key: key } });
      return 'invalid';
    }
    if (pending.data.failedAttempts >= maxAttempts) return 'exhausted';
    if (!timingSafeEqual(Buffer.from(pending.data.codeHash, 'hex'), Buffer.from(hashCode(actor, code), 'hex'))) {
      const failedAttempts = pending.data.failedAttempts + 1;
      await tx.userPreference.update({ where: { tenantId_userId_module_key: key }, data: { value: { ...pending.data, failedAttempts } } });
      return failedAttempts >= maxAttempts ? 'exhausted' : 'invalid';
    }
    const { email } = pending.data;
    await assertAvailable(tx, actor.tenantId, email);
    await tx.userPreference.delete({ where: { tenantId_userId_module_key: key } });
    await tx.user.update({ where: { id: actor.userId, tenantId: actor.tenantId }, data: { email, emailVerified: now } });
    if (!EmployeeEmailSchema.safeParse(email).success) await tx.auditLog.create({ data: {
      tenantId: actor.tenantId, userId: actor.userId, entityType: 'User', entityId: actor.userId, category: 'auth',
      action: 'user.staff_approved', metadata: { email, approvedByRole: user.role },
    } });
    // Password recovery queries may also encounter historical tokens without a user ID.
    await tx.passwordResetToken.deleteMany({ where: { OR: [{ userId: actor.userId }, { userId: null, email: { equals: user.email, mode: 'insensitive' } }] } });
    await tx.session.deleteMany({ where: { tenantId: actor.tenantId, userId: actor.userId } });
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, entityType: 'User',
      entityId: actor.userId, category: 'auth', action: 'profile.email_changed',
      changeset: { before: { email: user.email }, after: { email } } } });
  });
  // Throw only after the transaction commits failed-attempt increments or expiry cleanup.
  if (outcome === 'exhausted') throw new AppError('Too many incorrect codes. Request a new code.', 429, 'PROFILE_EMAIL_CODE_ATTEMPTS_EXCEEDED');
  if (outcome === 'invalid') throw new AppError('Invalid or expired verification code.', 400, 'INVALID_PROFILE_EMAIL_CODE');
}

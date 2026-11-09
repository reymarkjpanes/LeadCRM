import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ConfirmProfileEmailChangeSchema, EmployeeEmailSchema, RequestProfileEmailChangeSchema } from '@leadcrm/shared';
import { z } from 'zod';
import prisma from '../../config/database.config';
import { findUserByEmail } from '../../modules/administration/users/users.repository';
import { AppError } from '../../shared/errors/app-error';
import { comparePassword } from '../../shared/helpers/crypto';
import { sendMail } from '../../shared/services/email.service';
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
  expiresAt: z.number(),
});
const expiryMs = 15 * 60_000;

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
  const code = randomBytes(24).toString('base64url');
  const codeHash = hashToken(code);
  await authTransaction(async tx => {
    const user = await activeAdmin(tx, actor);
    if (!await comparePassword(currentPassword, user.passwordHash)) throw new AppError('Current password is incorrect.', 400, 'CURRENT_PASSWORD_INCORRECT');
    if (email === user.email.toLowerCase()) throw new AppError('Enter a different email address.', 400);
    await assertAvailable(tx, actor.tenantId, email);
    const previous = await tx.userPreference.findUnique({ where: { tenantId_userId_module_key: key } });
    const now = Date.now();
    if (previous && now - +previous.updatedAt < 60_000) throw new AppError('Wait one minute before requesting another code.', 429);
    const value = { email, previousEmail: user.email, sessionId: actor.sessionId, passwordVersion: hashToken(user.passwordHash), codeHash, expiresAt: now + expiryMs };
    await tx.userPreference.upsert({ where: { tenantId_userId_module_key: key }, create: { ...key, value }, update: { value } });
  });
  try {
    const result = await sendMail({ to: email, subject: 'Confirm your LeadCRM email address',
      html: `<p>Enter this code in LeadCRM Profile Settings within 15 minutes:</p><p><strong>${code}</strong></p>`,
      category: 'profile-email-change', requireDelivery: true });
    if (!result.submitted) throw new Error('Email not submitted');
  } catch {
    await prisma.userPreference.deleteMany({ where: { ...key, value: { path: ['codeHash'], equals: codeHash } } });
    throw new AppError('Unable to send the verification email. Please try again.', 503);
  }
}

export async function confirmProfileEmailChange(actor: Actor, input: unknown) {
  const { code } = ConfirmProfileEmailChangeSchema.parse(input);
  const key = preferenceKey(actor);
  await authTransaction(async tx => {
    const user = await activeAdmin(tx, actor);
    const row = await tx.userPreference.findUnique({ where: { tenantId_userId_module_key: key } });
    const pending = challengeSchema.safeParse(row?.value);
    const now = new Date();
    if (!pending.success || pending.data.expiresAt <= +now || pending.data.sessionId !== actor.sessionId ||
      pending.data.previousEmail !== user.email || pending.data.passwordVersion !== hashToken(user.passwordHash) ||
      !timingSafeEqual(Buffer.from(pending.data.codeHash, 'hex'), Buffer.from(hashToken(code), 'hex'))) {
      throw new AppError('Invalid or expired verification code.', 400, 'INVALID_PROFILE_EMAIL_CODE');
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
}

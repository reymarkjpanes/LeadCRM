import prisma from '../../config/database.config';
import crypto from 'crypto';
import { comparePassword, hashPassword } from '../../shared/helpers/crypto';
import { AppError } from '../../shared/errors/app-error';
import { sendMail, buildPasswordResetEmail, EmailSubmissionError } from '../../shared/services/email.service';
import { ForgotPasswordSchema, type ForgotPasswordDto, type ResetPasswordDto } from './auth.dto';
import {
  StrongPasswordSchema, isWorkspaceAccessible, PASSWORD_RECOVERY_MESSAGE,
  PASSWORD_RECOVERY_RESEND_SECONDS, PASSWORD_RECOVERY_SEND_ERROR, type PasswordRecoveryResponse,
} from '@leadcrm/shared';
import { getAuthAppOrigin, getPasswordResetTtlMinutes } from '../../shared/helpers/auth-email-config';
import { requireEmployeeAccount } from './account-access';
import { authTransaction } from './auth-transaction';

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function eligible(user: { role: string; email: string; status: string; tenant: { status: string } | null }): boolean {
  if (user.status !== 'ACTIVE' || !isWorkspaceAccessible(user.tenant?.status)) return false;
  try { requireEmployeeAccount(user); return true; } catch (error) {
    if (error instanceof AppError) return false;
    throw error;
  }
}

function unconfirmed(expires: Date): AppError {
  return new AppError(
    'Email submission could not be confirmed. Check your inbox and spam folder before requesting another link.',
    502, 'PASSWORD_RESET_SUBMISSION_UNCONFIRMED', expires.toISOString(),
  );
}

/** Explicit existence disclosure approved by the owner on 2026-10-10. See docs/password-recovery-verification.md. */
export async function requestPasswordReset(dto: ForgotPasswordDto, target?: { userId: string; tenantId: string }): Promise<PasswordRecoveryResponse> {
  dto = ForgotPasswordSchema.parse(dto);
  const result: PasswordRecoveryResponse = {
    success: true, message: PASSWORD_RECOVERY_MESSAGE,
    expiresInMinutes: getPasswordResetTtlMinutes(), resendAfterSeconds: PASSWORD_RECOVERY_RESEND_SECONDS,
  };
  const candidates = await prisma.user.findMany({
    where: { email: { equals: dto.email, mode: 'insensitive' }, ...(target ? { id: target.userId, tenantId: target.tenantId } : {}) },
    include: { tenant: { select: { status: true } } }, take: 2,
  });
  if (candidates.length === 0) {
    throw new AppError('No account exists with this email address.', 404, 'ACCOUNT_NOT_FOUND');
  }
  // Public recovery cannot select between tenant-scoped duplicate identities or reveal restrictions.
  const user = candidates.length === 1 ? candidates[0] : null;
  if (!user || !eligible(user)) {
    if (target) throw new AppError('Password recovery is unavailable for this account.', 403, 'PASSWORD_RECOVERY_UNAVAILABLE');
    return result;
  }

  const appOrigin = getAuthAppOrigin();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expires = new Date(Date.now() + result.expiresInMinutes * 60_000);
  const reserved = await authTransaction(async tx => {
    // Serializable reads of the indexed token range arbitrate concurrent requests.
    // Keep the tenant-scoped ORM boundary intact; provider calls are never retried by the transaction.
    const current = await tx.user.findFirst({ where: { id: user.id, tenantId: user.tenantId }, include: { tenant: { select: { status: true } } } });
    if (!current || current.email.toLowerCase() !== dto.email || !eligible(current)) return false;
    const previous = await tx.passwordResetToken.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    if (previous && previous.expires > new Date()) {
      if (['PENDING', 'UNCONFIRMED'].includes(previous.submissionStatus)) throw unconfirmed(previous.expires);
      if (previous.createdAt.getTime() + PASSWORD_RECOVERY_RESEND_SECONDS * 1000 > Date.now()) return false;
    }
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.create({ data: { email: current.email, userId: user.id, token: tokenHash, expires, submissionStatus: 'PENDING' } });
    return true;
  });
  if (!reserved) return result;

  const resetUrl = new URL('/reset-password', appOrigin);
  resetUrl.searchParams.set('token', rawToken);
  try {
    const submission = await sendMail({
      to: user.email, subject: 'Reset your LeadCRM password',
      html: buildPasswordResetEmail(resetUrl.href, user.firstName), requireDelivery: true, category: 'password-reset',
    });
    if (!submission.submitted) throw new EmailSubmissionError('rejected');
  } catch (error) {
    // A lost response may have sent mail. Only definite rejection/configuration failure is safe to retry.
    const rejected = error instanceof EmailSubmissionError ? error.outcome === 'rejected' : error instanceof AppError && error.statusCode === 503;
    try {
      if (rejected) {
        await prisma.passwordResetToken.deleteMany({ where: { token: tokenHash } });
      } else {
        await prisma.passwordResetToken.updateMany({ where: { token: tokenHash }, data: { submissionStatus: 'UNCONFIRMED' } });
      }
    } catch {
      console.error('[PasswordRecovery]', { event: 'submission_state_write_failed' });
      throw unconfirmed(expires);
    }
    console.error('[PasswordRecovery]', { event: rejected ? 'submission_rejected' : 'submission_unconfirmed' });
    if (!rejected) throw unconfirmed(expires);
    throw new AppError(PASSWORD_RECOVERY_SEND_ERROR, 502, 'PASSWORD_RESET_EMAIL_FAILED');
  }
  // If persistence fails after acceptance, PENDING prevents resending; never report definite rejection.
  try {
    await prisma.passwordResetToken.updateMany({ where: { token: tokenHash }, data: { submissionStatus: 'ACCEPTED' } });
  } catch {
    console.error('[PasswordRecovery]', { event: 'accepted_submission_state_unconfirmed' });
    throw unconfirmed(expires);
  }
  return result;
}

/** Consume the hashed token and revoke sessions atomically, including concurrent reset attempts. */
export async function resetPasswordWithToken(dto: ResetPasswordDto): Promise<void> {
  StrongPasswordSchema.parse(dto.password);
  const tokenHash = hashResetToken(dto.token);
  const invalid = () => new AppError('Invalid or expired password reset link.', 400, 'INVALID_RESET_TOKEN');
  const record = await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } });
  if (!record) throw invalid();
  if (record.expires <= new Date()) {
    await prisma.passwordResetToken.deleteMany({ where: { token: tokenHash } });
    throw invalid();
  }
  await authTransaction(async tx => {
    const candidates = await tx.user.findMany({
      where: { ...(record.userId ? { id: record.userId } : {}), email: { equals: record.email, mode: 'insensitive' } },
      include: { tenant: { select: { status: true } } }, take: 2,
    });
    const user = candidates.length === 1 ? candidates[0] : null;
    if (!user || !eligible(user)) throw invalid();
    if (user.passwordHash && await comparePassword(dto.password, user.passwordHash)) {
      throw new AppError('Choose a password different from your current password.', 400, 'PASSWORD_REUSE');
    }
    const passwordHash = await hashPassword(dto.password);
    const consumed = await tx.passwordResetToken.deleteMany({ where: { token: tokenHash, expires: { gt: new Date() } } });
    if (consumed.count !== 1) throw invalid();
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({ data: {
      tenantId: user.tenantId, userId: user.id, action: 'PASSWORD_RESET', category: 'auth', entityType: 'User', entityId: user.id,
    } });
  });
}

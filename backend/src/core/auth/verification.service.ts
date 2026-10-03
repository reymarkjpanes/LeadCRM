import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { authTransaction } from './auth-transaction';

async function findPendingUser(tx: Prisma.TransactionClient, email: string) {
  const users = await tx.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    take: 2,
  });
  const user = users.length === 1 ? users[0] : null;
  return user?.status === 'PENDING' && !user.emailVerified ? user : null;
}

async function activatePendingUser(
  tx: Prisma.TransactionClient,
  user: { id: string; email: string },
) {
  const now = new Date();
  const updated = await tx.user.updateMany({
    where: { id: user.id, status: 'PENDING', emailVerified: null },
    data: { status: 'ACTIVE', emailVerified: now },
  });
  if (updated.count !== 1) throw new AppError('Verification is no longer valid.', 400);
  await tx.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  });
  return tx.user.findUniqueOrThrow({ where: { id: user.id } });
}

export async function verifyEmailToken(rawToken: string) {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return authTransaction(async tx => {
    const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new AppError('Invalid or expired verification link.', 400);
    }
    const user = record.userId
      ? await tx.user.findUnique({ where: { id: record.userId } })
      : await findPendingUser(tx, record.email);
    if (!user || user.status !== 'PENDING' || user.emailVerified) {
      throw new AppError('Verification is no longer valid. Please sign in.', 400);
    }
    return activatePendingUser(tx, user);
  });
}

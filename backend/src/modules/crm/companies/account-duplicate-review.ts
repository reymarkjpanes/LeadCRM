import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { accountNameReviewKey, type AccountDuplicateMatch } from '@leadcrm/shared';
import { AccountDuplicateReviewError } from '../../../shared/errors/account-duplicate-review-error';
import { crmReadWhere, mayReadCrmModule } from '../access/crm-record-access.service';

type AccountReviewContext = { operation: 'rename' | 'convert-lead' | 'close-won'; recordId: string };

export async function findPossibleAccountMatches(
  db: Prisma.TransactionClient, tenantId: string, name: string, excludeId?: string,
): Promise<AccountDuplicateMatch[]> {
  const key = accountNameReviewKey(name);
  if (!key || !await mayReadCrmModule(db, tenantId, 'accounts')) return [];
  const accounts = await db.account.findMany({
    where: {
      tenantId, isArchived: false, deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      AND: [await crmReadWhere(db, tenantId, 'accounts')],
    },
    select: { id: true, name: true, website: true, address: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return accounts.filter(account => accountNameReviewKey(account.name) === key);
}

export async function requireAccountDuplicateReview(
  db: Prisma.TransactionClient, tenantId: string, actorId: string, name: string, reviewedToken?: string, context?: AccountReviewContext,
) {
  const matches = await findPossibleAccountMatches(db, tenantId, name, context?.operation === 'rename' ? context.recordId : undefined);
  if (!matches.length) return;
  const token = createHash('sha256')
    .update(JSON.stringify([tenantId, actorId, name, matches, ...(context ? [context.operation, context.recordId] : [])])).digest('hex');
  if (reviewedToken !== token) throw new AccountDuplicateReviewError({ token, matches }, context?.operation === 'close-won'
    ? 'A similar Account already exists. Resolve it in Lead conversion or link the intended Account in Contact Details, then retry Closed Won.'
    : undefined);
}

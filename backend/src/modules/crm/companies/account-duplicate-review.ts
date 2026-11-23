import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { accountNameReviewKey, type AccountDuplicateMatch } from '@leadcrm/shared';
import { AccountDuplicateReviewError } from '../../../shared/errors/account-duplicate-review-error';
import { crmReadWhere, mayReadCrmModule } from '../access/crm-record-access.service';

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
  db: Prisma.TransactionClient, tenantId: string, actorId: string, name: string, reviewedToken?: string,
) {
  const matches = await findPossibleAccountMatches(db, tenantId, name);
  if (!matches.length) return;
  // Bind the confirmation to the current Account name and all visible matches.
  const token = createHash('sha256')
    .update(JSON.stringify([tenantId, actorId, name, matches])).digest('hex');
  if (reviewedToken !== token) throw new AccountDuplicateReviewError({ token, matches });
}

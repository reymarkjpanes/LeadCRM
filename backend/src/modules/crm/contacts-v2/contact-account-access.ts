import type { Prisma } from '@prisma/client';
import { ForbiddenError } from '../../../shared/errors/http-error';
import { mayReadCrmModule } from '../access/crm-record-access.service';

/** Contact permission does not grant access to the linked Account's metadata. */
export async function mayReadContactAccount(db: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  return mayReadCrmModule(db, tenantId, 'accounts');
}

/** Strip implementation metadata on every public Contact projection. */
export function presentContactAccount<T extends { companyName?: string | null; companyFromAccount?: boolean; account?: unknown }>(contact: T, permitted: boolean) {
  const { companyFromAccount, ...record } = contact;
  return { ...record, ...(companyFromAccount && !permitted && 'companyName' in record ? { companyName: null } : {}),
    ...('account' in record ? { account: permitted ? record.account : null } : {}) } as Omit<T, 'companyFromAccount'>;
}

export async function assertContactAccountSelection(db: Prisma.TransactionClient, tenantId: string, accountId: unknown, previousId?: string | null): Promise<void> {
  // Keeping a historical FK or removing it reveals no new Account information.
  if (accountId == null || accountId === previousId) return;
  if (!await mayReadContactAccount(db, tenantId)) throw new ForbiddenError('Accounts View permission is required to select an Account.');
}

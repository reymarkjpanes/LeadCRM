import type { Prisma } from '@prisma/client';
import { ForbiddenError, ValidationError } from '../../../shared/errors/http-error';
import { mayReadCrmModule, crmReadWhere } from '../access/crm-record-access.service';

/** Contact permission does not grant access to the linked Account's metadata. */
export async function mayReadContactAccount(db: Prisma.TransactionClient, tenantId: string, accountId?: string | null): Promise<boolean> {
  if (!await mayReadCrmModule(db, tenantId, 'accounts')) return false;
  return !accountId || !!await db.account.findFirst({ where: { AND: [{ tenantId, id: accountId }, await crmReadWhere(db, tenantId, 'accounts')] }, select: { id: true } });
}

/** Strip implementation metadata on every public Contact projection. */
export function presentContactAccount<T extends { companyName?: string | null; companyFromAccount?: boolean; account?: unknown; manualStatusContext?: unknown }>(contact: T, permitted: boolean) {
  const { companyFromAccount, manualStatusContext: _checkpoint, ...record } = contact;
  return { ...record, ...(companyFromAccount && (!permitted || 'account' in record && record.account === null) && 'companyName' in record ? { companyName: null } : {}),
    ...('account' in record ? { account: permitted ? record.account : null } : {}) } as Omit<T, 'companyFromAccount' | 'manualStatusContext'>;
}

export function presentContactCompany<T extends { companyName?: string | null; companyFromAccount?: boolean; account?: unknown; manualStatusContext?: unknown }>(contact: T, permitted: boolean) {
  const record = presentContactAccount(contact, permitted);
  const account = permitted ? contact.account : undefined;
  return account && typeof account === 'object' && 'name' in account && typeof account.name === 'string'
    ? { ...record, companyName: account.name } : record;
}

export async function assertContactAccountSelection(db: Prisma.TransactionClient, tenantId: string, accountId: unknown, previousId?: string | null): Promise<void> {
  // Keeping a historical FK or removing it reveals no new Account information.
  if (accountId == null || accountId === previousId) return;
  if (!await mayReadContactAccount(db, tenantId)) throw new ForbiddenError('Accounts View permission is required to select an Account.');
  if (!await db.account.findFirst({ where: { AND: [{ tenantId, id: String(accountId), isArchived: false, deletedAt: null }, await crmReadWhere(db, tenantId, 'accounts')] }, select: { id: true } })) throw new ValidationError('Select an available Account in this workspace.');
}

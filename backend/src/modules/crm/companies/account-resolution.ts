import type { Prisma } from '@prisma/client';
import { companyNameMatchKey, type NewAccountInput } from '@leadcrm/shared';
import { ConflictError } from '../../../shared/errors/http-error';
import { assertCrmCreateAssignment, crmReadWhere } from '../access/crm-record-access.service';
import { salesContext } from '../leads/sales-context';
import { requireAccountDuplicateReview } from './account-duplicate-review';
import { createCompany } from './companies.service';
import { createLinkedAccount } from './organization-creation';

/** Resolve an unlinked company inside the caller's conversion or closing transaction. */
export async function resolveAccountForCompany(tx: Prisma.TransactionClient, input: {
  tenantId: string; actorId: string; companyName: string; newAccount?: NewAccountInput;
  operation: 'convert-lead' | 'close-won'; recordId: string;
}) {
  const { tenantId, actorId, newAccount, operation, recordId } = input;
  const name = input.companyName.trim().replace(/\s+/g, ' ');
  const candidates = await tx.account.findMany({
    where: { tenantId, name: { contains: name.split(' ')[0], mode: 'insensitive' }, AND: [await crmReadWhere(tx, tenantId, 'accounts')] },
    select: { id: true, name: true, isArchived: true, deletedAt: true },
  });
  const exactMatches = candidates.filter(account => companyNameMatchKey(account.name) === companyNameMatchKey(name));
  if (exactMatches.length > 1 || exactMatches[0]?.isArchived || exactMatches[0]?.deletedAt) {
    throw new ConflictError(operation === 'close-won'
      ? 'Multiple or inactive Accounts match this company. Choose an active Account in Lead conversion or Contact Details, then retry Closed Won.'
      : 'Multiple or inactive Accounts match this company. Choose an active Account before continuing.');
  }
  const exact = exactMatches[0];
  if (exact && !newAccount?.duplicateReviewToken) return exact;
  await requireAccountDuplicateReview(tx, tenantId, actorId, name, newAccount?.duplicateReviewToken, { operation, recordId });
  if (exact) return exact;
  await assertCrmCreateAssignment(tx, tenantId, undefined, 'accounts');
  return salesContext.run(tx, () => newAccount
    ? createLinkedAccount(tx, tenantId, newAccount, actorId)
    : createCompany(tenantId, actorId, { name }));
}

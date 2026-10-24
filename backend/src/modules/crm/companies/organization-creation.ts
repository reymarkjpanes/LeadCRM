import type { Prisma } from '@prisma/client';
import { NewAccountSchema } from '@leadcrm/shared';
import { assertCrmCreateAssignment, crmActor, mayReadCrmModule } from '../access/crm-record-access.service';
import { ForbiddenError } from '../../../shared/errors/http-error';
import { createCompany } from './companies.service';

/** Called only inside the person mutation's sales transaction. */
export async function createLinkedAccount(tx: Prisma.TransactionClient, tenantId: string, input: unknown, actorId?: string, ownerGroupId?: string | null) {
  const { requestId, ...details } = NewAccountSchema.parse(input);
  const actor = crmActor.getStore();
  if (!actorId || !actor || actor.tenantId !== tenantId || actor.userId !== actorId) throw new ForbiddenError('An authenticated Account creator is required.');
  if (!await mayReadCrmModule(tx, tenantId, 'accounts')) throw new ForbiddenError('Accounts View permission is required to create a linked Account.');
  await assertCrmCreateAssignment(tx, tenantId, undefined, 'accounts', ownerGroupId);
  return createCompany(tenantId, actorId, { ...details, requestId }, ownerGroupId);
}

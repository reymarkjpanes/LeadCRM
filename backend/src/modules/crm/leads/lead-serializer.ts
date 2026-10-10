import { normalizeCrmStatus } from '@leadcrm/shared';

/** Product arrays are canonical projections from core/tenant/product-projections.
 * Migration flags, retry keys and engagement state stay internal.
 */
export function serializeLead<T extends { id: string; status: string; productInterest: string[]; productInterestIds: string[] }>(lead: T) {
  const fields = ['id', 'tenantId', 'firstName', 'lastName', 'email', 'phone', 'companyName', 'address', 'source',
    'accountId', 'assignedUserId', 'createdAt', 'updatedAt', 'createdById', 'updatedById', 'lastStatusChangedAt',
    'contactId', 'convertedAt', 'convertedById', 'isArchived', 'deletedAt', 'deletedBy',
    'assignedUser', 'account', 'createdBy', 'updatedBy'] as const;
  return {
    ...Object.fromEntries(fields.filter(field => field in lead).map(field => [field, (lead as Record<string, unknown>)[field]])),
    id: lead.id, status: normalizeCrmStatus(lead.status),
    productInterestIds: lead.productInterestIds, productInterest: lead.productInterest, productInterests: lead.productInterest,
  };
}

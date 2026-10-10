import { isDeepStrictEqual } from 'node:util';
import type { CustomFieldModule } from '@leadcrm/shared';
import prisma from '../../config/database.config';
import { readRecordValues } from './closing-requirements/custom-field-values.repository';

/** Capture stored custom values before a service mutation, then compare the committed values. */
export async function customFieldChangeTracker(tenantId: string, module: CustomFieldModule, id: string, patch: unknown) {
  const before = patch === undefined ? undefined : await readRecordValues(prisma, tenantId, module, id);
  return async (changes: ReturnType<typeof recordChanges>) => {
    if (!before) return changes;
    const after = await readRecordValues(prisma, tenantId, module, id);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (isDeepStrictEqual(before[key] ?? null, after[key] ?? null)) continue;
      const field = `customFieldValues.${key}`;
      changes.changedFields.push(field);
      changes.before[field] = before[key] ?? null;
      changes.after[field] = after[key] ?? null;
    }
    return changes;
  };
}

// Changes to save metadata or loaded relation projections are not record edits.
const metadata = new Set([
  'creationKey', 'engagementEvaluatedAt', 'lastCustomerReplyAt', 'firstUnansweredOutboundAt', 'id', 'tenantId', 'createdAt', 'updatedAt', 'createdById', 'updatedById',
  'lastStatusChangedAt', 'stageChangedAt', 'assignedUser', 'createdBy', 'updatedBy',
  'account', 'organization', 'owner', 'pipeline', 'stage', 'stageHistories',
  'lead', 'contact', 'productInterestRecord', 'recordFiles', 'activities', 'tasks',
  'actions', 'taskLinks', 'order', 'productsNormalized', 'productLinks',
]);
const setFields = new Set(['productInterest', 'productInterestIds', 'productInterests', 'activeProducts', 'tags', 'leadIds', 'contactIds']);

function comparable(field: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) && setFields.has(field)) return [...new Set(value)].sort();
  return value;
}

/** Compare persisted values, never the submitted patch, to reject no-op updates. */
export function recordChanges(before: object, after: object) {
  const previous = { ...before } as Record<string, unknown>;
  const current = { ...after } as Record<string, unknown>;
  for (const [relation, field, id] of [['leadDeals', 'leadIds', 'leadId'], ['contactDeals', 'contactIds', 'contactId']]) {
    for (const record of [previous, current]) {
      if (Array.isArray(record[relation])) record[field] = (record[relation] as Record<string, unknown>[]).map(link => link[id]);
      delete record[relation];
    }
  }
  const changedFields = Object.keys(current).filter(field =>
    field in previous && !metadata.has(field) && !isDeepStrictEqual(comparable(field, previous[field]), comparable(field, current[field])),
  );
  return {
    changedFields,
    before: Object.fromEntries(changedFields.map(field => [field, previous[field]])),
    after: Object.fromEntries(changedFields.map(field => [field, current[field]])),
  };
}

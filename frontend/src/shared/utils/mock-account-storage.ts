import {
  ACCOUNT_DUPLICATE_REVIEW_CODE, ACCOUNT_DUPLICATE_REVIEW_MESSAGE, accountNameReviewKey,
  type AccountDuplicateMatch,
} from '@leadcrm/shared';
import type { ApiRequestError } from '@/lib/api/client';

export const mockAccountsKey = 'leadcrm_accounts';
export const mockOrganizationsKey = 'leadcrm_organizations';

export function readMockAccountRows<T>(key: string): T[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function readMockAccounts<T extends { id: string }>(): T[] {
  const rows = [...readMockAccountRows<T>(mockAccountsKey), ...readMockAccountRows<T>(mockOrganizationsKey)];
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

export async function requireMockAccountReview(
  accounts: Array<AccountDuplicateMatch & { tenantId: string; isArchived?: boolean }>,
  tenantId: string, actorId: string | undefined, name: string, reviewedToken?: string, renameId?: string,
) {
  const key = accountNameReviewKey(name);
  if (!key) return;
  const matches = accounts.filter(account => account.tenantId === tenantId && account.id !== renameId && !account.isArchived && accountNameReviewKey(account.name) === key)
    .map(({ id, name, website, address }) => ({ id, name, website, address }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!matches.length) return;
  const bytes = new TextEncoder().encode(JSON.stringify([tenantId, actorId, name, matches, renameId]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const token = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (reviewedToken === token) return;
  const error: ApiRequestError = new Error(ACCOUNT_DUPLICATE_REVIEW_MESSAGE);
  error.code = ACCOUNT_DUPLICATE_REVIEW_CODE;
  error.duplicateReview = { token, matches };
  error.status = 409;
  throw error;
}

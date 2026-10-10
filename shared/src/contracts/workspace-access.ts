import type { TenantStatus } from '../types/tenant.types';

/** Only live workspaces may authenticate or process customer data. */
export const ACCESSIBLE_WORKSPACE_STATUSES = ['ACTIVE', 'SANDBOX'] as const satisfies readonly TenantStatus[];

export function isWorkspaceAccessible(status: string | null | undefined): boolean {
  return ACCESSIBLE_WORKSPACE_STATUSES.some(allowed => allowed === status);
}

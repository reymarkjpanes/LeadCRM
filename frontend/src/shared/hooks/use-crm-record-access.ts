'use client';
import { useCallback, useMemo } from 'react';
import { hasCrmRecordAssignmentAccess, canReassignCrmRecord, type CrmRecordAccessPolicy, type PermissionAction } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { useCachedPage } from './use-cached-page';

/** Assignment policy is resolved from all current server roles, separately from action grants. */
export function useCrmRecordAccess(module: string) {
  const { user, tenant } = useAuth();
  const query = useCachedPage<CrmRecordAccessPolicy>({ module: 'crm-record-access', params: {},
    disabled: USE_MOCK_DATA, revalidateOnInvalidation: true, intervalMs: 30000, pauseWhenHidden: true,
    fetchFn: async signal => (await apiClient.get<{ data: CrmRecordAccessPolicy }>('/crm/record-access', { signal })).data });
  const policy: CrmRecordAccessPolicy | undefined = useMemo(() => USE_MOCK_DATA && user && tenant ? {
    userId: user.id, tenantId: tenant.id, clientAdmin: user.role === 'Client Admin',
    assignmentRestricted: /^sales(?:[\s_-]*(?:rep|representative|agent|staff|manager))?$/i.test(user.role.trim()),
  } : query.data?.userId === user?.id && query.data?.tenantId === tenant?.id ? query.data : undefined, [user, tenant, query.data]);
  const canMutate = useCallback((record: { tenantId?: unknown; assignedUserId?: unknown; ownerGroupId?: unknown; status?: unknown } | undefined, action: PermissionAction = 'canEdit') =>
    hasCrmRecordAssignmentAccess(policy, record, module, action), [policy, module]);
  const canReassignRecord = useCallback((record: Parameters<typeof canMutate>[0]) =>
    !!module && canReassignCrmRecord(policy, record, module), [policy, module]);
  return { canMutate, canReassignRecord, canReassign: !!policy && !policy.assignmentRestricted, policy };
}

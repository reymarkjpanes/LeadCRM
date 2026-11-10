'use client';
import { useCallback, useMemo } from 'react';
import { hasCrmRecordAssignmentAccess, canReassignCrmRecord, hasModulePermission, type CrmRecordAccessPolicy, type PermissionAction } from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { useCachedPage } from './use-cached-page';

/** The server resolves current ownership and Group Head scope alongside action grants. */
export function useCrmRecordAccess(module: string) {
  const { user, tenant, permissions } = useAuth();
  const query = useCachedPage<CrmRecordAccessPolicy>({ module: 'crm-record-access', params: {},
    disabled: USE_MOCK_DATA, revalidateOnInvalidation: true, intervalMs: 30000, pauseWhenHidden: true,
    fetchFn: async signal => (await apiClient.get<{ data: CrmRecordAccessPolicy }>('/crm/record-access', { signal })).data });
  const policy: CrmRecordAccessPolicy | undefined = useMemo(() => USE_MOCK_DATA && user && tenant ? {
    userId: user.id, tenantId: tenant.id, clientAdmin: user.role === 'Client Admin',
    assignmentRestricted: user.role !== 'Client Admin',
    crmTeamUserIds: user.role === 'Client Admin' ? undefined : [user.id], crmGroupHead: false, permissions,
  } : query.data?.userId === user?.id && query.data?.tenantId === tenant?.id ? query.data : undefined, [user, tenant, permissions, query.data]);
  const canMutate = useCallback((record: { tenantId?: unknown; assignedUserId?: unknown; status?: unknown } | undefined, action: PermissionAction = 'canEdit') =>
    hasCrmRecordAssignmentAccess(policy, record, module, action), [policy, module]);
  const canReassignRecord = useCallback((record: Parameters<typeof canMutate>[0]) =>
    !!module && canReassignCrmRecord(policy, record, module), [policy, module]);
  const canReassign = !!policy && module !== 'accounts' && (policy.clientAdmin || !policy.assignmentRestricted &&
    hasModulePermission(policy.permissions ?? {}, module, 'canEdit'));
  return { canMutate, canReassignRecord, canReassign, policy };
}

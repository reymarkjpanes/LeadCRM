import { hasModulePermission } from '../constants/permission-modules';
import type { PermissionAction, ResolvedPermissions } from '../types/roles';

export const CRM_SCOPE_ACTIONS = { all: 'canViewAll', my: 'canViewMy', active: 'canViewActive' } as const;
export type CrmReadScope = keyof typeof CRM_SCOPE_ACTIONS;
export const CRM_MODULE_KEYS = ['leads', 'contacts', 'accounts', 'deals'] as const;

export function permittedCrmScopes(permissions: ResolvedPermissions, module: string): CrmReadScope[] {
  return (Object.keys(CRM_SCOPE_ACTIONS) as CrmReadScope[]).filter(scope => hasModulePermission(permissions, module, CRM_SCOPE_ACTIONS[scope]));
}

/** Server-resolved from the current tenant's RoleDefinition/UserRole assignments. */
export interface CrmRecordAccessPolicy {
  userId: string;
  tenantId: string;
  assignmentRestricted: boolean;
  clientAdmin: boolean;
  activityReadScope?: 'tenant' | 'managed-groups' | 'mailbox';
  /** Current server-resolved assignees in Groups this employee heads, including self. */
  crmTeamUserIds?: string[];
  crmGroupHead?: boolean;
  permissions?: ResolvedPermissions;
}

export function hasCrmRecordAssignmentAccess(
  policy: CrmRecordAccessPolicy | undefined,
  record: { tenantId?: unknown; assignedUserId?: unknown; status?: unknown } | undefined,
  module?: string,
  action: PermissionAction = 'canEdit',
): boolean {
  if (!policy || !record || record.tenantId !== policy.tenantId) return false;
  if (policy.clientAdmin) return true;
  if (module && ['leads', 'contacts', 'deals'].includes(module) && policy.crmTeamUserIds) {
    return !!policy.permissions && hasModulePermission(policy.permissions, module, action) &&
      typeof record.assignedUserId === 'string' && policy.crmTeamUserIds.includes(record.assignedUserId) &&
      permittedCrmScopes(policy.permissions, module).some(scope => scope === 'all' || scope === 'my' && record.assignedUserId === policy.userId ||
        scope === 'active' && ['Inquiry', 'Hot', 'Warm', 'INQUIRY', 'HOT', 'WARM'].includes(String(record.status)) && record.assignedUserId === policy.userId);
  }
  if (!policy.permissions || !module) return module === 'accounts' || !policy.assignmentRestricted || record.assignedUserId === policy.userId;
  return hasModulePermission(policy.permissions, module, action) &&
      permittedCrmScopes(policy.permissions, module).some(scope => scope === 'all' || scope === 'my' && record.assignedUserId === policy.userId ||
        scope === 'active' && ['Inquiry', 'Hot', 'Warm', 'INQUIRY', 'HOT', 'WARM'].includes(String(record.status)) && record.assignedUserId === policy.userId) &&
      (module === 'accounts' || !policy.assignmentRestricted || record.assignedUserId === policy.userId);
}

/** Staff reassignment requires current edit access and a saved Group Head assignment. */
export function canReassignCrmRecord(policy: CrmRecordAccessPolicy | undefined,
  record: Parameters<typeof hasCrmRecordAssignmentAccess>[1], module: string): boolean {
  if (!policy) return false;
  if (policy.clientAdmin) return hasCrmRecordAssignmentAccess(policy, record, module);
  if (['leads', 'contacts', 'deals'].includes(module) && policy.crmTeamUserIds) return policy.crmGroupHead === true && hasCrmRecordAssignmentAccess(policy, record, module);
  if (!policy.permissions) return !policy.assignmentRestricted && hasCrmRecordAssignmentAccess(policy, record, module);
  return hasCrmRecordAssignmentAccess({ ...policy,
    permissions: policy.assignmentRestricted ? {} : policy.permissions,
  }, record, module);
}

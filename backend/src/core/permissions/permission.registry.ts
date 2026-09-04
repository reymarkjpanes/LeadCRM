import { Permission, PermissionKey } from '../../shared/constants/permissions';
import { Role } from '../../shared/constants/roles';

/**
 * DEFAULT_ROLE_PERMISSIONS
 *
 * Maps each built-in role to its allowed permission keys.
 * - Client Admin: bypasses this entirely (handled at middleware level).
 * - System Admin: bypasses this entirely (handled at middleware level).
 * - All other roles: checked here.
 *
 * Adding a new role or permission:
 *   1. Add the permission key to shared/constants/permissions.ts
 *   2. Add the role constant to shared/constants/roles.ts
 *   3. Add the mapping here — zero other files change.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  [Role.USER]: [
    Permission.CONTACTS_VIEW,
    Permission.CONTACTS_CREATE,
    Permission.CONTACTS_EDIT,
    Permission.CONTACTS_EXPORT,
    Permission.ACCOUNTS_VIEW,
    Permission.ACCOUNTS_CREATE,
    Permission.ACCOUNTS_EDIT,
    Permission.DEALS_VIEW,
    Permission.DEALS_CREATE,
    Permission.DEALS_EDIT,
    Permission.CAMPAIGNS_VIEW,
    Permission.WORKFLOWS_VIEW,
    Permission.WORKFLOWS_ACTIVATE,
    Permission.REPORTS_VIEW,
    Permission.BILLING_VIEW,
    Permission.SETTINGS_VIEW,
  ],

  [Role.RESTRICTED_USER]: [
    Permission.CONTACTS_VIEW,
    Permission.DEALS_VIEW,
    Permission.ACCOUNTS_VIEW,
    Permission.BILLING_VIEW,
    Permission.BILLING_MANAGE,  // enables billing.manage → checkout/upgrade from sandbox workspace
  ],
  
  // Legacy mappings to support existing JWT tokens before users log out
  'Sales Rep': [
    Permission.CONTACTS_VIEW,
    Permission.CONTACTS_CREATE,
    Permission.CONTACTS_EDIT,
    Permission.CONTACTS_EXPORT,
    Permission.ACCOUNTS_VIEW,
    Permission.ACCOUNTS_CREATE,
    Permission.ACCOUNTS_EDIT,
    Permission.DEALS_VIEW,
    Permission.DEALS_CREATE,
    Permission.DEALS_EDIT,
    Permission.CAMPAIGNS_VIEW,
    Permission.WORKFLOWS_VIEW,
    Permission.WORKFLOWS_ACTIVATE,
    Permission.REPORTS_VIEW,
    Permission.BILLING_VIEW,
    Permission.SETTINGS_VIEW,
  ],
  'Technician': [
    Permission.CONTACTS_VIEW,
    Permission.DEALS_VIEW,
  ],
  'Viewer': [
    Permission.CONTACTS_VIEW,
    Permission.DEALS_VIEW,
    Permission.CAMPAIGNS_VIEW,
    Permission.WORKFLOWS_VIEW,
    Permission.REPORTS_VIEW,
    Permission.SETTINGS_VIEW,
  ],
};

/**
 * hasPermission — pure helper used in services or tests.
 * The middleware uses DEFAULT_ROLE_PERMISSIONS directly.
 */
export function hasPermission(
  userPermissions: string[],
  permission: PermissionKey,
): boolean {
  return userPermissions.includes(permission);
}

/**
 * getPermissionsForRole — returns the permission array for a given role string.
 * Returns empty array for unknown roles (safe default — deny all).
 */
export function getPermissionsForRole(role: string): PermissionKey[] {
  return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}

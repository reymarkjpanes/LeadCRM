import { Permission, PermissionKey } from '../../shared/constants/permissions';
import { Role } from '../../shared/constants/roles';

/**
 * DEFAULT_ROLE_PERMISSIONS
 *
 * Maps each built-in non-super role to its allowed permission keys.
 *
 * Roles overview:
 *   - User: standard paid-plan CRM access (contacts, deals, campaigns, workflows, reports).
 *
 *   - Guest: sandbox/pre-subscription role assigned at registration.
 *     Can browse sandbox CRM data and initiate a billing checkout to upgrade.
 *     NOT Client Admin — that is only assigned after successful Stripe payment.
 *
 *   - Client Admin: bypasses this registry entirely (handled at middleware level via isSuperRole).
 *     Assigned ONLY after a successful Stripe subscription payment via the webhook.
 *
 *   - System Admin: bypasses this registry entirely (handled at middleware level via isSuperRole).
 *     Platform-level operator, independent of any customer subscription.
 *
 * Adding a new role or permission:
 *   1. Add the permission key to shared/constants/permissions.ts
 *   2. Add the role constant to shared/constants/roles.ts
 *   3. Add the mapping here — zero other files change.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  // ── Active paid-plan role ────────────────────────────────────────────────────
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

  // ── Sandbox / pre-subscription role (assigned at registration) ──────────────
  // Guest gets full CRUD on basic CRM modules (contacts, accounts, deals, tasks)
  // with limits enforced by recordLimitGate (100 contacts, 3 users).
  // Premium features (campaigns, workflows) are view-only.
  // Billing has full manage access so Guest can upgrade.
  // This MUST mirror GUEST_PERMISSIONS in roles.seed.ts so the static-registry
  // fallback in rbac.middleware.ts produces the same outcome as a fully seeded DB.
  // isSuperRole('Guest') === false — this IS evaluated via RolePermission.
  [Role.GUEST]: [
    // CRM core — full CRUD (limits enforced by recordLimitGate)
    Permission.CONTACTS_VIEW,
    Permission.CONTACTS_CREATE,
    Permission.CONTACTS_EDIT,
    Permission.CONTACTS_DELETE,
    Permission.ACCOUNTS_VIEW,
    Permission.ACCOUNTS_CREATE,
    Permission.ACCOUNTS_EDIT,
    Permission.ACCOUNTS_DELETE,
    Permission.DEALS_VIEW,
    Permission.DEALS_CREATE,
    Permission.DEALS_EDIT,
    Permission.DEALS_DELETE,
    // Premium features — view only; mutations blocked by planGate
    Permission.CAMPAIGNS_VIEW,
    Permission.WORKFLOWS_VIEW,
    // Reports — view only
    Permission.REPORTS_VIEW,
    // Team management — view + manage; limited to 3 users via recordLimitGate
    Permission.USERS_VIEW,
    Permission.USERS_MANAGE,
    // Settings — view + edit
    Permission.SETTINGS_VIEW,
    Permission.SETTINGS_EDIT,
    // Billing — full access so Guest can upgrade
    Permission.BILLING_VIEW,
    Permission.BILLING_MANAGE,
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

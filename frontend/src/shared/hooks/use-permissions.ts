'use client';

import { useMemo } from 'react';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import type { PermissionKey } from '@leadcrm/shared';
import { USE_MOCK_AUTH } from '@/lib/config';

// Roles that bypass all permission checks (case-insensitive check)
const SUPER_ROLES = ['admin', 'super user', 'client admin', 'system admin', 'client_admin'] as const;

/**
 * PERMISSION_BRIDGE — exported for CrmLayout nav access checks.
 * Maps module.action keys to legacy p-IDs used in mock RoleDefinitions.
 */
export const PERMISSION_BRIDGE: Record<PermissionKey, string[]> = {
  'contacts.view':       ['p2', 'p2_own'],
  'contacts.create':     ['p3'],
  'contacts.edit':       ['p4', 'p4_own'],
  'contacts.delete':     ['p5', 'p5_own'],
  'contacts.export':     ['p6'],
  'accounts.view':       ['p2', 'p2_own'],  // initially mirrors contacts access for backward compat
  'accounts.create':     ['p3'],
  'accounts.edit':       ['p4', 'p4_own'],
  'accounts.delete':     ['p5', 'p5_own'],
  'deals.view':          ['p7', 'p7_own'],
  'deals.create':        ['p8'],
  'deals.edit':          ['p9', 'p9_own'],
  'deals.delete':        ['p10', 'p10_own'],
  'campaigns.view':      ['p17'],
  'campaigns.create':    ['p18'],
  'campaigns.edit':      ['p19'],
  'campaigns.delete':    ['p20'],
  'campaigns.send':      ['p21'],
  'workflows.view':      ['p12'],
  'workflows.create':    ['p13'],
  'workflows.edit':      ['p14'],
  'workflows.delete':    ['p15'],
  'workflows.activate':  ['p14'],  // activate maps to canEdit — same bridge
  'users.view':          ['p22'],
  'users.manage':        ['p23', 'p24', 'p25', 'p26'],
  'reports.view':        ['p31'],
  'reports.export':      ['p33'],
  'billing.view':        ['p29'],
  'billing.manage':      ['p29'],
  'settings.view':       ['p27'],
  'settings.edit':       ['p27'],  // no distinct legacy p-ID — mirrors settings.view
  'roles.manage':        ['p26'],
  'audit.view':          ['p30'],
  'admin.access':        [],
};

/**
 * usePermissions — returns the resolved permission list for the current user.
 *
 * Priority:
 *   1. Real-API mode + permissions loaded → reads from AuthContext.permissions
 *      (live DB permissions fetched during session restore).
 *   2. Fallback → mock p-ID strings from DataContext roles (mock mode / not yet loaded).
 */
export function usePermissions(): string[] {
  const { user, permissions, isPermissionsLoaded } = useAuth();
  const { roles } = useData();

  return useMemo(() => {
    if (!user) return [];
    if (SUPER_ROLES.includes(user.role.toLowerCase().trim() as typeof SUPER_ROLES[number])) return ['*'];

    // Real-API path: permissions are loaded from GET /users/:id/permissions
    if (!USE_MOCK_AUTH && isPermissionsLoaded && Object.keys(permissions).length > 0) {
      // Expand ResolvedPermissions map into an array of module.action strings
      const keys: string[] = [];
      for (const [module, flags] of Object.entries(permissions)) {
        if (flags.canView)   keys.push(`${module}.view`);
        if (flags.canCreate) keys.push(`${module}.create`);
        if (flags.canEdit)   keys.push(`${module}.edit`);
        if (flags.canDelete) keys.push(`${module}.delete`);
        // privileged aliases
        if (flags.canEdit) keys.push(`${module}.manage`, `${module}.export`, `${module}.send`, `${module}.activate`);
      }
      return keys;
    }

    // Mock / fallback path: use p-ID strings from DataContext roles
    const roleDef = roles.find(r => r.name === user.role);
    return roleDef?.permissions ?? [];
  }, [user, permissions, isPermissionsLoaded, roles]);
}

/**
 * useHasPermission — returns true if the current user has the given permission.
 *
 * Accepts both module.action keys ('contacts.create') and legacy p-IDs ('p3').
 * Always works correctly against current mock data.
 *
 * Usage:
 *   const canCreate = useHasPermission('contacts.create');
 *   {canCreate && <Button>New Contact</Button>}
 */
export function useHasPermission(permission: PermissionKey): boolean {
  const permissions = usePermissions();
  if (permissions.includes('*')) return true;

  // Direct match (works when roles use module.action — Sprint 5 forward)
  if (permissions.includes(permission)) return true;

  // Bridge: map module.action → legacy p-IDs for current mock data
  const legacyIds = PERMISSION_BRIDGE[permission] ?? [];
  return legacyIds.some(id => permissions.includes(id));
}

/**
 * useCanAny — returns true if the user has at least one of the given permissions.
 *
 * Usage:
 *   const canManage = useCanAny(['contacts.create', 'contacts.edit']);
 */
export function useCanAny(permissionList: PermissionKey[]): boolean {
  const permissions = usePermissions();
  if (permissions.includes('*')) return true;
  return permissionList.some(p => {
    if (permissions.includes(p)) return true;
    const legacyIds = PERMISSION_BRIDGE[p] ?? [];
    return legacyIds.some(id => permissions.includes(id));
  });
}

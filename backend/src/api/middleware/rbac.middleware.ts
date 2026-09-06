import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/errors/app-error';
import type { PermissionKey } from '../../shared/constants/permissions';
import prisma from '../../config/database.config';
import { DEFAULT_ROLE_PERMISSIONS } from '../../core/permissions/permission.registry';
import { isSuperRole } from '../../shared/utils/is-super-role';

/**
 * ROLE STATE INVARIANT
 *
 * User.role (string on the User table, encoded into JWT at login) is the
 * authoritative gate for super-role bypass in this middleware.
 *
 * UserRole → RoleDefinition → RolePermission is the authoritative gate for
 * permission-flag resolution for all non-super roles (two live DB queries per request).
 *
 * DEFAULT_ROLE_PERMISSIONS is a fallback ONLY when UserRole rows are absent
 * (migration gap). Once all users have UserRole rows, this branch is unreachable.
 *
 * INVARIANT: Whenever a user's role is changed, BOTH User.role AND the UserRole
 * junction row must be updated in the same Prisma $transaction. Never update one
 * without the other.
 *
 * isSuperRole() controls RBAC permission evaluation ONLY.
 * It must NEVER be used for subscription/environment access decisions.
 * See environmentGate middleware for the separate environment bypass (System Admin only).
 */

/**
 * RBAC middleware — live DB reads from RolePermission table.
 *
 * Replaces the old static DEFAULT_ROLE_PERMISSIONS registry.
 * The static registry still exists in permission.registry.ts for seeding reference only;
 * it is never consulted at request time.
 *
 * Execution order on every protected route:
 *   authenticate → authorize('permission.key') → validate → controller
 *
 * Super roles (Client Admin / System Admin / Admin / Super User) bypass all checks.
 * All other roles: resolve effective permissions from UserRole → RolePermission in DB.
 *
 * Permission key format: module.action
 *   .view    → canView
 *   .create  → canCreate
 *   .edit    → canEdit
 *   .delete  → canDelete
 *   .manage / .export / .send / .activate → canEdit (privileged write)
 */


/**
 * Derive the DB column name (canView / canCreate / canEdit / canDelete)
 * and module string from a PermissionKey like "contacts.create".
 */
function parsePermission(permission: PermissionKey): { module: string; flag: keyof RolePermissionFlags } {
  const dot = permission.lastIndexOf('.');
  const module = dot !== -1 ? permission.slice(0, dot) : permission;
  const action = dot !== -1 ? permission.slice(dot + 1) : '';

  let flag: keyof RolePermissionFlags;
  switch (action) {
    case 'view':     flag = 'canView';   break;
    case 'create':   flag = 'canCreate'; break;
    case 'delete':   flag = 'canDelete'; break;
    // manage / export / send / activate / edit → canEdit (privileged write)
    default:         flag = 'canEdit';   break;
  }

  return { module, flag };
}

interface RolePermissionFlags {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function authorize(permission: PermissionKey) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    // Super roles bypass all RolePermission checks.
    // If the bypass check itself throws, treat as a regular (non-bypass) user — fails closed.
    try {
      if (isSuperRole(req.user.role ?? '')) {
        return next();
      }
    } catch {
      // isSuperRole is pure/sync — should never throw, but protect against it.
    }

    const { module, flag } = parsePermission(permission);
    const { userId, tenantId } = req.user;

    try {
      // Resolve all UserRole rows for this user within this tenant.
      const userRoles = await prisma.userRole.findMany({
        where: { userId, tenantId },
        select: { roleId: true },
      });

      if (userRoles.length === 0) {
        // No UserRole junction rows — fall back to User.role string via the static registry.
        // This handles users created before UserRole rows were populated (migration state).
        // Once all users have UserRole rows assigned, this branch becomes unreachable.
        const rolePermissions: string[] = DEFAULT_ROLE_PERMISSIONS[req.user.role] ?? [];
        if (rolePermissions.includes(permission)) return next();
        return next(new AppError('Access denied', 403));
      }

      const roleIds = userRoles.map((ur) => ur.roleId);

      // Look up RolePermission rows for this module across all the user's roles.
      const rolePermissions = await prisma.rolePermission.findMany({
        where: {
          roleId: { in: roleIds },
          module,
        },
        select: { roleId: true, canView: true, canCreate: true, canEdit: true, canDelete: true },
      });

      if (rolePermissions.length === 0) {
        // No RolePermission rows exist for this module — warn and deny.
        console.warn(
          `[RBAC] No RolePermission rows for module "${module}" — ` +
          `userId=${userId} roleIds=${roleIds.join(',')} permission=${permission}`
        );
        return next(new AppError('Access denied', 403));
      }

      // Grant access if ANY of the user's roles has the required flag = true (OR semantics).
      const granted = rolePermissions.some((rp) => rp[flag] === true);
      if (!granted) {
        return next(new AppError('Access denied', 403));
      }

      return next();
    } catch (err) {
      // DB / infrastructure error — fail closed (deny).
      console.error('[RBAC] Permission resolution error:', err instanceof Error ? err.message : err);
      return next(new AppError('Access denied', 403));
    }
  };
}

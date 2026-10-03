import { AppError } from '../../shared/errors/app-error';
import type { PermissionKey } from '../../shared/constants/permissions';
import { findUserEffectivePermissions } from '../../modules/administration/roles/roles.repository';
import { Permission, PERMISSION_ACTION_KEYS, PERMISSION_ACTIONS, hasModulePermission } from '@leadcrm/shared';

/** Shared by request guards and server-side automation; uses current tenant role assignments. */
export async function assertPermissions(user: {userId:string;tenantId:string;role:string}, required: PermissionKey[]) {
  if (required.some(key => !Object.values(Permission).includes(key))) throw new AppError('Unknown permission', 403);
  if (user.role === 'Client Admin') return;
  if (user.role.trim().toLowerCase() === 'guest') throw new AppError('Access denied', 403);
  const permissions = await findUserEffectivePermissions(user.userId, user.tenantId);
  for (const permission of required) {
    const dot = permission.lastIndexOf('.'), module = permission.slice(0, dot), action = permission.slice(dot + 1);
    const flag = PERMISSION_ACTIONS.find(flag => PERMISSION_ACTION_KEYS[flag] === action);
    if (!flag || !hasModulePermission(permissions, module, flag)) throw new AppError('Access denied', 403);
  }
}

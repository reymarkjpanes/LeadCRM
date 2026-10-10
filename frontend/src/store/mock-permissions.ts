import { EMPTY_PERMISSION_FLAGS, PERMISSION_MODULES, type ResolvedPermissions } from '@leadcrm/shared';
import type { RoleDefinition, User } from './types';

/** Development fixtures use the same permission identifiers and tenant boundary as the API. */
export function resolveMockPermissions(user: Pick<User, 'role' | 'tenantId'>, roles: RoleDefinition[]): ResolvedPermissions {
  const role = roles.find(candidate => candidate.tenantId === user.tenantId && candidate.name === user.role && !candidate.isArchived);
  if (!role) return {};
  return Object.fromEntries(PERMISSION_MODULES.map(module => [module.key, {
    ...EMPTY_PERMISSION_FLAGS,
    ...Object.fromEntries(module.actions.map(action => [action, role.permissions.includes(`${module.key}.${action}`)])),
  }]));
}

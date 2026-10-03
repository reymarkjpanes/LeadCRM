'use client';

import { PERMISSION_ACTIONS, PERMISSION_MODULES, EMPTY_PERMISSION_FLAGS, permissionLabel } from '@leadcrm/shared';
import { rolesApi } from '@/shared/services/roles.api';
import type { RoleListItem, RoleDetail } from '@/store/types/roles.types';
import type { CreateRolePayload, UpdateRolePayload } from '@/shared/services/roles.api';

export const rolesService = {
  getAll: async (): Promise<RoleListItem[]> => {
    const res = await rolesApi.list();
    return res.data ?? [];
  },

  getById: async (id: string): Promise<RoleDetail> => {
    const res = await rolesApi.get(id);
    return res.data;
  },

  create: async (payload: CreateRolePayload): Promise<RoleListItem> => {
    const res = await rolesApi.create(payload);
    return res.data;
  },

  update: async (id: string, payload: UpdateRolePayload): Promise<RoleListItem> => {
    const res = await rolesApi.update(id, payload);
    return res.data;
  },

  archive: async (id: string): Promise<void> => {
    await rolesApi.archive(id);
  },

  assign: async (userId: string, roleId: string): Promise<void> => {
    await rolesApi.assign(userId, roleId);
  },

  unassign: async (userId: string, roleId: string): Promise<void> => {
    await rolesApi.unassign(userId, roleId);
  },
};

/** Adapt the canonical module flags to the Settings display model, never database IDs. */
export function toSettingsRole(role: RoleListItem): import('@/store/types').RoleDefinition {
  return {
    ...role,
    description: role.description ?? '',
    permissions: role.permissions.flatMap(row =>
      (PERMISSION_MODULES.find(module => module.key === row.module)?.actions ?? [])
        .filter(action => row[action]).map(action => `${row.module}.${action}`)),
  };
}

export function toSettingsPermissions(modules: import('@/store/types/roles.types').PermissionModuleDefinition[]): import('@/store/types').Permission[] {

  return modules.flatMap(module => module.actions.map(action => ({
    id: `${module.key}.${action}`, category: module.key,
    name: permissionLabel(module, action), description: '',
  })));
}

export function toPermissionRows(ids: string[], permissions: import('@/store/types').Permission[]): CreateRolePayload['permissions'] {
  if (ids.some(id => !permissions.some(permission => permission.id === id))) {
    throw new Error('Selected permissions are no longer available. Reload the role editor.');
  }
  return [...new Set(ids.map(id => id.split('.')[0]))].map(module => ({
    module,
    ...EMPTY_PERMISSION_FLAGS,
    ...Object.fromEntries(PERMISSION_ACTIONS.map(action => [action, ids.includes(`${module}.${action}`)])),
  }));
}

'use client';

import type { PermissionFlags } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import type {
  RoleListItem,
  RoleDetail,
  ResolvedPermissions,
  PermissionModuleDefinition,
} from '@/store/types/roles.types';

export interface CreateRolePayload {
  name:        string;
  description?: string;
  permissions: Array<PermissionFlags & { module: string }>;
}

export interface UpdateRolePayload {
  name?:        string;
  description?: string;
  permissions?: Array<PermissionFlags & { module: string }>;
}

export const rolesApi = {
  /** List all non-archived roles for the tenant. */
  list: (): Promise<{ success: boolean; data: RoleListItem[] }> =>
    apiClient.get('/administration/roles'),

  /** Full role detail including permissions + assigned users. */
  get: (id: string): Promise<{ success: boolean; data: RoleDetail }> =>
    apiClient.get(`/administration/roles/${id}`),

  /** Create a custom role with initial permission rows. */
  create: (payload: CreateRolePayload): Promise<{ success: boolean; data: RoleListItem }> =>
    apiClient.post('/administration/roles', payload),

  /** Update a custom role's name, description, and/or permissions. */
  update: (id: string, payload: UpdateRolePayload): Promise<{ success: boolean; data: RoleListItem }> =>
    apiClient.put(`/administration/roles/${id}`, payload),

  /** Archive (soft-delete) a custom role. Fails if users are still assigned. */
  archive: (id: string): Promise<{ success: boolean }> =>
    apiClient.patch(`/administration/roles/${id}/archive`, {}),

  /** Assign a role to a user. Idempotent. */
  assign: (userId: string, roleId: string): Promise<{ success: boolean }> =>
    apiClient.post('/administration/roles/assign', { userId, roleId }),

  /** Remove a role assignment from a user. */
  unassign: (userId: string, roleId: string): Promise<{ success: boolean }> =>
    apiClient.deleteWithBody('/administration/roles/unassign', { userId, roleId }),

  /** Canonical list of permission modules (read-only reference). */
  getPermissionModules: (): Promise<{ success: boolean; data: PermissionModuleDefinition[] }> =>
    apiClient.get('/administration/permissions'),

  /** Effective permissions for a user (own permissions, or any user for admins). */
  getUserPermissions: (userId: string): Promise<{ success: boolean; data: ResolvedPermissions }> =>
    apiClient.get(`/administration/users/${userId}/permissions`),
};

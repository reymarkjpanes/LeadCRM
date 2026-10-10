'use client';

import { apiClient } from '@/lib/api/client';
import type { TenantGroup } from '@leadcrm/shared';
export type { TenantGroup, TenantGroupMember } from '@leadcrm/shared';

function groupsChanged<T>(result: T): T { window.dispatchEvent(new Event('leadcrm:groups-changed')); window.dispatchEvent(new Event('leadcrm:users-changed')); return result; }
interface ApiResult<T> { success: boolean; data: T }
export const groupsApi = {
  getAll: (): Promise<ApiResult<TenantGroup[]>> => apiClient.get('/administration/groups'),
  create: (name: string): Promise<ApiResult<TenantGroup>> => apiClient.post<ApiResult<TenantGroup>>('/administration/groups', { name }).then(groupsChanged),
  update: (id: string, name: string): Promise<ApiResult<TenantGroup>> => apiClient.put<ApiResult<TenantGroup>>(`/administration/groups/${id}`, { name }).then(groupsChanged),
  remove: (id: string): Promise<void> => apiClient.delete<void>(`/administration/groups/${id}`).then(groupsChanged),
  addMember: (id: string, userId: string): Promise<void> => apiClient.post<void>(`/administration/groups/${id}/members`, { userId }).then(groupsChanged),
  removeMember: (id: string, userId: string): Promise<void> => apiClient.delete<void>(`/administration/groups/${id}/members/${userId}`).then(groupsChanged),
};

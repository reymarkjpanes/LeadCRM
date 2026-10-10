'use client';

import { invalidatePageCache } from '@/shared/cache/page-cache';
import type { DeactivationImpact } from '@leadcrm/shared';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type { ApiResponse, PaginatedResponse } from '@leadcrm/shared';
import type { User } from '@/store/types';
import { userAdapter, UserDTO } from '../adapters/user.adapter';

export const usersService = {
  getDirectory: async (): Promise<PaginatedResponse<User>> => {
    const data: User[] = [];
    let page = 1;
    for (;;) {
      const response = await usersService.getAll({ page, limit: 100 });
      data.push(...(response.data ?? []));
      if (!response.meta?.hasMore) return { ...response, data };
      page++;
    }
  },
  deactivationImpact: (id: string) => apiClient.get<ApiResponse<DeactivationImpact>>(`/administration/users/${id}/deactivation-impact`),
  deactivate: async (id: string, replacementAgentId: string | null) => {
    const res = await apiClient.post<ApiResponse<{ user: UserDTO; impact: DeactivationImpact }>>(`/administration/users/${id}/deactivate`, { replacementAgentId });
    if (!res.data) throw new Error('Unable to deactivate user.');
    for (const module of ['leads', 'contacts', 'accounts', 'deals', 'users', 'dashboard']) invalidatePageCache(module, res.data.user.tenantId);
    window.dispatchEvent(new Event('leadcrm:users-changed'));
    return { user: userAdapter.toModel(res.data.user), impact: res.data.impact };
  },
  getAll: async (params?: Record<string, unknown>): Promise<PaginatedResponse<User>> => {
    const res = await apiClient.get<PaginatedResponse<UserDTO>>('/administration/users', { params });
    return {
      ...res,
      data: userAdapter.toModels(res.data as any),
    };
  },

  getById: async (id: string): Promise<ApiResponse<User>> => {
    const res = await apiClient.get<ApiResponse<UserDTO>>(`/administration/users/${id}`);
    return {
      ...res,
      data: userAdapter.toModel(res.data as UserDTO),
    };
  },

  create: async (data: Partial<User>): Promise<ApiResponse<User>> => {
    const dto = userAdapter.toCreateDTO(data);
    const res = await apiClient.post<ApiResponse<UserDTO>>('/administration/users', dto);
    if (res.data?.setupEmailSent === false) toast.warning('Account created, but the welcome email could not be submitted. Use Send Password Reset to establish a password.');
    window.dispatchEvent(new Event('leadcrm:users-changed'));
    if (data.groupIds !== undefined) window.dispatchEvent(new Event('leadcrm:groups-changed'));
    return {
      ...res,
      data: userAdapter.toModel(res.data as UserDTO),
    };
  },

  update: async (id: string, data: Partial<User>): Promise<ApiResponse<User>> => {
    const dto = userAdapter.toUpdateDTO(data);
    const res = await apiClient.put<ApiResponse<UserDTO>>(`/administration/users/${id}`, dto);
    window.dispatchEvent(new Event('leadcrm:users-changed'));
    if (data.groupIds !== undefined) window.dispatchEvent(new Event('leadcrm:groups-changed'));
    return {
      ...res,
      data: userAdapter.toModel(res.data as UserDTO),
    };
  },

  sendPasswordReset: (id: string) => apiClient.post<{ success: boolean; message: string }>(`/administration/users/${id}/password-reset`, {}),

  archive: (id: string): Promise<void> =>
    apiClient.patch<void>(`/administration/users/${id}/archive`),

  restore: (id: string): Promise<void> =>
    apiClient.patch<void>(`/administration/users/${id}/restore`),

  bulkUpdate: (ids: string[], data: Partial<User>): Promise<void> => {
    const dto = userAdapter.toUpdateDTO(data);
    return apiClient.post<void>('/administration/users/bulk-update', { ids, ...dto });
  },
  
};

'use client';

import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import type { ApiResponse, PaginatedResponse } from '@leadcrm/shared';
import type { User } from '@/store/types';
import { userAdapter, UserDTO } from '../adapters/user.adapter';

export const usersService = {
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
    if (res.data?.setupEmailSent === false) toast.warning('User created, but the setup email could not be sent. Use Send Password Reset to retry.');
    return {
      ...res,
      data: userAdapter.toModel(res.data as UserDTO),
    };
  },

  update: async (id: string, data: Partial<User>): Promise<ApiResponse<User>> => {
    const dto = userAdapter.toUpdateDTO(data);
    const res = await apiClient.put<ApiResponse<UserDTO>>(`/administration/users/${id}`, dto);
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

  delete: (id: string): Promise<void> =>
    apiClient.delete<void>(`/administration/users/${id}`),
    
  bulkUpdate: (ids: string[], data: Partial<User>): Promise<void> => {
    const dto = userAdapter.toUpdateDTO(data);
    return apiClient.post<void>('/administration/users/bulk-update', { ids, ...dto });
  },
  
  bulkDelete: (ids: string[]): Promise<void> => 
    apiClient.post<void>('/administration/users/bulk-delete', { ids }),
};

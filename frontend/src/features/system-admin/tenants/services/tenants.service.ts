'use client';

import { apiClient } from '@/lib/api/client';

// System Admin only — cross-tenant operations
export const tenantApiService = {
  create: (data: {
    name: string;
    industry: string;
    companySize: string;
    plan: 'STARTER' | 'PRO' | 'ENTERPRISE';
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
    address?: string;
  }) => apiClient.post<{ success: boolean; data: unknown }>('/admin/tenants', data),

  getAll: (params?: { page?: number; status?: string; plan?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.status) query.set('status', params.status);
    if (params?.plan) query.set('plan', params.plan);
    return apiClient.get<{ success: boolean; data: unknown[] }>(`/admin/tenants?${query.toString()}`);
  },

  getById: (id: string) =>
    apiClient.get<{ success: boolean; data: unknown }>(`/admin/tenants/${id}`),

  approve: (id: string) =>
    apiClient.post<{ success: boolean }>(`/admin/tenants/${id}/approve`, {}),

  reject: (id: string, reason: string) =>
    apiClient.post<{ success: boolean }>(`/admin/tenants/${id}/reject`, { reason }),

  activate: (id: string) =>
    apiClient.patch<{ success: boolean }>(`/admin/tenants/${id}/activate`, {}),

  deactivate: (id: string) =>
    apiClient.patch<{ success: boolean }>(`/admin/tenants/${id}/deactivate`, {}),

  sendPasswordReset: (userId: string) =>
    apiClient.post<{ success: boolean }>(`/admin/users/${userId}/password-reset`, {}),
};

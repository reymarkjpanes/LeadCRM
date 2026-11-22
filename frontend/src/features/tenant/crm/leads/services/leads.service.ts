'use client';

import { apiClient } from '@/lib/api/client';
import type { PaginatedResponse, ApiResponse, LeadRead, LeadCompanyOptions, LeadCompanyOptionsQuery } from '@leadcrm/shared';
import type { CreateLeadRequest, UpdateLeadRequest } from '@/store/types/lead.types';

export interface LeadQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  archived?: boolean;
}

/**
 * leadsService — all API calls for the leads domain.
 *
 * Used by DataContext when NEXT_PUBLIC_USE_MOCK_DATA=false.
 * In mock mode, DataContext uses localStorage directly.
 *
 * To migrate: set NEXT_PUBLIC_USE_MOCK_DATA=false in .env.local
 * and ensure the backend is running with `npm run dev` in /backend.
 */
export const leadsService = {
  getAll: (params?: LeadQueryParams, signal?: AbortSignal): Promise<PaginatedResponse<LeadRead>> => {
    const query = new URLSearchParams();
    if (params?.page)     query.set('page',     String(params.page));
    if (params?.limit)    query.set('limit',    String(params.limit));
    if (params?.status)   query.set('status',   params.status);
    if (params?.search)   query.set('search',   params.search);
    if (params?.archived) query.set('archived', 'true');
    const qs = query.toString();
    // canonical path: /crm/leads
    return apiClient.get<PaginatedResponse<LeadRead>>(`/crm/leads${qs ? `?${qs}` : ''}`, { signal });
  },

  getById: (id: string): Promise<ApiResponse<LeadRead>> =>
    apiClient.get<ApiResponse<LeadRead>>(`/crm/leads/${id}`),

  getCompanyOptions: ({ search = '', source = 'both' }: LeadCompanyOptionsQuery, signal?: AbortSignal) => {
    const query = new URLSearchParams({ search, source });
    return apiClient.get<ApiResponse<LeadCompanyOptions>>(`/crm/leads/company-options?${query}`, { signal });
  },

  create: (data: CreateLeadRequest): Promise<ApiResponse<LeadRead>> =>
    apiClient.post<ApiResponse<LeadRead>>('/crm/leads', data),

  update: (id: string, data: UpdateLeadRequest): Promise<ApiResponse<LeadRead>> =>
    apiClient.put<ApiResponse<LeadRead>>(`/crm/leads/${id}`, data),

  archive: (id: string): Promise<void> =>
    apiClient.patch<void>(`/crm/leads/${id}/archive`),
  restore: (id: string): Promise<void> =>
    apiClient.patch<void>(`/crm/leads/${id}/restore`),
};

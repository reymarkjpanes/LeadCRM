'use client';

import { apiClient } from '@/lib/api/client';

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  industry?: string;
  size?: string;
  website?: string;
  tags: string[];
  address?: string;
  city?: string;
  province?: string;
  country: string;
  isArchived: boolean;
  assignedUserId?: string;
  assignedUser?: { id: string; firstName: string; lastName: string };
  _count?: { contacts: number; deals: number };
  createdAt: string;
  updatedAt: string;
}

export interface CompaniesResponse {
  success: boolean;
  data: Company[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

export interface CompanyResponse {
  success: boolean;
  data: Company;
}

function buildQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const companiesApi = {
  list: (query: Record<string, unknown> = {}) =>
    apiClient.get<CompaniesResponse>(`/crm/accounts${buildQuery(query)}`),

  get: (id: string) =>
    apiClient.get<CompanyResponse>(`/crm/accounts/${id}`),

  create: (data: Partial<Company>) =>
    apiClient.post<CompanyResponse>('/crm/accounts', data),

  update: (id: string, data: Partial<Company>) =>
    apiClient.put<CompanyResponse>(`/crm/accounts/${id}`, data),

  archive: (id: string) =>
    apiClient.patch<{ success: boolean }>(`/crm/accounts/${id}/archive`),
};

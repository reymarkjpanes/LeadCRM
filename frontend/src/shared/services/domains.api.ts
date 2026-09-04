'use client';

import { apiClient } from '@/lib/api/client';

export interface TenantDomain {
  id: string;
  tenantId: string;
  domain: string;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDomainSettings {
  id: string | null;
  tenantId: string;
  restrictToEmailDomains: boolean;
  joinPolicy: 'instantly' | 'after_approval';
  defaultRole: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ApiResult<T> {
  success: boolean;
  data: T;
}

export const domainsApi = {
  getAll: (): Promise<ApiResult<TenantDomain[]>> =>
    apiClient.get('/administration/domains'),

  create: (domain: string): Promise<ApiResult<TenantDomain>> =>
    apiClient.post('/administration/domains', { domain }),

  remove: (id: string): Promise<void> =>
    apiClient.delete(`/administration/domains/${id}`),

  verify: (id: string): Promise<ApiResult<TenantDomain>> =>
    apiClient.post(`/administration/domains/${id}/verify`, {}),

  getSettings: (): Promise<ApiResult<TenantDomainSettings>> =>
    apiClient.get('/administration/domain-settings'),

  updateSettings: (data: {
    restrictToEmailDomains: boolean;
    joinPolicy: 'instantly' | 'after_approval';
    defaultRole: string;
  }): Promise<ApiResult<TenantDomainSettings>> =>
    apiClient.put('/administration/domain-settings', data),
};

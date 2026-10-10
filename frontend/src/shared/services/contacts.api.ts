'use client';

import { LEAD_STATUSES } from '@leadcrm/shared';
import { apiClient } from '@/lib/api/client';
import type { Contact } from '@/store/types';

export interface ContactsResponse {
  success: boolean;
  data: Contact[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

export interface ContactResponse {
  success: boolean;
  data: Contact;
}

export interface ContactListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  archived?: boolean;
  assignedUserId?: string;
}

function buildQuery(params: ContactListQuery): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

const leadPayload = (data: Partial<Contact>) => ({ ...data, ...(data.status ? { status: LEAD_STATUSES.find(status => status.toUpperCase() === data.status?.toUpperCase()) ?? data.status } : {}) });

export const contactsApi = {
  list: (query: ContactListQuery = {}) =>
    apiClient.get<ContactsResponse>(`/crm/leads${buildQuery(query)}`),

  get: (id: string) =>
    apiClient.get<ContactResponse>(`/crm/leads/${id}`),

  create: (data: Partial<Contact>) =>
    apiClient.post<ContactResponse>('/crm/leads', leadPayload(data)),

  update: (id: string, data: Partial<Contact>) =>
    apiClient.put<ContactResponse>(`/crm/leads/${id}`, leadPayload(data)),

  archive: (id: string) =>
    apiClient.patch<{ success: boolean }>(`/crm/leads/${id}/archive`),

  convert: (id: string, data: {
    organizationId?: string;
    organizationName?: string;
    createDeal?: boolean;
    dealTitle?: string;
    dealValue?: number;
    dealPipelineId?: string;
    dealPriority?: 'LOW' | 'MEDIUM' | 'HIGH';
  }) =>
    apiClient.post<{ success: boolean; data: { contact: Contact; organization: unknown; deal: unknown } }>(`/crm/leads/${id}/convert`, data),
};

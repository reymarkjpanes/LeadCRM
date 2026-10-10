/**
 * contacts-v2.api.ts — HTTP client for the Contact table (/crm/contacts).
 *
 * This service targets the Contact entity (contacts-v2 backend module).
 * It is distinct from contacts.api.ts which serves the Lead table (/crm/leads).
 *
 * ADR-001: Contact.accountId is the canonical company link post-consolidation.
 */
import { apiClient } from '@/lib/api/client';
import type { Contact } from '@/store/types';

export interface ContactsV2Response {
  success: boolean;
  data: Contact[];
  meta: { total: number; page: number; limit: number; hasMore: boolean; facets?: Record<string, number> };
}

export interface ContactV2Response {
  success: boolean;
  data: Contact;
}

export interface ContactV2Query {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  assignedUserId?: string;
  accountId?: string;
  archived?: boolean;
  sort?: string;
  filters?: import('@leadcrm/shared').FilterCondition[];
}

/** Contact screens still use display aliases; the Contact API uses canonical columns. */
export function toContactWrite(data: Partial<Contact>): Record<string, unknown> {
  const { companyName, leadSource, organizationId, productInterest, ...payload } = data;
  return {
    ...payload,
    ...(companyName !== undefined ? { company: companyName } : {}),
    ...(leadSource !== undefined ? { source: leadSource } : {}),
    ...(organizationId !== undefined && data.accountId === undefined ? { accountId: organizationId || null } : {}),
    ...(productInterest !== undefined && data.productInterests === undefined ? { productInterests: productInterest } : {}),
  };
}

function contactDisplay(data: Contact): Contact {
  const contact = data as Contact & { company?: string };
  return { ...contact, companyName: contact.company ?? contact.companyName,
    leadSource: contact.source ?? contact.leadSource, organizationId: contact.accountId ?? contact.organizationId };
}

const contactResponse = (response: ContactV2Response): ContactV2Response => ({ ...response, data: contactDisplay(response.data) });

export const contactsV2Api = {
  list: (query: ContactV2Query = {}, signal?: AbortSignal): Promise<ContactsV2Response> => {
    const params: Record<string, unknown> = {};
    if (query.archived !== undefined) params['archived'] = query.archived;
    if (query.page !== undefined) params['page'] = query.page;
    if (query.limit !== undefined) params['limit'] = query.limit;
    if (query.search) params['search'] = query.search;
    if (query.status) params['status'] = query.status;
    if (query.assignedUserId) params['assignedUserId'] = query.assignedUserId;
    if (query.accountId) params['accountId'] = query.accountId;
    if (query.sort) params['sort'] = query.sort;
    for (const filter of query.filters ?? []) {
      const value = Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value ?? '');
      params[`filter[${filter.field}]`] = `${filter.operator}:${value}`;
    }
    return apiClient.get<ContactsV2Response>('/crm/contacts', { params, signal }).then(response => ({ ...response, data: response.data.map(contactDisplay) }));
  },

  get: (id: string, signal?: AbortSignal): Promise<ContactV2Response> =>
    apiClient.get<ContactV2Response>(`/crm/contacts/${encodeURIComponent(id)}`, { signal }).then(contactResponse),

  create: (data: Partial<Contact>): Promise<ContactV2Response> =>
    apiClient.post<ContactV2Response>('/crm/contacts', toContactWrite(data)).then(contactResponse),

  update: (id: string, data: Partial<Contact>): Promise<ContactV2Response> =>
    apiClient.put<ContactV2Response>(`/crm/contacts/${id}`, toContactWrite(data)).then(contactResponse),

  archive: (id: string): Promise<{ success: boolean }> =>
    apiClient.patch<{ success: boolean }>(`/crm/contacts/${id}/archive`, {}),
  restore: (id: string): Promise<void> =>
    apiClient.patch<void>(`/crm/contacts/${id}/restore`),
};

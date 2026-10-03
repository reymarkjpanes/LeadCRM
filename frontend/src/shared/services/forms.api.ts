'use client';

import { apiClient } from '@/lib/api/client';
import type {
  FormRecord,
  FormField,
  FormDesign,
  FormSettings,
} from '@/features/tenant/marketing/forms/types/form.types';

// ─── Response Contracts ───────────────────────────────────────────────────────

export interface FormsListResponse {
  success: boolean;
  data:    FormRecord[];
  meta:    { total: number; page: number; limit: number; hasMore: boolean };
}

export interface FormResponse {
  success: boolean;
  data:    FormRecord;
}

// ─── Update payload — only what can change after creation ────────────────────

export interface UpdateFormPayload {
  revision: number;
  name?:     string;
  fields?:   FormField[];
  design?:   FormDesign;
  settings?: FormSettings;
}

// ─── API Client ───────────────────────────────────────────────────────────────

export const formsApi = {
  /**
   * List all non-archived forms for the authenticated tenant.
   * Backend returns newest-first, paginated (default limit 20).
   */
  list: (page = 1) =>
    apiClient.get<FormsListResponse>(`/marketing/forms?page=${page}&limit=100`),
  duplicate: (id: string) => apiClient.post<FormResponse>(`/marketing/forms/${id}/duplicate`, {}),
  submissions: (id: string, page = 1) => apiClient.get<{ data: import('@leadcrm/shared').FormSubmissionRecord[]; meta: { hasMore: boolean } }>(`/marketing/forms/${id}/submissions?page=${page}&limit=20`),

  /**
   * Fetch a single form by id.
   * Throws 404 via the API client if not found or cross-tenant.
   */
  getById: (id: string) =>
    apiClient.get<FormResponse>(`/marketing/forms/${id}`),

  /**
   * Create a new draft form with the given name.
   * Backend persists an independent Contact Us template.
   */
  create: (name: string) =>
    apiClient.post<FormResponse>('/marketing/forms', { name }),

  /**
   * Partial update — send only changed fields.
   * Accepts name, fields array, design object, or settings object individually.
   */
  update: (id: string, payload: UpdateFormPayload) =>
    apiClient.put<FormResponse>(`/marketing/forms/${id}`, payload),

  /**
   * Publish a form — transitions status from draft → published.
   */
  publish: (id: string) =>
    apiClient.patch<FormResponse>(`/marketing/forms/${id}/publish`),

  delete: (id: string) => apiClient.delete<{ success: boolean }>(`/marketing/forms/${id}`),
  unpublish: (id: string) => apiClient.patch<FormResponse>(`/marketing/forms/${id}/unpublish`),
};

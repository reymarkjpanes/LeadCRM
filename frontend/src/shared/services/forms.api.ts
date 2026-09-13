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
  list: () =>
    apiClient.get<FormsListResponse>('/marketing/forms'),

  /**
   * Fetch a single form by id.
   * Throws 404 via the API client if not found or cross-tenant.
   */
  getById: (id: string) =>
    apiClient.get<FormResponse>(`/marketing/forms/${id}`),

  /**
   * Create a new draft form with the given name.
   * Fields / design / settings start empty and are populated via update().
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

  /**
   * Soft-delete — marks the form as archived (isArchived = true).
   * Returns 204 No Content on success.
   */
  archive: (id: string) =>
    apiClient.patch<void>(`/marketing/forms/${id}/archive`),
};

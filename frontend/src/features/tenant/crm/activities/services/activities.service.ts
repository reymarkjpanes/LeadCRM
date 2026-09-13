'use client';

import { apiClient } from '@/lib/api/client';
import type { PaginatedResponse, ApiResponse } from '@leadcrm/shared';

// ─── Response type ────────────────────────────────────────────────────────────
// The backend Activity row shape differs from the legacy frontend Activity type
// in shared.types.ts (which uses relatedToType/relatedToId).
// This interface reflects what GET /crm/activities actually returns.

export interface ActivityRecord {
  id:          string;
  tenantId:    string;
  type:        string;
  title:       string;
  description?: string;
  metadata?:   Record<string, unknown>;
  leadId?:     string | null;
  dealId?:     string | null;
  accountId?:  string | null;
  taskId?:     string | null;
  invoiceId?:  string | null;
  createdAt:   string;
  createdBy: {
    id:        string;
    firstName: string;
    lastName:  string;
    email:     string;
  };
}

// ─── Query params ─────────────────────────────────────────────────────────────

export interface ActivityQueryParams {
  page?:        number;
  limit?:       number;
  /** Filter to activities linked to a specific lead */
  leadId?:      string;
  /** Filter to activities linked to a specific deal */
  dealId?:      string;
  /** Filter to activities linked to a specific account */
  accountId?:   string;
  /** Filter to activities linked to a specific task */
  taskId?:      string;
  /** Filter by activity type (e.g. "call", "stage_change") */
  type?:        string;
  /** Filter by the user who created the activity */
  createdById?: string;
  /** ISO date string — return activities on or after this date */
  dateFrom?:    string;
  /** ISO date string — return activities on or before this date */
  dateTo?:      string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const activitiesService = {
  getAll: (params?: ActivityQueryParams): Promise<PaginatedResponse<ActivityRecord>> => {
    const query = new URLSearchParams();
    if (params?.page)        query.set('page',        String(params.page));
    if (params?.limit)       query.set('limit',       String(params.limit));
    if (params?.leadId)      query.set('leadId',      params.leadId);
    if (params?.dealId)      query.set('dealId',      params.dealId);
    if (params?.accountId)   query.set('accountId',   params.accountId);
    if (params?.taskId)      query.set('taskId',      params.taskId);
    if (params?.type)        query.set('type',        params.type);
    if (params?.createdById) query.set('createdById', params.createdById);
    if (params?.dateFrom)    query.set('dateFrom',    params.dateFrom);
    if (params?.dateTo)      query.set('dateTo',      params.dateTo);
    const qs = query.toString();
    return apiClient.get<PaginatedResponse<ActivityRecord>>(`/crm/activities${qs ? `?${qs}` : ''}`);
  },

  getById: (id: string): Promise<ApiResponse<ActivityRecord>> =>
    apiClient.get<ApiResponse<ActivityRecord>>(`/crm/activities/${id}`),

  create: (data: Omit<ActivityRecord, 'id' | 'tenantId' | 'createdAt' | 'createdBy'>): Promise<ApiResponse<ActivityRecord>> =>
    apiClient.post<ApiResponse<ActivityRecord>>('/crm/activities', data),

  update: (id: string, data: Partial<ActivityRecord>): Promise<ApiResponse<ActivityRecord>> =>
    apiClient.put<ApiResponse<ActivityRecord>>(`/crm/activities/${id}`, data),

  delete: (id: string): Promise<void> =>
    apiClient.delete<void>(`/crm/activities/${id}`),
};

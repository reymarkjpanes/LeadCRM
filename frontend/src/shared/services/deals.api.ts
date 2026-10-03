'use client';

import { apiClient } from '@/lib/api/client';
import type { Deal } from '@/store/types';
import type { ClosedWonConfirmation } from '@leadcrm/shared';

export interface DealsResponse {
  success: boolean;
  data: Deal[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

export interface DealResponse {
  success: boolean;
  data: Deal & {
    stageHistories?: Array<{
      id: string; movedAt: string; note?: string;
      newStage: { id: string; name: string };
      previousStage?: { id: string; name: string };
      movedBy: { id: string; firstName: string; lastName: string };
    }>;
  };
}

export interface MoveDealStagePayload {
  confirmation?: ClosedWonConfirmation;
  stageId: string;
  note?: string;
  lostReason?: string;
}

function buildQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const dealsApi = {
  list: (query: Record<string, unknown> = {}) =>
    apiClient.get<DealsResponse>(`/crm/deals${buildQuery(query)}`),

  get: (id: string) =>
    apiClient.get<DealResponse>(`/crm/deals/${id}`),

  create: (data: Partial<Deal> & { contactIds?: string[] }) =>
    apiClient.post<DealResponse>('/crm/deals', data),

  update: (id: string, data: Partial<Deal>) =>
    apiClient.put<DealResponse>(`/crm/deals/${id}`, data),

  moveStage: (id: string, payload: MoveDealStagePayload) =>
    apiClient.patch<DealResponse>(`/crm/deals/${id}/stage`, payload),

  archive: (id: string, archiveReason?: string) =>
    apiClient.patch<{ success: boolean }>(`/crm/deals/${id}/archive`, { archiveReason }),
};

'use client';

import { apiClient } from '@/lib/api/client';
import type { ApiResponse, PaginatedResponse, ClosedWonConfirmation } from '@leadcrm/shared';
import type { Deal, Pipeline } from '@/store/types';

export const pipelineService = {
  getPipelines: (): Promise<PaginatedResponse<Pipeline>> =>
    apiClient.get<PaginatedResponse<Pipeline>>('/crm/pipelines'),

  getDeals: (pipelineId?: string, limit?: number): Promise<PaginatedResponse<Deal>> => {
    const params = new URLSearchParams();
    if (pipelineId) params.set('pipelineId', pipelineId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get<PaginatedResponse<Deal>>(`/crm/deals${qs}`);
  },

  createDeal: (data: Partial<Deal>): Promise<ApiResponse<Deal>> =>
    apiClient.post<ApiResponse<Deal>>('/crm/deals', data),

  updateDeal: (id: string, data: Partial<Deal>): Promise<ApiResponse<Deal>> =>
    apiClient.put<ApiResponse<Deal>>(`/crm/deals/${id}`, data),

  moveDealStage: (id: string, data: { stageId: string; note?: string; lostReason?: string; handoff?: any; confirmation?: ClosedWonConfirmation }): Promise<ApiResponse<Deal>> =>
    apiClient.patch<ApiResponse<Deal>>(`/crm/deals/${id}/stage`, data),

  archiveDeal: (id: string): Promise<void> =>
    apiClient.patch<void>(`/crm/deals/${id}/archive`),

  reorderDeals: (deals: Array<{ id: string; order: number; stageId: string }>): Promise<void> =>
    apiClient.patch<void>('/crm/deals/reorder', { deals }),

  createPipeline: (data: any): Promise<ApiResponse<Pipeline>> =>
    apiClient.post<ApiResponse<Pipeline>>('/crm/pipelines', data),

  updatePipeline: (id: string, data: any): Promise<ApiResponse<Pipeline>> =>
    apiClient.put<ApiResponse<Pipeline>>(`/crm/pipelines/${id}`, data),

  deletePipeline: (id: string): Promise<void> =>
    apiClient.delete<void>(`/crm/pipelines/${id}`),

  archivePipeline: (id: string): Promise<void> =>
    apiClient.patch<void>(`/crm/pipelines/${id}/archive`),

  // ── Stage CRUD ────────────────────────────────────────
  createStage: (data: { pipelineId: string; name: string; order: number; probability?: number; color?: string; isWon?: boolean; isLost?: boolean; isDefault?: boolean; requiredFields?: string[]; rottenAfterDays?: number }): Promise<ApiResponse<any>> =>
    apiClient.post<ApiResponse<any>>('/crm/stages', data),

  updateStage: (id: string, data: { name?: string; order?: number; probability?: number; color?: string; isWon?: boolean; isLost?: boolean; isDefault?: boolean; requiredFields?: string[]; rottenAfterDays?: number }): Promise<ApiResponse<any>> =>
    apiClient.put<ApiResponse<any>>(`/crm/stages/${id}`, data),

  deleteStage: (id: string): Promise<void> =>
    apiClient.delete<void>(`/crm/stages/${id}`),

  reorderStages: (pipelineId: string, stageIds: string[]): Promise<ApiResponse<Pipeline>> =>
    apiClient.patch<ApiResponse<Pipeline>>(`/crm/pipelines/${pipelineId}/stages/reorder`, { stageIds }),

  // ── Pipeline Templates ────────────────────────────────
  getTemplates: (): Promise<ApiResponse<any[]>> =>
    apiClient.get<ApiResponse<any[]>>('/crm/pipeline-templates'),
};

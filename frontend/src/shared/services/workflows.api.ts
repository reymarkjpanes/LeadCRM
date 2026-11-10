'use client';
import { apiClient } from '@/lib/api/client';
import type { Workflow, WorkflowDraft, WorkflowExecutionRun, WorkflowExecutionView, WorkflowTestResult, ActionDefinition, TriggerDefinition, WorkflowOptions, WorkflowListQuery, PaginatedResponse } from '@leadcrm/shared';
export type { ActionDefinition, TriggerDefinition } from '@leadcrm/shared';
export interface WorkflowsResponse { success: boolean; data: Workflow[]; meta: { total: number; page: number; limit: number; hasMore: boolean }; }
export interface WorkflowResponse { success: boolean; data: Workflow; }
export type WorkflowExecutionsResponse = PaginatedResponse<WorkflowExecutionRun>;
export function withWorkflowTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([request, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The request timed out. Check your connection and retry.')), 30000);
  })]).finally(() => clearTimeout(timer));
}
export const workflowsApi = {
  saveDraft: (id: string, draft: WorkflowDraft, expectedDraftRevision: number, expectedVersion: number) => apiClient.put<WorkflowResponse>(`/automation/workflows/${id}/draft`, { draft, expectedDraftRevision, expectedVersion }),
  publishDraft: (id: string, draft: WorkflowDraft, expectedDraftRevision: number, expectedVersion: number) => apiClient.post<WorkflowResponse>(`/automation/workflows/${id}/publish`, { draft, expectedDraftRevision, expectedVersion }),
  versions: (id: string) => apiClient.get<{ success: boolean; data: Array<{ version: number; createdAt: string; activatedById: string | null; definition: WorkflowDraft }> }>(`/automation/workflows/${id}/versions`),
  restoreVersion: (id: string, version: number, expectedDraftRevision: number, expectedVersion: number) => apiClient.post<WorkflowResponse>(`/automation/workflows/${id}/versions/${version}/restore`, { expectedDraftRevision, expectedVersion }),
  duplicate: (id: string) => apiClient.post(`/automation/workflows/${id}/duplicate`, {}),
  nameAvailability: (name: string, excludeId?: string) => apiClient.get<{success:boolean;data:{available:boolean;suggestedName?:string}}>(`/automation/workflow-name-availability?${new URLSearchParams({ name, ...(excludeId ? { excludeId } : {}) })}`),
  options: (signal?: AbortSignal) => apiClient.get<{success:boolean;data:WorkflowOptions}>('/automation/workflow-options', { signal }),
  listAll: async (): Promise<Workflow[]> => {
    const rows: Workflow[] = [];
    for (let page = 1; ; page++) {
      const result = await workflowsApi.list({ page, limit: 100 });
      rows.push(...result.data);
      if (!result.meta.hasMore) return rows;
    }
  },
  list: (query: WorkflowListQuery = {}) => apiClient.get<WorkflowsResponse>(`/automation/workflows?${new URLSearchParams(Object.entries(query).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]))}`),
  get: (id: string, signal?: AbortSignal) => apiClient.get<WorkflowResponse>(`/automation/workflows/${id}`, { signal }),
  create: (draft: WorkflowDraft) => apiClient.post<WorkflowResponse>('/automation/workflows', draft),
  validate: (draft: WorkflowDraft, workflowId?: string) => apiClient.post<{success:boolean;data:{valid:boolean;message:string}}>('/automation/workflows/validate', { ...draft, ...(workflowId ? { workflowId } : {}) }),
  getExecution: (id: string, executionId: string) => apiClient.get<{success:boolean;data:WorkflowExecutionRun}>(`/automation/workflows/${id}/executions/${executionId}`),
  update: (id: string, draft: Partial<WorkflowDraft>) => apiClient.put<WorkflowResponse>(`/automation/workflows/${id}`, draft),
  toggle: (id: string, isActive: boolean) => apiClient.patch<WorkflowResponse>(`/automation/workflows/${id}/toggle`, { isActive }),
  archive: (id: string) => apiClient.patch<{success:boolean}>(`/automation/workflows/${id}/archive`),
  getExecutions: (id: string, page = 1, limit = 25, view: WorkflowExecutionView = 'all', signal?: AbortSignal) => apiClient.get<WorkflowExecutionsResponse>(`/automation/workflows/${id}/executions?page=${page}&limit=${limit}&view=${view}`, { signal }),
  test: (id: string, entityId: string, stageHistoryId?: string) => withWorkflowTimeout(apiClient.post<{ success:boolean; data:WorkflowTestResult }>(`/automation/workflows/${id}/test`, { entityId, useDraft: true, ...(stageHistoryId ? { stageHistoryId } : {}) })),
  getActions: () => apiClient.get<{success:boolean;data:ActionDefinition[]}>('/automation/actions'),
  getTriggers: () => apiClient.get<{success:boolean;data:TriggerDefinition[]}>('/automation/triggers'),
};
const metadataRequests = new Map<string, Promise<{ triggers: TriggerDefinition[]; actions: ActionDefinition[] }>>();
export function getWorkflowMetadata(scope: string) {
  let request = metadataRequests.get(scope);
  if (!request) {
    let timer: ReturnType<typeof setTimeout>;
    request = Promise.race([
      Promise.all([workflowsApi.getTriggers(), workflowsApi.getActions()]).then(([triggers, actions]) => ({ triggers: triggers.data, actions: actions.data })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Workflow metadata timed out. Retry to reconnect.')), 25000); }),
    ]).finally(() => { clearTimeout(timer); metadataRequests.delete(scope); });
    metadataRequests.set(scope, request);
  }
  return request;
}

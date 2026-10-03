'use client';
import { apiClient } from '@/lib/api/client';
import type { Workflow, WorkflowDraft, WorkflowExecutionRun, WorkflowTestResult, ActionDefinition, TriggerDefinition, WorkflowOptions, WorkflowListQuery } from '@leadcrm/shared';
export type { ActionDefinition, TriggerDefinition } from '@leadcrm/shared';
export interface WorkflowsResponse { success: boolean; data: Workflow[]; meta: { total: number; page: number; limit: number; hasMore: boolean }; }
export interface WorkflowResponse { success: boolean; data: Workflow; }
export interface WorkflowExecutionsResponse { success: boolean; data: WorkflowExecutionRun[]; }
export const workflowsApi = {
  duplicate: (id: string) => apiClient.post(`/automation/workflows/${id}/duplicate`, {}),
  nameAvailability: (name: string, excludeId?: string) => apiClient.get<{success:boolean;data:{available:boolean;suggestedName?:string}}>(`/automation/workflow-name-availability?${new URLSearchParams({ name, ...(excludeId ? { excludeId } : {}) })}`),
  options: () => apiClient.get<{success:boolean;data:WorkflowOptions}>('/automation/workflow-options'),
  listAll: async (): Promise<Workflow[]> => {
    const rows: Workflow[] = [];
    for (let page = 1; ; page++) {
      const result = await workflowsApi.list({ page, limit: 100 });
      rows.push(...result.data);
      if (!result.meta.hasMore) return rows;
    }
  },
  list: (query: WorkflowListQuery = {}) => apiClient.get<WorkflowsResponse>(`/automation/workflows?${new URLSearchParams(Object.entries(query).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]))}`),
  get: (id: string) => apiClient.get<WorkflowResponse>(`/automation/workflows/${id}`),
  create: (draft: WorkflowDraft) => apiClient.post<WorkflowResponse>('/automation/workflows', draft),
  validate: (draft: WorkflowDraft) => apiClient.post<{success:boolean;data:{valid:boolean;message:string}}>('/automation/workflows/validate', draft),
  getExecution: (id: string, executionId: string) => apiClient.get<{success:boolean;data:WorkflowExecutionRun}>(`/automation/workflows/${id}/executions/${executionId}`),
  update: (id: string, draft: Partial<WorkflowDraft>) => apiClient.put<WorkflowResponse>(`/automation/workflows/${id}`, draft),
  toggle: (id: string, isActive: boolean) => apiClient.patch<WorkflowResponse>(`/automation/workflows/${id}/toggle`, { isActive }),
  archive: (id: string) => apiClient.patch<{success:boolean}>(`/automation/workflows/${id}/archive`),
  getExecutions: (id: string, page = 1) => apiClient.get<WorkflowExecutionsResponse>(`/automation/workflows/${id}/executions?page=${page}`),
  test: (id: string, entityId: string) => apiClient.post<{ success:boolean; data:WorkflowTestResult }>(`/automation/workflows/${id}/test`, { entityId }),
  getActions: () => apiClient.get<{success:boolean;data:ActionDefinition[]}>('/automation/actions'),
  getTriggers: () => apiClient.get<{success:boolean;data:TriggerDefinition[]}>('/automation/triggers'),
};
const metadataRequests = new Map<string, Promise<{ triggers: TriggerDefinition[]; actions: ActionDefinition[] }>>();
export function getWorkflowMetadata(scope: string) {
  let request = metadataRequests.get(scope);
  if (!request) {
    request = Promise.all([workflowsApi.getTriggers(), workflowsApi.getActions()]).then(([triggers, actions]) => ({ triggers: triggers.data, actions: actions.data }));
    metadataRequests.set(scope, request);
    request.catch(() => metadataRequests.delete(scope));
  }
  return request;
}

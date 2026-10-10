"use client";
import { apiClient } from "@/lib/api/client";
import type {
  TaskRecord,
  TaskPage,
  TaskSummary,
  TaskListQuery,
  CreateTaskInput,
  UpdateTaskDto,
  TaskBulkInput,
  TaskBulkResult,
  TaskOptionKind,
  TaskOption,
} from "@leadcrm/shared";
export interface TasksResponse extends TaskPage {
  success: boolean;
}
export interface TaskResponse {
  success: boolean;
  data: TaskRecord;
}
export const tasksApi = {
  list: (query: TaskListQuery = {}) =>
    apiClient.get<TasksResponse>("/operations/tasks", { params: query }),
  summary: (query: TaskListQuery = {}) =>
    apiClient.get<{ success: boolean; data: TaskSummary }>(
      "/operations/tasks/summary",
      { params: query },
    ),
  options: (
    kind: TaskOptionKind,
    search = "",
    signal?: AbortSignal,
    leadIds: string[] = [],
  ) =>
    apiClient.get<{ success: boolean; data: TaskOption[] }>(
      "/operations/tasks/options",
      {
        params: {
          kind,
          search,
          ...(leadIds.length ? { leadIds: leadIds.join(",") } : {}),
        },
        signal,
      },
    ),
  get: (id: string) =>
    apiClient.get<TaskResponse>(`/operations/tasks/${encodeURIComponent(id)}`),
  create: (data: CreateTaskInput) =>
    apiClient.post<TaskResponse>("/operations/tasks", data),
  update: (id: string, data: UpdateTaskDto) =>
    apiClient.put<TaskResponse>(
      `/operations/tasks/${encodeURIComponent(id)}`,
      data,
    ),
  complete: (id: string) =>
    apiClient.patch<TaskResponse>(
      `/operations/tasks/${encodeURIComponent(id)}/complete`,
    ),
  archive: (id: string) =>
    apiClient.patch<{ success: boolean }>(
      `/operations/tasks/${encodeURIComponent(id)}/archive`,
    ),
  bulk: (data: TaskBulkInput) =>
    apiClient.post<{ success: boolean; data: TaskBulkResult }>(
      "/operations/tasks/bulk",
      data,
    ),
};

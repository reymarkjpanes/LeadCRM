'use client';

import { apiClient } from '@/lib/api/client';
import { useCachedPage } from './use-cached-page';
import type { ApiResponse, FilterCondition, ModulePaginatedResponse } from '@leadcrm/shared';

interface UseModuleDataParams {
  moduleId: string;
  page: number;
  pageSize: number;
  sort?: { field: string; direction: 'asc' | 'desc' } | null;
  filter?: FilterCondition[];
  search?: string;
  recordId?: string;
  disabled?: boolean;
}

const EMPTY_DATA: Record<string, unknown>[] = [];

/** Cache the response and its pagination metadata under the exact API query. */
export function useModuleData({ moduleId, page, pageSize, sort, filter, search, recordId, disabled }: UseModuleDataParams) {
  const params: Record<string, unknown> = { page: String(page), pageSize: String(pageSize) };
  if (sort) params.sort = `${sort.field}:${sort.direction}`;
  if (search?.trim()) params.search = search.trim();
  for (const condition of filter ?? []) {
    params[`filter[${condition.field}]`] = Array.isArray(condition.value)
      ? `${condition.operator}:${condition.value.join(',')}`
      : condition.value == null
        ? condition.operator
        : `${condition.operator}:${String(condition.value)}`;
  }
  const queryParams = recordId ? { recordId } : params;
  const result = useCachedPage<ModulePaginatedResponse<Record<string, unknown>>>({
    module: moduleId,
    disabled,
    params: queryParams,
    revalidateOnInvalidation: ['leads', 'contacts', 'accounts'].includes(moduleId),
    intervalMs: 60_000,
    fetchFn: async (signal) => {
      if (recordId) {
        // Resolve the selected record independently of list filters and pagination.
        const response = await apiClient.get<ApiResponse<Record<string, unknown>>>(
          `/crm/${moduleId}/${encodeURIComponent(recordId)}`, { signal },
        );
        const row = response.data;
        const data = row && !row.isArchived && !row.deletedAt ? [row] : [];
        return { success: true, data, meta: { page: 1, pageSize, total: data.length, totalPages: data.length } };
      }
      return apiClient.get<ModulePaginatedResponse<Record<string, unknown>>>(`/crm/${moduleId}`, { params, signal });
    },
  });
  return {
    data: result.data?.data ?? EMPTY_DATA,
    facets: (result.data as { facets?: Record<string, number> } | null)?.facets,
    meta: result.data?.meta ? {
      ...result.data.meta,
      pageSize: result.data.meta.pageSize ?? (result.data.meta as unknown as { limit: number }).limit,
      totalPages: Math.ceil(result.data.meta.total / (result.data.meta.pageSize ?? (result.data.meta as unknown as { limit: number }).limit)),
    } : null,
    isLoading: result.isInitialLoad || result.isRefreshing,
    isInitialLoad: result.isInitialLoad,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
  };
}

'use client';

import { useMemo, useCallback } from 'react';
import { useModuleData } from '@/shared/hooks/use-module-data';
import { toFrontendContact } from '@/lib/api/adapters/contact.adapter';
import { invalidatePageCache } from '@/shared/cache/page-cache';
import { useAuth } from '@/store/AuthContext';
import type { Contact } from '@/store/types';
import type { FilterCondition } from '@leadcrm/shared';
import type { SortPreference } from '@/shared/services/table-preferences.api';

export interface UseLeadsDataParams {
  page: number;
  pageSize: number;
  sort?: SortPreference | null;
  filter?: FilterCondition[];
  search?: string;
  recordId?: string;
}

export interface UseLeadsDataMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UseLeadsDataReturn {
  leads: Contact[];
  facets?: Record<string, number>;
  meta: UseLeadsDataMeta | null;
  isInitialLoad: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => void;
  invalidate: () => void;
}

export function useLeadsData(params: UseLeadsDataParams): UseLeadsDataReturn {
  const { tenant } = useAuth();
  const result = useModuleData({ moduleId: 'leads', ...params });
  const leads = useMemo(() => result.data.map(toFrontendContact) as Contact[], [result.data]);
  const invalidate = useCallback(() => {
    if (tenant?.id) invalidatePageCache('leads', tenant.id);
  }, [tenant?.id]);
  return {
    leads,
    facets: result.facets,
    meta: result.meta,
    isInitialLoad: result.isInitialLoad,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
    invalidate,
  };
}

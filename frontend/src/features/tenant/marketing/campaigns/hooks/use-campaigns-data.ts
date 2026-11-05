'use client';
import { useEffect, useState } from 'react';

import { useHasPermission } from '@/shared/hooks/use-permissions';
import { campaignsApi } from '@/shared/services/campaigns.api';
import { templatesApi } from '@/shared/services/templates.api';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import type { CampaignListQuery } from '@leadcrm/shared';
import type { Campaign, Template } from '@/store/types';

export interface UseCampaignsDataReturn {
  total: number;
  campaigns: Campaign[];
  templates: Template[];
  isInitialLoad: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCampaignsData(options?: { disabled?: boolean; intervalMs?: number; query?: CampaignListQuery }): UseCampaignsDataReturn {
  const canViewReports = useHasPermission('campaigns.view_reports');
  const [processing, setProcessing] = useState(false);
  const result = useCachedPage({
    module: 'campaigns',
    params: { canViewReports, ...options?.query, limit: options?.query?.limit ?? 25 },
    intervalMs: Math.min(options?.intervalMs ?? 7500, processing ? 2500 : 7500),
    pauseWhenHidden: true,
    revalidateOnInvalidation: true,
    disabled: options?.disabled ?? false,
    fetchFn: async () => {
      const [campaigns, templates] = await Promise.all([
        campaignsApi.list({ page: 1, limit: 25, ...options?.query }), templatesApi.list({ limit: 200 }),
      ]);
      return {
        total: campaigns.meta.total,
        campaigns: (campaigns.data ?? []).filter((c) => !c.isArchived),
        templates: (templates.data ?? []).filter((t) => !t.isArchived),
      };
    },
  });
  useEffect(() => { setProcessing(result.data?.campaigns.some(c => ['scheduled', 'sending'].includes(c.status?.toLowerCase())) ?? false); }, [result.data]);
  useEffect(() => {
    if (options?.disabled) return;
    const refresh = () => { if (!document.hidden) void result.refetchSilently(); };
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [options?.disabled, result.refetchSilently]);
  return { ...result, total: result.data?.total ?? 0, campaigns: result.data?.campaigns ?? [], templates: result.data?.templates ?? [] };
}

'use client';

import { useHasPermission } from '@/shared/hooks/use-permissions';
import { campaignsApi } from '@/shared/services/campaigns.api';
import { templatesApi } from '@/shared/services/templates.api';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import type { CampaignListQuery } from '@leadcrm/shared';
import type { Campaign, Template } from '@/store/types';

export interface UseCampaignsDataReturn {
  total: number;
  metrics: { activeCampaigns: number; sent: number; opened: number; clicked: number };
  campaigns: Campaign[];
  templates: Template[];
  isInitialLoad: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCampaignsData(options?: { disabled?: boolean; intervalMs?: number; query?: CampaignListQuery }): UseCampaignsDataReturn {
  const canViewReports = useHasPermission('campaigns.view_reports');
  const result = useCachedPage({
    module: 'campaigns',
    params: { canViewReports, ...options?.query, limit: options?.query?.limit ?? 25 },
    intervalMs: options?.intervalMs ?? 2 * 60_000,
    disabled: options?.disabled ?? false,
    fetchFn: async () => {
      const [campaigns, templates, metrics] = await Promise.all([
        campaignsApi.list({ page: 1, limit: 25, ...options?.query }), templatesApi.list({ limit: 200 }), canViewReports ? campaignsApi.metrics() : Promise.resolve({ data: { activeCampaigns: 0, sent: 0, opened: 0, clicked: 0 } }),
      ]);
      return {
        total: campaigns.meta.total,
        metrics: metrics.data,
        campaigns: (campaigns.data ?? []).filter((c) => !c.isArchived),
        templates: (templates.data ?? []).filter((t) => !t.isArchived),
      };
    },
  });
  return { ...result, total: result.data?.total ?? 0, metrics: result.data?.metrics ?? { activeCampaigns: 0, sent: 0, opened: 0, clicked: 0 }, campaigns: result.data?.campaigns ?? [], templates: result.data?.templates ?? [] };
}

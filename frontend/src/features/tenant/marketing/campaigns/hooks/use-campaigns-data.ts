'use client';

/**
 * useCampaignsData — route-scoped hook for the Campaigns page.
 *
 * Fetches campaigns AND templates together (both needed on the same page).
 * Uses the shared useRouteData primitive for SWR boilerplate.
 *
 * Mutations (addCampaign / updateCampaign / deleteCampaign / addTemplate /
 * updateTemplate / deleteTemplate) remain in DataContext because
 * campaign-builder.tsx and create-campaign-panel.tsx also call them.
 */

import { useState, useCallback } from 'react';
import { campaignsApi } from '@/shared/services/campaigns.api';
import { templatesApi } from '@/shared/services/templates.api';
import { useRouteData } from '@/shared/hooks/use-route-data';
import { USE_MOCK_DATA } from '@/lib/config';
import type { Campaign, Template } from '@/store/types';

export interface UseCampaignsDataReturn {
  campaigns:      Campaign[];
  templates:      Template[];
  isInitialLoad:  boolean;
  isRefreshing:   boolean;
  error:          string | null;
  refetch:        () => void;
}

const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes — campaigns change infrequently

export function useCampaignsData(): UseCampaignsDataReturn {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const fetchFn = useCallback(async (): Promise<void> => {
    const [campaignsRes, templatesRes] = await Promise.all([
      campaignsApi.list({ limit: 200 }),
      templatesApi.list({ limit: 200 }),
    ]);
    setCampaigns((campaignsRes?.data ?? []).filter((c: Campaign) => !c.isArchived));
    setTemplates((templatesRes?.data ?? []).filter((t: Template) => !t.isArchived));
  }, []);

  const { isFetching, hasLoadedOnce, error, refetch } = useRouteData({
    fetchFn,
    intervalMs: REFRESH_INTERVAL_MS,
    disabled:   USE_MOCK_DATA,
  });

  return {
    campaigns,
    templates,
    isInitialLoad: isFetching && !hasLoadedOnce,
    isRefreshing:  isFetching && hasLoadedOnce,
    error,
    refetch,
  };
}

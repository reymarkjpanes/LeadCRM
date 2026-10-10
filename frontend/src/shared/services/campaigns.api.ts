'use client';

import { apiClient } from '@/lib/api/client';
import type { Campaign as ApiCampaign, CampaignDetailResponse as ApiCampaignDetailResponse, CampaignReportResponse as ApiCampaignReportResponse, CreateCampaignInput, CampaignSendResult } from '@leadcrm/shared';
import type { Campaign } from '@/store/types';
import type { CampaignMetricsSummary, CampaignEmailSettings } from '@leadcrm/shared';

export interface CampaignsResponse { success: boolean; data: Campaign[]; meta: { total: number; page: number; limit: number; hasMore: boolean }; }
export interface CampaignResponse  { success: boolean; data: Campaign; }
export interface CampaignDetailResponse { success: boolean; data: Campaign & Pick<ApiCampaignDetailResponse['data'], 'sendResult'>; }
export interface CampaignReportResponse { success: boolean; data: Campaign & Omit<ApiCampaignReportResponse['data'], keyof ApiCampaign>; }

function buildQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  return q.toString() ? `?${q.toString()}` : '';
}

function normalize(c: ApiCampaign & { targetAudience?: { name: string }; deliveredCount?: number; bouncedCount?: number }): Campaign {
  return { ...c, type: c.type === 'EMAIL' ? 'Email' : c.type === 'SMS' ? 'Sms' : 'Multi-Channel',
    status: (c.status === 'DRAFT' ? 'Draft' : c.status.toLowerCase()) as Campaign['status'],
    targetAudience: c.targetAudience?.name || ({ LEADS: 'All Leads', CONTACTS: 'All Contacts', ALL: 'All Leads & Contacts' }[c.audienceSource || ''] ?? 'Not selected') };
}
export const campaignsApi = {
  emailSettings: () => apiClient.get<{ success: boolean; data: CampaignEmailSettings }>('/marketing/campaigns/email-settings'),
  smsSettings: () => apiClient.get<{ success: boolean; data: { organizationEmail: string | null } }>('/marketing/campaigns/sms-settings'),
  duplicate: (id: string) => apiClient.post('/marketing/campaigns/' + id + '/duplicate', {}),
  report: async (id: string, signal?: AbortSignal): Promise<CampaignReportResponse> => {
    const res = await apiClient.get<ApiCampaignReportResponse>('/marketing/campaigns/' + id + '/report', { signal });
    return { ...res, data: { ...res.data, ...normalize(res.data) } };
  },
  list: async (query: Record<string, unknown> = {}): Promise<CampaignsResponse> => {
    const res = await apiClient.get<{ success: boolean; data: ApiCampaign[]; meta: CampaignsResponse['meta'] }>(`/marketing/campaigns${buildQuery(query)}`);
    return { ...res, data: res.data.map(normalize) };
  },
  get: async (id: string): Promise<CampaignDetailResponse> => {
    const res = await apiClient.get<ApiCampaignDetailResponse>(`/marketing/campaigns/${id}`);
    return { ...res, data: { ...normalize(res.data), sendResult: res.data.sendResult } };
  },
  create: async (data: Partial<Campaign> | Partial<CreateCampaignInput>): Promise<CampaignResponse> => {
    const res = await apiClient.post<{ success: boolean; data: ApiCampaign }>('/marketing/campaigns', data);
    return { ...res, data: normalize(res.data) };
  },
  update: async (id: string, data: Partial<Campaign> | Partial<CreateCampaignInput>): Promise<CampaignResponse> => {
    const res = await apiClient.put<{ success: boolean; data: ApiCampaign }>(`/marketing/campaigns/${id}`, data);
    return { ...res, data: normalize(res.data) };
  },
  send: (id: string) => apiClient.patch<{ success: boolean; data: CampaignSendResult }>(`/marketing/campaigns/${id}/send`),
  metrics: () => apiClient.get<{ success: boolean; data: CampaignMetricsSummary }>('/marketing/campaigns/metrics'),
  archive: (id: string) => apiClient.patch<{ success: boolean }>(`/marketing/campaigns/${id}/archive`),
};

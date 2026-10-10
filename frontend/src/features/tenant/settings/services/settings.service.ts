'use client';

import { apiClient } from '@/lib/api/client';
import type { OrganizationSettings, UpdateOrganizationSettings } from '@leadcrm/shared';

export const settingsApiService = {
  getOrganization: (signal?: AbortSignal) => apiClient.get<{ success: boolean; data: OrganizationSettings }>('/administration/organization-settings', { signal }),
  updateOrganization: (data: UpdateOrganizationSettings) =>
    apiClient.patch<{ success: boolean; data: OrganizationSettings }>('/administration/organization-settings', data),
};

'use client';

import { apiClient } from '@/lib/api/client';

import type { NotificationsResponse, NotificationMutationResponse, NotificationPreferences, NotificationPreferencesResponse } from '@leadcrm/shared';
export type { NotificationRecord as Notification, NotificationsResponse } from '@leadcrm/shared';

export const notificationsApi = {
  list: (query: { page?: number; limit?: number; isRead?: boolean; cursor?: string; snapshot?: string } = {}) => {
    const q = new URLSearchParams();
    if (query.page)   q.set('page',   String(query.page));
    if (query.limit)  q.set('limit',  String(query.limit));
    if (query.isRead !== undefined) q.set('isRead', String(query.isRead));
    if (query.cursor) q.set('cursor', query.cursor);
    if (query.snapshot) q.set('snapshot', query.snapshot);
    const s = q.toString();
    return apiClient.get<NotificationsResponse>(`/notifications${s ? `?${s}` : ''}`);
  },

  markRead: (id: string) =>
    apiClient.patch<NotificationMutationResponse>(`/notifications/${encodeURIComponent(id)}/read`),

  markAllRead: (before?: string) =>
    apiClient.patch<NotificationMutationResponse>('/notifications/read-all', before ? { before } : {}),

  counts: () => apiClient.get<NotificationMutationResponse>('/notifications/counts'),
  destination: (id: string) => apiClient.get<{ success: boolean; destination: string | null }>(`/notifications/${encodeURIComponent(id)}/destination`),
  preferences: () => apiClient.get<NotificationPreferencesResponse>('/notifications/preferences'),
  savePreferences: (data: NotificationPreferences) => apiClient.put<NotificationPreferencesResponse>('/notifications/preferences', data),

  delete: (ids: string[]) =>
    apiClient.deleteWithBody<NotificationMutationResponse>('/notifications', { ids }),
};

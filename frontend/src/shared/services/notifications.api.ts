'use client';

import { apiClient } from '@/lib/api/client';

import type { NotificationsResponse } from '@leadcrm/shared';
export type { NotificationRecord as Notification, NotificationsResponse } from '@leadcrm/shared';

export const notificationsApi = {
  list: (query: { page?: number; limit?: number; isRead?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (query.page)   q.set('page',   String(query.page));
    if (query.limit)  q.set('limit',  String(query.limit));
    if (query.isRead !== undefined) q.set('isRead', String(query.isRead));
    const s = q.toString();
    return apiClient.get<NotificationsResponse>(`/notifications${s ? `?${s}` : ''}`);
  },

  markRead: (id: string) =>
    apiClient.patch<{ success: boolean }>(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.patch<{ success: boolean }>('/notifications/read-all'),
};

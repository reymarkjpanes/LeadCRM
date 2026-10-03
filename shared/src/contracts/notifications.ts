export interface NotificationRecord {
  id: string; tenantId: string; userId: string;
  type: string; title: string; body?: string | null;
  entityType?: string | null; entityId?: string | null;
  isRead: boolean; readAt?: string | null; createdAt: string;
}
export interface NotificationsResponse {
  success: boolean; data: NotificationRecord[]; unreadCount: number;
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

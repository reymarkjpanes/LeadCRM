import { z } from 'zod';

export interface NotificationRecord {
  id: string; tenantId: string; userId: string;
  type: string; title: string; body?: string | null;
  entityType?: string | null; entityId?: string | null;
  isRead: boolean; readAt?: string | null; createdAt: string;
  occurredAt?: string | null;
  available?: boolean;
}
export interface NotificationsResponse {
  success: boolean; data: NotificationRecord[]; unreadCount: number; totalCount: number;
  meta: { total: number; page: number; limit: number; hasMore: boolean; nextCursor?: string | null; snapshot?: string };
}
export const DeleteNotificationsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500).transform(ids => [...new Set(ids)]),
}).strict();

export interface NotificationMutationResponse {
  success: boolean;
  totalCount: number;
  unreadCount: number;
  readBefore?: string;
}

export const NotificationTypes = [
  'lead_assigned', 'contact_assigned', 'account_assigned', 'deal_assigned', 'task_assigned',
  'customer_hot', 'customer_cold', 'customer_cancelled', 'deal_progressed', 'deal_won', 'deal_lost',
  'closing_requirements_needed', 'closing_requirements_completed', 'task_due', 'task_overdue',
  'customer_reply', 'campaign_failed', 'workflow_failed', 'user_created', 'user_status_changed',
  'mailbox_disconnected', 'mailbox_sync_failed', 'form_processing_failed', 'record_archived', 'record_restored',
] as const;
export type NotificationType = typeof NotificationTypes[number];
export const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isRead: z.enum(['true', 'false']).optional(),
  unreadOnly: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(1024).optional(),
  snapshot: z.string().datetime().optional(),
}).strict();
export const NotificationPreferencesSchema = z.object({
  leadAssignmentEmail: z.literal(false),
  dailyPipelineBriefing: z.literal(false),
  urgentHotLeadSms: z.literal(false),
  inAppGeneral: z.boolean(),
}).strict();
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  leadAssignmentEmail: false, dailyPipelineBriefing: false, urgentHotLeadSms: false, inAppGeneral: true,
};
export interface NotificationPreferencesResponse {
  success: boolean;
  data: NotificationPreferences;
  availability: { leadAssignmentEmail: false; dailyPipelineBriefing: false; urgentHotLeadSms: false; inAppGeneral: true };
}

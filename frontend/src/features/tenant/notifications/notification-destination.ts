import type { NotificationRecord } from '@leadcrm/shared';

/** Only application-owned destinations; notification data cannot supply arbitrary URLs. */
export function notificationDestination(notification: Pick<NotificationRecord, 'entityType' | 'entityId'>): string | undefined {
  const paths: Record<string, string> = { Lead: '/crm/leads', Contact: '/crm/contacts', Account: '/crm/accounts', Deal: '/crm/deals' };
  if (notification.entityType && paths[notification.entityType] && notification.entityId) return `${paths[notification.entityType]}/${encodeURIComponent(notification.entityId)}`;
  if (notification.entityType === 'Task') return `/operations/taskboard?taskId=${encodeURIComponent(notification.entityId ?? '')}`;
  return ({ User: '/settings?tab=users', Workflow: '/automation/workflows', Campaign: '/marketing/campaigns', Mailbox: '/inbox', Form: '/settings?tab=forms' } as Record<string, string>)[notification.entityType ?? ''];
}

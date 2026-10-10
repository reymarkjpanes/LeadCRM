import { AlertCircle, Calendar, Clock, DollarSign, Mail, TrendingUp, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Notification } from '@/shared/services/notifications.api';
import { cn } from '@/lib/utils';

function notificationIcon(type: string) {
  switch (type) {
    case 'open_rate_update': case 'engagement_alert': return TrendingUp;
    case 'budget_alert': case 'ad_budget_update': return DollarSign;
    case 'scheduled_reminder': return Calendar;
    case 'new_leads': case 'lead_assigned': case 'contact_assigned': case 'account_assigned': case 'deal_assigned': case 'task_assigned': case 'user_created': case 'user_status_changed': return Users;
    case 'listing_expiring': case 'task_due': case 'task_overdue': return Clock;
    case 'approval_pending': case 'workflow_failed': case 'campaign_failed': case 'form_processing_failed':
    case 'mailbox_disconnected': case 'mailbox_sync_failed': case 'closing_requirements_needed': return AlertCircle;
    case 'customer_hot': case 'customer_cold': case 'customer_cancelled': case 'deal_won': case 'deal_lost': case 'deal_progressed': case 'closing_requirements_completed': return TrendingUp;
    default: return Mail;
  }
}

export function NotificationContent({ notification }: { notification: Notification }) {
  const Icon = notificationIcon(notification.type);
  return <>
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10',
      notification.isRead ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' : 'bg-blue-100 text-primary dark:bg-primary/15 dark:text-primary')}>
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className={cn('text-sm text-foreground [overflow-wrap:anywhere]', notification.isRead ? 'font-medium' : 'font-semibold')}>{notification.title}</span>
        {!notification.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread notification" />}
      </span>
      {notification.body && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{notification.body}</span>}
      <span className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        <time dateTime={notification.createdAt}>{formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}</time>
      </span>
    </span>
  </>;
}

export function NotificationEmptyState({ title = 'No notifications yet' }: { title?: string }) {
  return <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
    <Mail className="mb-3 h-12 w-12 text-slate-300 dark:text-slate-700" aria-hidden="true" />
    <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
    <p className="text-xs text-muted-foreground">When you receive notifications, they will appear here</p>
  </div>;
}

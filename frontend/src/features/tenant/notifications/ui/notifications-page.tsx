'use client';
import { useRouter } from 'next/navigation';

import React, { useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { 
  Mail, 
  TrendingUp, 
  AlertCircle, 
  DollarSign, 
  Calendar, 
  Users, 
  Clock, 
  CheckCheck, 
  X 
} from 'lucide-react';
import { notificationDestination } from '../notification-destination';
import { useNotifications } from '../hooks/use-notifications';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface NotificationItemProps {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  isRead: boolean;
  createdAt: string;
  onMarkRead: (id: string) => void;
}

function getNotificationIcon(type: string) {
  const iconClass = "w-5 h-5 text-white";
  switch (type) {
    case 'campaign_sent':
    case 'email_sent':
      return { icon: <Mail className={iconClass} />, bg: 'bg-blue-500' };
    case 'open_rate_update':
    case 'engagement_alert':
      return { icon: <TrendingUp className={iconClass} />, bg: 'bg-emerald-500' };
    case 'budget_alert':
    case 'ad_budget_update':
      return { icon: <DollarSign className={iconClass} />, bg: 'bg-amber-500' };
    case 'scheduled_reminder':
      return { icon: <Calendar className={iconClass} />, bg: 'bg-blue-500' };
    case 'new_leads':
    case 'deal_assigned':
      return { icon: <Users className={iconClass} />, bg: 'bg-blue-500' };
    case 'listing_expiring':
    case 'task_due':
      return { icon: <Clock className={iconClass} />, bg: 'bg-amber-500' };
    case 'approval_pending':
    case 'workflow_failed':
      return { icon: <AlertCircle className={iconClass} />, bg: 'bg-red-500' };
    default:
      return { icon: <Mail className={iconClass} />, bg: 'bg-slate-500' };
  }
}

function NotificationItem({ id, type, title, body, entityType, entityId, isRead, createdAt, onMarkRead }: NotificationItemProps) {
  const shouldReduce = useReducedMotion();
  const router = useRouter();
  const open = () => { if (!isRead) onMarkRead(id); const destination = notificationDestination({ entityType, entityId }); if (destination) router.push(destination); };
  const { icon, bg } = getNotificationIcon(type);
  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: shouldReduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: shouldReduce ? 1 : 0.97 }}
      transition={{ type: 'spring', damping: 30, stiffness: 280 }}
      className={cn(
        'group relative flex items-start gap-4 p-4 rounded-xl',
        'border transition-colors cursor-pointer',
        isRead
          ? 'bg-white dark:bg-white/[0.02] border-gray-200 dark:border-white/[0.05]'
          : 'bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20',
        'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
      )}
      onClick={open}
    >
      {/* Icon */}
      <div className={cn('shrink-0 w-10 h-10 rounded-full flex items-center justify-center', bg)}>
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className={cn(
          'text-sm font-semibold text-slate-900 dark:text-white mb-1',
          !isRead && 'font-bold'
        )}>
          {title}
        </h3>
        {body && (
          <p className="text-sm text-slate-600 dark:text-slate-400 [overflow-wrap:anywhere]">
            {body}
          </p>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-500 mt-1.5">
          {timeAgo}
        </p>
      </div>

      {/* Unread indicator */}
      {!isRead && (
        <div className="shrink-0 w-2 h-2 rounded-full bg-blue-500" aria-label="Unread notification" />
      )}
    </motion.div>
  );
}

interface NotificationGroupProps {
  title: string;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
    isRead: boolean;
    createdAt: string;
  }>;
  onMarkRead: (id: string) => void;
}

function NotificationGroup({ title, notifications, onMarkRead }: NotificationGroupProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {title}
      </h2>
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {notifications.map(notification => (
            <NotificationItem
              key={notification.id}
              {...notification}
              onMarkRead={onMarkRead}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function NotificationsSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map(group => (
        <div key={group} className="space-y-3">
          <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
          <div className="space-y-2">
            {[1, 2, 3].map(item => (
              <div 
                key={item} 
                className="flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05]"
              >
                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                  <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    isLoading,
    hasError,
    hasMore,
    markAsRead,
    markAllAsRead,
    loadMore,
    refresh,
  } = useNotifications();

  const groupedNotifications = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayNotifications = notifications.filter(n => new Date(n.createdAt) >= today);
    const yesterdayNotifications = notifications.filter(
      n => new Date(n.createdAt) >= yesterday && new Date(n.createdAt) < today
    );
    const olderNotifications = notifications.filter(n => new Date(n.createdAt) < yesterday);

    return { todayNotifications, yesterdayNotifications, olderNotifications };
  }, [notifications]);

  if (hasError) {
    return (
      <div className="min-h-screen bg-[#FAFBFC] dark:bg-[#030712] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">Failed to load notifications</p>
            <button
              onClick={refresh}
              className="mt-4 h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold active:scale-95 transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBFC] dark:bg-[#030712] p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Notifications
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              You have {unreadCount} notification{unreadCount !== 1 ? 's' : ''} today
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="h-9 px-4 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors flex items-center gap-2 active:scale-95"
                aria-label="Mark all as read"
              >
                <CheckCheck className="w-4 h-4" />
                Mark All Read
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading && notifications.length === 0 ? (
          <NotificationsSkeleton />
        ) : notifications.length === 0 ? (
          <div className="text-center py-12">
            <Mail className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              No notifications yet
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              When you receive notifications, they will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {groupedNotifications.todayNotifications.length > 0 && (
              <NotificationGroup
                title="Today"
                notifications={groupedNotifications.todayNotifications}
                onMarkRead={markAsRead}
              />
            )}
            {groupedNotifications.yesterdayNotifications.length > 0 && (
              <NotificationGroup
                title="Yesterday"
                notifications={groupedNotifications.yesterdayNotifications}
                onMarkRead={markAsRead}
              />
            )}
            {groupedNotifications.olderNotifications.length > 0 && (
              <NotificationGroup
                title="Older"
                notifications={groupedNotifications.olderNotifications}
                onMarkRead={markAsRead}
              />
            )}
          </div>
        )}

        {/* Load More */}
        {hasMore && (
          <div className="mt-8 text-center">
            <button
              onClick={loadMore}
              disabled={isLoading}
              className="h-9 px-6 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {isLoading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

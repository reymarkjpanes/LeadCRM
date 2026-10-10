'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, ChevronRight, Trash2 } from 'lucide-react';
import { notificationDestination, resolveNotificationDestination } from '../notification-destination';
import { useNotifications, type NotificationFilter } from '../hooks/use-notifications';
import { NotificationContent, NotificationEmptyState } from './notification-content';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, UnderlineTabTrigger } from '@/shared/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { cn } from '@/lib/utils';

const tabs = [
  { id: 'all', label: 'All', empty: 'No notifications yet' },
  { id: 'unread', label: 'Unread', empty: 'No unread notifications' },
  { id: 'read', label: 'Read', empty: 'No read notifications' },
] as const;

export default function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const { notifications, unreadCount, totalCount, isLoading, isMutating, hasError, hasMore, scope,
    markAsRead, markAllAsRead, deleteNotifications, loadMore, refresh } = useNotifications(filter);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<{ ids: string[]; bulk: boolean } | null>(null);
  const router = useRouter();
  const visibleSelection = selected.filter(id => notifications.some(n => n.id === id));
  const selectable = notifications.slice(0, 500);
  const allSelected = selectable.length > 0 && selectable.every(n => visibleSelection.includes(n.id));
  const counts = { all: totalCount, unread: unreadCount, read: Math.max(0, totalCount - unreadCount) };

  useEffect(() => { setSelected([]); setDeleting(null); }, [scope]);
  useEffect(() => { setSelected(prev => prev.every(id => notifications.some(n => n.id === id)) ? prev : prev.filter(id => notifications.some(n => n.id === id))); }, [notifications]);

  return <div className="min-h-full bg-[var(--background)] p-3 sm:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">{unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? ' needs' : 's need'} your attention.` : "You're all caught up."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!unreadCount || isMutating} onClick={() => void markAllAsRead()} aria-label="Mark all notifications as read"><CheckCheck className="text-blue-600" aria-hidden="true" />Mark all as read</Button>
        {visibleSelection.length > 0 && <Button variant="destructive" disabled={isMutating} onClick={() => setDeleting({ ids: visibleSelection, bulk: true })}><Trash2 aria-hidden="true" />Delete ({visibleSelection.length})</Button>}
      </div>
    </div>
    <Tabs defaultValue="all" value={filter} onValueChange={value => setFilter(value as NotificationFilter)}>
      <div onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); buttons[next].click();
      }}>
        <TabsList variant="underline" className="flex w-full gap-1 border-[#E4E9F0] dark:border-slate-700">
          {tabs.map(tab => <UnderlineTabTrigger key={tab.id} value={tab.id} badge={counts[tab.id]} className="px-3 py-2 text-[13px]">{tab.label}</UnderlineTabTrigger>)}
        </TabsList>
      </div>
      <TabsContent value={filter}>
        {hasError ? <div role="alert" className="py-12 text-center text-muted-foreground">Failed to load notifications.<Button variant="outline" className="ml-3" onClick={() => void refresh()}>Try Again</Button></div>
          : isLoading && !notifications.length ? <div role="status" className="py-12 text-center text-sm text-muted-foreground">Loading notifications...</div>
          : <>
            {notifications.length > 0 && <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox id="select-all-notifications" checked={allSelected} disabled={isMutating}
                aria-label={notifications.length > 500 ? 'Select first 500 notifications shown' : 'Select all notifications shown'} aria-checked={visibleSelection.length > 0 && !allSelected ? 'mixed' : allSelected}
                ref={element => { if (element) element.indeterminate = visibleSelection.length > 0 && !allSelected; }}
                onCheckedChange={checked => setSelected(checked ? selectable.map(n => n.id) : [])} />
              <label htmlFor="select-all-notifications" className="cursor-pointer">{notifications.length > 500 ? 'Select first 500 shown' : 'Select all shown'}</label>
            </div>}
            {!notifications.length ? <NotificationEmptyState title={tabs.find(tab => tab.id === filter)?.empty} /> :
              <TooltipProvider><div className="space-y-3">{notifications.map(notification => <div key={notification.id} data-notification-id={notification.id}
                className={cn('group flex items-start gap-2 rounded-xl border p-3 transition-colors sm:gap-4 sm:p-4',
                  notification.isRead ? 'border-border bg-card' : 'border-blue-200 bg-blue-50/60 dark:border-blue-500/20 dark:bg-blue-500/5')}>
                <div className="pt-2.5"><Checkbox checked={visibleSelection.includes(notification.id)} disabled={isMutating || (visibleSelection.length >= 500 && !visibleSelection.includes(notification.id))} aria-label={`Select notification: ${notification.title}`}
                  onCheckedChange={checked => setSelected(prev => checked ? [...new Set([...prev, notification.id])] : prev.filter(id => id !== notification.id))} /></div>
                <button type="button" disabled={isMutating} className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4"
                  onClick={async () => {
                    if (!notification.isRead && !await markAsRead(notification.id)) return;
                    const destination = await resolveNotificationDestination(notification.id);
                    if (destination) router.push(destination);
                  }}>
                  <NotificationContent notification={notification} />
                  {notificationDestination(notification) && <ChevronRight className="mt-2 hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />}
                </button>
                <Tooltip><TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Delete notification" title="Delete notification" disabled={isMutating}
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-red-600 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                    onClick={() => setDeleting({ ids: [notification.id], bulk: false })}><Trash2 aria-hidden="true" /></Button>
                </TooltipTrigger><TooltipContent>Delete notification</TooltipContent></Tooltip>
              </div>)}</div></TooltipProvider>}
          </>}
        {hasMore && !hasError && <div className="mt-6 text-center"><Button variant="outline" disabled={isLoading || isMutating} onClick={loadMore}>{isLoading ? 'Loading...' : 'Load More'}</Button></div>}
      </TabsContent>
    </Tabs>
    <ConfirmActionDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} variant="destructive" confirmLabel="Delete"
      title={deleting?.bulk ? 'Delete notifications?' : 'Delete notification?'}
      description={deleting?.bulk ? `Are you sure you want to delete ${deleting.ids.length} selected notification${deleting.ids.length === 1 ? '' : 's'}? This action cannot be undone.` : 'Are you sure you want to delete this notification? This action cannot be undone.'}
      isLoading={isMutating} onConfirm={async () => {
        if (deleting && await deleteNotifications(deleting.ids)) {
          setSelected(prev => prev.filter(id => !deleting.ids.includes(id)));
          setDeleting(null);
        } else {
          throw new Error('Unable to delete notifications. Check your connection and try again.');
        }
      }} />
  </div>;
}

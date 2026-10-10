'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ThemedPortal } from '@/shared/components/theme-scope';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { resolveNotificationDestination } from '../notification-destination';
import { useNotifications } from '../hooks/use-notifications';
import { NotificationContent, NotificationEmptyState } from './notification-content';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';

interface NotificationsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
}

export default function NotificationsDropdown({ isOpen, onClose, triggerRef }: NotificationsDropdownProps) {
  const { notifications, unreadCount, isLoading, isMutating, hasError, refresh, markAsRead, markAllAsRead } = useNotifications('all', { enabled: isOpen, limit: 5 });
  const shouldReduce = useReducedMotion();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>();
  const router = useRouter();

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const header = trigger.closest('header') ?? trigger;
    const align = () => {
      const viewport = window.visualViewport;
      const width = Math.min(448, (viewport?.width ?? window.innerWidth) - 16);
      const leftEdge = viewport?.offsetLeft ?? 0;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth);
      const top = header.getBoundingClientRect().bottom;
      setPosition({ top, width, left: Math.max(leftEdge + 8, Math.min(trigger.getBoundingClientRect().right - width, rightEdge - width - 8)),
        maxHeight: Math.max(0, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - top - 8) });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(header);
    window.addEventListener('resize', align);
    window.addEventListener('scroll', align, true);
    window.visualViewport?.addEventListener('resize', align);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', align);
      window.removeEventListener('scroll', align, true);
      window.visualViewport?.removeEventListener('resize', align);
    };
  }, [isOpen, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [isOpen, onClose, triggerRef]);

  useEffect(() => { if (isOpen && position) dropdownRef.current?.focus(); }, [isOpen, !!position]);

  if (typeof document === 'undefined') return null;
  return <ThemedPortal>{<AnimatePresence>{isOpen && position && (
    <motion.div ref={dropdownRef} id="notifications-dropdown" role="dialog" aria-labelledby="notifications-title" tabIndex={-1}
      initial={{ opacity: 0, y: shouldReduce ? 0 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      style={position}
      className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xl shadow-slate-900/10 backdrop-blur-md focus:outline-none dark:shadow-black/40">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id="notifications-title" className="text-base font-semibold text-foreground">Notifications</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{unreadCount} unread</span>
          </div>
          <button type="button" className="shrink-0 whitespace-nowrap rounded text-xs font-medium leading-6 text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={!unreadCount || isMutating} onClick={() => void markAllAsRead()} aria-label="Mark all notifications as read">Mark all as read</button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{unreadCount ? `${unreadCount} ${unreadCount === 1 ? 'item needs' : 'items need'} your attention` : "You're all caught up"}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar" style={{ maxHeight: 400 }}>
        {hasError ? <div role="alert" className="p-4 text-sm">Unable to load notifications. <button className="underline" onClick={() => void refresh()}>Retry</button></div>
          : isLoading && !notifications.length ? <div role="status" className="p-6 text-sm text-muted-foreground">Loading notifications...</div>
          : !notifications.length ? <NotificationEmptyState />
          : <div className="divide-y divide-border">{notifications.slice(0, 5).map(notification => (
            <button key={notification.id} type="button" disabled={isMutating}
              onClick={async () => {
                if (!notification.isRead && !await markAsRead(notification.id)) return;
                const destination = await resolveNotificationDestination(notification.id);
                if (destination) { onClose(); router.push(destination); }
              }}
              className={cn('flex w-full items-start gap-3 px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                notification.isRead ? 'hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-500/5 dark:hover:bg-blue-500/10')}>
              <NotificationContent notification={notification} />
            </button>
          ))}</div>}
      </div>
      <div className="shrink-0 border-t border-border p-3">
        <Button className="h-10 w-full justify-between" onClick={() => { onClose(); router.push('/notifications'); }}><span className="flex-1">View All Notifications</span><ArrowRight aria-hidden="true" /></Button>
      </div>
    </motion.div>
  )}</AnimatePresence>}</ThemedPortal>;
}

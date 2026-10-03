'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { notificationsApi, type Notification, type NotificationsResponse } from '@/shared/services/notifications.api';
import { buildCacheKey, createPageCacheGuard, getPageCache, setPageCache, invalidatePageCache } from '@/shared/cache/page-cache';
import { useAuth } from '@/store/AuthContext';
import { USE_MOCK_DATA } from '@/lib/config';
import { toast } from 'sonner';

export function useNotifications() {
  const { tenant, user } = useAuth();
  const tenantId = tenant?.id ?? user?.tenantId ?? '';
  const params = { page: 1, limit: 20, userId: user?.id, role: user?.role };
  const scope = buildCacheKey('notifications', tenantId, params);
  const enabled = !USE_MOCK_DATA && !!user?.id;
  const cached = enabled ? getPageCache<NotificationsResponse>('notifications', tenantId, params)?.data : undefined;
  const [state, setState] = useState(() => ({
    scope, notifications: cached?.data ?? [], unreadCount: cached?.unreadCount ?? 0, page: 1,
    hasMore: cached?.meta.hasMore ?? false, isLoading: enabled, hasError: false,
  }));
  const active = useRef({ scope, version: 0, mounted: false });
  active.current.scope = scope;
  const currentState = state.scope === scope ? state : {
    scope, notifications: cached?.data ?? [], unreadCount: cached?.unreadCount ?? 0, page: 1,
    hasMore: cached?.meta.hasMore ?? false, isLoading: enabled, hasError: false,
  };

  const loadNotifications = useCallback(async (page: number, append = false, preservePages = false) => {
    if (!enabled || !active.current.mounted || active.current.scope !== scope) return;
    const version = ++active.current.version;
    const cacheValid = createPageCacheGuard('notifications');
    const current = () => active.current.mounted && active.current.scope === scope && active.current.version === version;
    setState((prev) => ({
      ...(prev.scope === scope ? prev : { scope, notifications: cached?.data ?? [], unreadCount: cached?.unreadCount ?? 0, page: 1, hasMore: cached?.meta.hasMore ?? false }),
      isLoading: true, hasError: false,
    }));
    try {
      const response = await notificationsApi.list({ page, limit: 20 });
      if (!current() || !cacheValid()) return;
      setState((prev) => ({
        scope, page: preservePages ? prev.page : page, unreadCount: response.unreadCount ?? 0, isLoading: false, hasError: false,
        hasMore: preservePages && prev.page > 1 ? prev.hasMore : response.meta?.hasMore ?? false,
        notifications: append
          ? Array.from(new Map([...prev.notifications, ...response.data].map((n) => [n.id, n])).values())
          : preservePages && prev.page > 1
          ? [...response.data, ...prev.notifications.filter(n => !response.data.some(fresh => fresh.id === n.id))]
          : response.data,
      }));
      if (page === 1) setPageCache('notifications', tenantId, params, response);
    } catch (error) {
      if (!current() || !cacheValid()) return;
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) invalidatePageCache('notifications', tenantId);
      setState((prev) => ({ ...prev, hasError: true, unreadCount: status === 401 || status === 403 ? 0 : prev.unreadCount, notifications: status === 401 || status === 403 ? [] : prev.notifications }));
      toast.error('Failed to load notifications');
    } finally {
      if (current()) setState((prev) => ({ ...prev, isLoading: false }));
    }
  // The scope includes every field in params. Cache initialization runs once per scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled, tenantId]);

  useEffect(() => {
    active.current.mounted = true;
    void loadNotifications(1);
    const refresh = () => { if (document.visibilityState !== 'hidden') void loadNotifications(1, false, true); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('notifications-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('notifications-changed', refresh); window.removeEventListener('focus', refresh); active.current.mounted = false; active.current.version++; };
  }, [loadNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      if (!active.current.mounted || active.current.scope !== scope) return;
      active.current.version++;
      invalidatePageCache('notifications', tenantId);
      setState((prev) => ({ ...prev, unreadCount: Math.max(0, prev.unreadCount - (prev.notifications.some(n => n.id === id && !n.isRead) ? 1 : 0)), isLoading: false, notifications: prev.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n,
      ) }));
      window.dispatchEvent(new Event('notifications-changed'));
    } catch { toast.error('Failed to update notification'); }
  }, [scope, tenantId]);

  const markAllAsRead = useCallback(async () => {
    try {
      await notificationsApi.markAllRead();
      if (!active.current.mounted || active.current.scope !== scope) return;
      active.current.version++;
      invalidatePageCache('notifications', tenantId);
      setState((prev) => ({ ...prev, unreadCount: 0, isLoading: false, notifications: prev.notifications.map((n) =>
        ({ ...n, isRead: true, readAt: new Date().toISOString() }),
      ) }));
      toast.success('All notifications marked as read');
      window.dispatchEvent(new Event('notifications-changed'));
    } catch { toast.error('Failed to update notifications'); }
  }, [scope, tenantId]);

  const loadMore = useCallback(() => {
    if (!currentState.isLoading && currentState.hasMore) void loadNotifications(currentState.page + 1, true);
  }, [currentState.isLoading, currentState.hasMore, currentState.page, loadNotifications]);
  const refresh = useCallback(() => loadNotifications(1), [loadNotifications]);
  const notifications = enabled ? currentState.notifications : [];
  return {
    notifications,
    unreadCount: enabled ? currentState.unreadCount : 0,
    isLoading: enabled && currentState.isLoading,
    hasError: currentState.hasError,
    page: currentState.page,
    hasMore: currentState.hasMore,
    markAsRead, markAllAsRead, loadMore, refresh,
  };
}

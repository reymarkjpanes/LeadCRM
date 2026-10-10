'use client';
import { useEffect, useState } from 'react';
import type { NotificationMutationResponse, NotificationsResponse } from '@leadcrm/shared';
import { notificationsApi } from '@/shared/services/notifications.api';

// A single clock and request per authenticated scope; feed consumers share in-flight reads.
const pending = new Map<string, Promise<NotificationsResponse>>();
export function sharedNotificationList(scope: string, query: Parameters<typeof notificationsApi.list>[0]) {
  const key = scope + JSON.stringify(query);
  let request = pending.get(key);
  if (!request) {
    request = notificationsApi.list(query).finally(() => { if (pending.get(key) === request) pending.delete(key); });
    pending.set(key, request);
  }
  return request;
}
function clearRequests(scope: string) {
  for (const key of pending.keys()) if (key.startsWith(scope)) pending.delete(key);
}
type Counts = NotificationMutationResponse & { scope: string };
type Watcher = { listeners: Set<(counts: Counts) => void>; counts?: Counts; version: number; loading: boolean; timer: ReturnType<typeof setInterval>; focus: () => void; mutation: (event: Event) => void };
const watchers = new Map<string, Watcher>();
export function useNotificationCounts(scope: string, tenantId: string, userId: string, enabled: boolean) {
  const [state, setState] = useState<Counts>();
  useEffect(() => {
    if (!enabled) return;
    let watcher = watchers.get(scope);
    if (!watcher) {
      const refresh = async () => {
        if (watcher!.loading || document.visibilityState === 'hidden') return;
        watcher!.loading = true;
        const version = watcher!.version;
        try {
          const result = await notificationsApi.counts();
          if (watchers.get(scope) !== watcher || watcher!.version !== version) return;
          const changed = watcher!.counts && (watcher!.counts.totalCount !== result.totalCount || watcher!.counts.unreadCount !== result.unreadCount);
          watcher!.counts = { ...result, scope };
          watcher!.listeners.forEach(fn => fn(watcher!.counts!));
          if (changed) window.dispatchEvent(new CustomEvent('notifications-refresh', { detail: { tenantId, userId } }));
        } catch (error) {
          if (watchers.get(scope) !== watcher || watcher!.version !== version) return;
          if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
            watcher!.counts = { scope, success: false, unreadCount: 0, totalCount: 0 };
            watcher!.listeners.forEach(fn => fn(watcher!.counts!));
          }
        } finally { watcher!.loading = false; }
      };
      const mutation = (event: Event) => {
        const result = (event as CustomEvent<Counts & { tenantId: string; userId: string }>).detail;
        if (result.tenantId !== tenantId || result.userId !== userId) return;
        watcher!.version++;
        watcher!.counts = { ...result, scope };
        watcher!.listeners.forEach(fn => fn(watcher!.counts!));
      };
      const focus = () => { void refresh(); };
      watcher = { listeners: new Set(), version: 0, loading: false, timer: setInterval(focus, 30000), focus, mutation };
      watchers.set(scope, watcher);
      window.addEventListener('focus', focus);
      window.addEventListener('notifications-changed', mutation);
      void refresh();
    }
    watcher.listeners.add(setState);
    if (watcher.counts) setState(watcher.counts);
    return () => {
      watcher!.listeners.delete(setState);
      if (!watcher!.listeners.size) {
        clearRequests(scope);
        clearInterval(watcher!.timer); watchers.delete(scope);
        window.removeEventListener('focus', watcher!.focus);
        window.removeEventListener('notifications-changed', watcher!.mutation);
      }
    };
  }, [scope, tenantId, userId, enabled]);
  return enabled && state?.scope === scope ? state : undefined;
}

const locks = new Set<string>();
export function lockNotificationMutation(scope: string) {
  if (locks.has(scope)) return false;
  clearRequests(scope);
  locks.add(scope); return true;
}
export function unlockNotificationMutation(scope: string) { clearRequests(scope); locks.delete(scope); }

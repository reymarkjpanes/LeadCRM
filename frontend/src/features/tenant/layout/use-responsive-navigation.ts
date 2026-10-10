'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useOverlayState, useWorkspacePanelWidth } from '@/shared/lib/overlay-state';

export type NavigationMode = 'mobile' | 'tablet' | 'desktop';
export const navigationMode = (width: number): NavigationMode => width < 768 ? 'mobile' : width < 1025 ? 'tablet' : 'desktop';
const subscribeViewport = (callback: () => void) => {
  window.addEventListener('resize', callback, { passive: true });
  return () => window.removeEventListener('resize', callback);
};
const viewportSnapshot = () => window.innerWidth;
const serverViewport = () => 1280;
const subscribeFullscreen = (callback: () => void) => {
  document.addEventListener('fullscreenchange', callback);
  document.addEventListener('webkitfullscreenchange', callback);
  return () => {
    document.removeEventListener('fullscreenchange', callback);
    document.removeEventListener('webkitfullscreenchange', callback);
  };
};
const fullscreenSnapshot = () => Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement);
const serverFullscreen = () => false;

export function useResponsiveNavigation(userId?: string, tenantId?: string) {
  const width = useSyncExternalStore(subscribeViewport, viewportSnapshot, serverViewport);
  const mode = navigationMode(width);
  const pathname = usePathname();
  const { blocking, focusMode: appFocusMode } = useOverlayState();
  const fullscreen = useSyncExternalStore(subscribeFullscreen, fullscreenSnapshot, serverFullscreen);
  const focusMode = appFocusMode || fullscreen;
  const panelWidth = useWorkspacePanelWidth();
  const preferenceKey = userId && tenantId ? `leadcrm:nav:v1:${tenantId}:${userId}:desktop` : null;
  const [preference, setPreference] = useState<{ key: string | null; collapsed: boolean }>({ key: null, collapsed: false });
  const [drawer, setDrawer] = useState<{ mode: NavigationMode; path: string | null; open: boolean }>({ mode, path: pathname, open: false });
  const preferredCollapsed = preference.key === preferenceKey && preference.collapsed;
  // Count only visible docked panels, preserving a useful 720px main workspace.
  const constrained = mode === 'desktop' && panelWidth > 0 && width - 220 - panelWidth - 48 < 720;
  const railCollapsed = mode === 'tablet' || preferredCollapsed || Boolean(constrained);
  const drawerOpen = drawer.open && drawer.mode === mode && drawer.path === pathname && !blocking && !focusMode;

  useEffect(() => {
    let collapsed = false;
    if (preferenceKey) {
      try { collapsed = localStorage.getItem(preferenceKey) === 'collapsed'; } catch { /* Storage may be disabled. */ }
    }
    setPreference({ key: preferenceKey, collapsed });
  }, [preferenceKey]);

  useEffect(() => { setDrawer({ mode, path: pathname, open: false }); }, [mode, pathname, blocking, focusMode, preferenceKey, constrained]);

  const closeDrawer = useCallback(() => setDrawer(previous => ({ ...previous, open: false })), []);
  const openDrawer = () => { if (!blocking && !focusMode) setDrawer({ mode, path: pathname, open: true }); };
  const toggleCollapse = () => {
    if (mode !== 'desktop' || constrained) { drawerOpen ? closeDrawer() : openDrawer(); return; }
    const collapsed = !preferredCollapsed;
    setPreference({ key: preferenceKey, collapsed });
    if (preferenceKey) {
      try { localStorage.setItem(preferenceKey, collapsed ? 'collapsed' : 'expanded'); } catch { /* Keep the current-session choice. */ }
    }
  };

  return { mode, drawerOpen, railCollapsed, isCollapsed: !drawerOpen && railCollapsed, focusMode, closeDrawer, openDrawer, toggleCollapse };
}

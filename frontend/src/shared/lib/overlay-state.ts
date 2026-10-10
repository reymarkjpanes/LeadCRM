'use client';

import { useEffect, useId, useSyncExternalStore } from 'react';

type OverlayKind = 'modal' | 'navigation' | 'focus';
const overlays = new Map<string, OverlayKind>();
const workspacePanels = new Map<string, number>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => { listeners.forEach(listener => listener()); };

/** Only blocking surfaces affect navigation; ordinary menus do not register here. */
export function registerOverlay(id: string, kind: OverlayKind = 'modal') {
  overlays.set(id, kind);
  publish();
  return () => { if (overlays.delete(id)) publish(); };
}

export function useOverlayState() {
  const blocking = useSyncExternalStore(subscribe, () => [...overlays.values()].some(kind => kind !== 'navigation'), () => false);
  const focusMode = useSyncExternalStore(subscribe, () => [...overlays.values()].includes('focus'), () => false);
  const active = useSyncExternalStore(subscribe, () => overlays.size > 0, () => false);
  return { blocking, focusMode, active };
}

export function useFocusMode(active: boolean) {
  const id = useId();
  useEffect(() => active ? registerOverlay(id, 'focus') : undefined, [active, id]);
}

export function useWorkspacePanel(width: number, active: boolean) {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    workspacePanels.set(id, width);
    publish();
    return () => { workspacePanels.delete(id); publish(); };
  }, [id, width, active]);
}

export function useWorkspacePanelWidth() {
  return useSyncExternalStore(subscribe, () => [...workspacePanels.values()].reduce((sum, width) => sum + width, 0), () => 0);
}

const scrollLocks = new Map<HTMLElement, { count: number; overflow: string }>();
const inertLocks = new Map<HTMLElement, { count: number; inert: boolean }>();

/** Reference counts also cover a drawer closing while a confirmation remains open. */
export function lockBackgroundScroll() {
  const elements = [document.body, ...document.querySelectorAll<HTMLElement>('[data-app-scroll]')];
  elements.forEach(element => {
    const lock = scrollLocks.get(element) ?? { count: 0, overflow: element.style.overflow };
    lock.count++;
    scrollLocks.set(element, lock);
    element.style.overflow = 'hidden';
  });
  return () => elements.forEach(element => {
    const lock = scrollLocks.get(element);
    if (lock && --lock.count === 0) { element.style.overflow = lock.overflow; scrollLocks.delete(element); }
  });
}

export function lockModalBackground(panel: HTMLElement) {
  const elements = new Set<HTMLElement>();
  let current: HTMLElement = panel.closest<HTMLElement>('[data-theme-portal], [data-navigation-slot]') ?? panel;
  while (current.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling instanceof HTMLElement && sibling !== current && !sibling.matches('script, style, link, [data-overlay-backdrop]')) elements.add(sibling);
    }
    if (current.parentElement === document.body) break;
    current = current.parentElement;
  }
  elements.forEach(element => {
    const lock = inertLocks.get(element) ?? { count: 0, inert: element.inert };
    lock.count++;
    inertLocks.set(element, lock);
    element.inert = true;
  });
  return () => elements.forEach(element => {
    const lock = inertLocks.get(element);
    if (lock && --lock.count === 0) { element.inert = lock.inert; inertLocks.delete(element); }
  });
}

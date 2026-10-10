'use client';
import { useEffect, useRef, type RefObject } from 'react';
import { lockBackgroundScroll, lockModalBackground, registerOverlay } from '@/shared/lib/overlay-state';

const modalStack: string[] = [];
const focusSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Keep modal keyboard behavior consistent, including menus rendered through owned portals. */
export function useModalInteraction({ open, panelRef, owner, onClose, trapFocus = true, kind = 'modal' }: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  owner: string;
  onClose: () => void;
  trapFocus?: boolean;
  kind?: 'modal' | 'navigation';
}) {
  const closeRef = useRef(onClose);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  closeRef.current = onClose;
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const previous = opener.current;
    modalStack.push(owner);
    const releaseOverlay = registerOverlay(owner, kind);
    const releaseScroll = lockBackgroundScroll();
    const releaseInert = trapFocus ? lockModalBackground(panel) : () => {};
    const ownedPortals = () => Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-owner]'))
      .filter(element => element.dataset.overlayOwner === owner);
    const contains = (target: Node | null) => Boolean(target && (panel.contains(target) || ownedPortals().some(element => element.contains(target))));
    const focusable = () => [...new Set([panel, ...ownedPortals()].flatMap(root => Array.from(root.querySelectorAll<HTMLElement>(focusSelector))))]
      .filter(element => element.tabIndex >= 0 && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
    const isTop = () => modalStack.at(-1) === owner && !document.querySelector('[data-confirm-action-layer]');
    const focusFirst = () => (focusable()[0] ?? panel).focus({ preventScroll: true });
    if (trapFocus && !contains(document.activeElement)) focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented) return;
      // Floating controls handle their own Escape first, without closing the enclosing form.
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !trapFocus) return;
      const elements = focusable(), first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (trapFocus && isTop() && !contains(event.target as Node)) focusFirst();
    };
    window.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      const wasTop = isTop();
      const index = modalStack.lastIndexOf(owner);
      if (index !== -1) modalStack.splice(index, 1);
      releaseInert();
      releaseScroll();
      releaseOverlay();
      if (trapFocus && wasTop && previous?.isConnected && !previous.closest('[inert], [aria-hidden="true"]')) previous.focus({ preventScroll: true });
    };
  }, [open, owner, panelRef, trapFocus, kind]);
}

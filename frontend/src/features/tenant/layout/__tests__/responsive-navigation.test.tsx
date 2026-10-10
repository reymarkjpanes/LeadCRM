import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOverlay, useWorkspacePanel } from '@/shared/lib/overlay-state';
const route = vi.hoisted(() => ({ pathname: '/crm/leads' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
import { navigationMode, useResponsiveNavigation } from '../use-responsive-navigation';

const preferenceKey = 'leadcrm:nav:v1:tenant-a:user-a:desktop';
function resize(width: number) {
  act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); window.dispatchEvent(new Event('resize')); });
}
beforeEach(() => { localStorage.clear(); route.pathname = '/crm/leads'; resize(1440); });
afterEach(cleanup);

describe('responsive navigation', () => {
  it.each([[320, 'mobile'], [767, 'mobile'], [768, 'tablet'], [1024, 'tablet'], [1025, 'desktop'], [2560, 'desktop']])('classifies %s CSS pixels as %s', (width, mode) => {
    expect(navigationMode(Number(width))).toBe(mode);
  });

  it('keeps desktop preferences separate from tablet and mobile drawers', () => {
    const { result } = renderHook(() => useResponsiveNavigation('user-a', 'tenant-a'));
    act(() => result.current.toggleCollapse());
    expect(localStorage.getItem(preferenceKey)).toBe('collapsed');
    resize(820);
    expect(result.current.isCollapsed).toBe(true);
    act(() => result.current.openDrawer());
    expect(result.current.isCollapsed).toBe(false);
    resize(390);
    expect(result.current.drawerOpen).toBe(false);
    act(() => result.current.openDrawer());
    expect(result.current.isCollapsed).toBe(false);
    resize(1440);
    expect(result.current.drawerOpen).toBe(false);
    expect(result.current.isCollapsed).toBe(true);
  });

  it('closes on programmatic route changes, not only navigation clicks', () => {
    resize(390);
    const { result, rerender } = renderHook(() => useResponsiveNavigation('user-a', 'tenant-a'));
    act(() => result.current.openDrawer());
    route.pathname = '/settings';
    rerender();
    expect(result.current.drawerOpen).toBe(false);
  });

  it('closes a mobile drawer for blocking overlays and keeps it closed afterwards', () => {
    resize(390);
    const { result } = renderHook(() => useResponsiveNavigation('user-a', 'tenant-a'));
    act(() => result.current.openDrawer());
    let release = () => {};
    act(() => { release = registerOverlay('test-settings'); });
    expect(result.current.drawerOpen).toBe(false);
    act(() => result.current.openDrawer());
    expect(result.current.drawerOpen).toBe(false);
    act(release);
    expect(result.current.drawerOpen).toBe(false);
  });

  it('keeps desktop navigation expanded for ordinary dialogs and temporarily hides it for focus mode', () => {
    const { result } = renderHook(() => useResponsiveNavigation('user-a', 'tenant-a'));
    let release = () => {};
    act(() => { release = registerOverlay('test-dialog'); });
    expect(result.current.isCollapsed).toBe(false);
    act(release);
    act(() => { release = registerOverlay('test-focus', 'focus'); });
    expect(result.current.focusMode).toBe(true);
    act(release);
    expect(result.current.focusMode).toBe(false);
    expect(result.current.isCollapsed).toBe(false);
    expect(localStorage.getItem(preferenceKey)).toBeNull();
  });

  it('collapses only for visible docked panels that constrain space, without saving that adjustment', () => {
    resize(1100);
    const { result, rerender } = renderHook(({ docked }) => {
      useWorkspacePanel(300, docked);
      return useResponsiveNavigation('user-a', 'tenant-a');
    }, { initialProps: { docked: false } });
    expect(result.current.isCollapsed).toBe(false);
    rerender({ docked: true });
    expect(result.current.isCollapsed).toBe(true);
    expect(localStorage.getItem(preferenceKey)).toBeNull();
    act(() => result.current.toggleCollapse());
    expect(result.current.drawerOpen).toBe(true);
    rerender({ docked: false });
    expect(result.current.drawerOpen).toBe(false);
    expect(result.current.isCollapsed).toBe(false);
  });

  it('isolates preferences across users and tenants', () => {
    localStorage.setItem(preferenceKey, 'collapsed');
    const { result, rerender } = renderHook(({ user, tenant }) => useResponsiveNavigation(user, tenant), { initialProps: { user: 'user-a', tenant: 'tenant-a' } });
    expect(result.current.isCollapsed).toBe(true);
    rerender({ user: 'user-b', tenant: 'tenant-a' });
    expect(result.current.isCollapsed).toBe(false);
    rerender({ user: 'user-a', tenant: 'tenant-b' });
    expect(result.current.isCollapsed).toBe(false);
    expect(localStorage.getItem(preferenceKey)).toBe('collapsed');
  });

  it.each([390, 1440])('closes navigation in native fullscreen at %s and preserves the desktop preference on exit', width => {
    resize(width);
    localStorage.setItem(preferenceKey, 'collapsed');
    const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    try {
      const { result } = renderHook(() => useResponsiveNavigation('user-a', 'tenant-a'));
      if (width < 768) act(() => result.current.openDrawer());
      act(() => { fullscreenElement = document.body; document.dispatchEvent(new Event('fullscreenchange')); });
      expect(result.current.focusMode).toBe(true);
      expect(result.current.drawerOpen).toBe(false);
      act(() => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); });
      expect(result.current.focusMode).toBe(false);
      expect(result.current.drawerOpen).toBe(false);
      expect(result.current.isCollapsed).toBe(true);
      expect(localStorage.getItem(preferenceKey)).toBe('collapsed');
    } finally {
      if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor);
      else Reflect.deleteProperty(document, 'fullscreenElement');
    }
  });
});

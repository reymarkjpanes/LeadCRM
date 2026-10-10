'use client';
import { useEffect, type RefObject } from 'react';
import { themeClassName } from '@/lib/appearance-config';
import { useTheme } from './use-theme';
/** Adapter for imperative theme containers; OS/storage listeners remain shared. */
export function useThemeContainer(containerRef: RefObject<HTMLElement | null>): void {
  const { resolved } = useTheme();
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    element.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');
    element.classList.add(...themeClassName(resolved).split(' '));
  }, [containerRef, resolved]);
}

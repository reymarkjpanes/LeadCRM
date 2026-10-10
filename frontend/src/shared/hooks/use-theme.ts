'use client';
import { useSyncExternalStore } from 'react';
import { getAppearanceSnapshot, getServerAppearanceSnapshot, subscribeAppearance, updateAppearance } from '@/lib/appearance';
import type { AppearanceDensity, ThemeMode } from '@/lib/appearance-config';
export type { ThemeMode } from '@/lib/appearance-config';

/** One shared preference snapshot for controls, scopes, canvas charts and portals. */
export function useTheme() {
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearanceSnapshot, getServerAppearanceSnapshot);
  return {
    ...appearance,
    isDark: appearance.resolved === 'dark',
    setTheme: (mode: ThemeMode) => updateAppearance({ mode }),
    setDensity: (density: AppearanceDensity) => updateAppearance({ density }),
    setAccent: (accent: string) => updateAppearance({ accent }),
    toggleTheme: () => updateAppearance({ mode: appearance.mode === 'Light' ? 'Dark' : 'Light' }),
  };
}

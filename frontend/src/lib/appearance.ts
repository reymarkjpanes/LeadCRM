'use client';
import { ACCENT_COLORS, ACCENT_KEY, applyAccentTokens } from './accent-colors';
import { DENSITIES, DENSITY_FONT_SIZE, DENSITY_KEY, THEME_KEY, THEME_MODES, resolveTheme, type AppearanceDensity, type ResolvedTheme, type ThemeMode } from './appearance-config';

export interface AppearanceSnapshot {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  density: AppearanceDensity;
  accent: string;
  systemDark: boolean;
}
const initial: AppearanceSnapshot = { mode: 'Light', resolved: 'light', density: 'Medium', accent: 'blue', systemDark: false };
let snapshot = initial;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
let dispatching = false;

function read(key: string, fallback: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return fallback; }
}
function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function readStored(): AppearanceSnapshot {
  const mode = read(THEME_KEY, snapshot.mode);
  const density = read(DENSITY_KEY, snapshot.density);
  const accent = read(ACCENT_KEY, snapshot.accent);
  const validMode = THEME_MODES.includes(mode as ThemeMode) ? mode as ThemeMode : 'Light';
  return {
    mode: validMode,
    resolved: resolveTheme(validMode, systemDark()),
    density: DENSITIES.includes(density as AppearanceDensity) ? density as AppearanceDensity : 'Medium',
    accent: ACCENT_COLORS.some(color => color.id === accent) ? accent! : 'blue',
    systemDark: systemDark(),
  };
}
function publish(next: AppearanceSnapshot, broadcast = true): void {
  const changed = Object.keys(next).some(key => next[key as keyof AppearanceSnapshot] !== snapshot[key as keyof AppearanceSnapshot]);
  snapshot = changed ? next : snapshot;
  document.documentElement.dataset.appTheme = next.resolved;
  document.documentElement.style.fontSize = DENSITY_FONT_SIZE[next.density];
  applyAccentTokens(next.accent);
  if (!changed) return;
  listeners.forEach(listener => listener());
  if (broadcast) {
    dispatching = true;
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next.resolved, mode: next.mode } })); }
    finally { dispatching = false; }
  }
}
function start(): void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
  const refresh = () => { if (!dispatching) publish(readStored(), false); };
  const osChanged = () => publish({ ...snapshot, systemDark: systemDark(), resolved: resolveTheme(snapshot.mode, systemDark()) });
  const storageChanged = (event: StorageEvent) => {
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch { /* Storage may be disabled; keep the current in-memory preferences. */ return; }
    if (event.key === null || [THEME_KEY, DENSITY_KEY, ACCENT_KEY].includes(event.key)) refresh();
  };
  window.addEventListener('themechange', refresh);
  window.addEventListener('accentcolorchange', refresh);
  window.addEventListener('storage', storageChanged);
  media?.addEventListener('change', osChanged);
  stop = () => {
    window.removeEventListener('themechange', refresh);
    window.removeEventListener('accentcolorchange', refresh);
    window.removeEventListener('storage', storageChanged);
    media?.removeEventListener('change', osChanged);
  };
  publish(readStored(), false);
}
export const getAppearanceSnapshot = () => snapshot;
export const getServerAppearanceSnapshot = () => initial;
export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  if (!stop) start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = undefined; }
  };
}
export function updateAppearance(patch: Partial<Pick<AppearanceSnapshot, 'mode' | 'density' | 'accent'>>): void {
  if (typeof window === 'undefined') return;
  const current = stop ? snapshot : readStored();
  const mode = patch.mode && THEME_MODES.includes(patch.mode) ? patch.mode : current.mode;
  const density = patch.density && DENSITIES.includes(patch.density) ? patch.density : current.density;
  const accent = patch.accent && ACCENT_COLORS.some(color => color.id === patch.accent) ? patch.accent : current.accent;
  for (const [key, value] of [[THEME_KEY, mode], [DENSITY_KEY, density], [ACCENT_KEY, accent]]) {
    try { window.localStorage.setItem(key, value); } catch { /* Preferences still work in memory without storage. */ }
  }
  publish({ mode, density, accent, systemDark: systemDark(), resolved: resolveTheme(mode, systemDark()) });
}

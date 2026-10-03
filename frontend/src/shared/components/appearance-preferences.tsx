'use client';

import React, { useState, useEffect } from 'react';
import { Sun, Moon, Monitor, Layout, Check } from 'lucide-react';
import { ACCENT_COLORS, applyAccentColor, ACCENT_KEY } from '@/lib/accent-colors';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type ThemeId = 'Classic' | 'Light' | 'Dark' | 'System';
type DensityId = 'Small' | 'Medium' | 'Large';

// ── Constants ─────────────────────────────────────────────────────────────────

const THEME_OPTIONS: { id: ThemeId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'Classic', label: 'Classic', icon: Layout },
  { id: 'Light',   label: 'Light',   icon: Sun },
  { id: 'Dark',    label: 'Dark',    icon: Moon },
  { id: 'System',  label: 'System',  icon: Monitor },
];

const DENSITY_OPTIONS: DensityId[] = ['Small', 'Medium', 'Large'];

const DENSITY_FONT_SIZE: Record<DensityId, string> = {
  Small:  '14px',
  Medium: '16px',
  Large:  '18px',
};

const THEME_KEY = 'app_theme';
const DENSITY_KEY = 'app_font_size';

const SEGMENT_SHELL =
  'gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl border border-slate-200/60 dark:border-slate-700/60';

const SEGMENT_ACTIVE =
  'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-xs font-semibold';

const SEGMENT_IDLE =
  'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveTheme(themeId: ThemeId): 'light' | 'dark' | 'classic' {
  if (themeId === 'Dark') return 'dark';
  if (themeId === 'Classic') return 'classic';
  if (themeId === 'System') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Appearance controls for the profile menu:
 * theme mode, interface density and accent colour.
 *
 * Writes theme classes to `[data-theme-container]` and broadcasts a
 * `themechange` event so any mounted `useTheme()` consumer stays in sync.
 * These are genuinely device-local preferences, so localStorage is the
 * correct home for them.
 */
export function AppearancePreferences(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeId>('Light');
  const [density, setDensity] = useState<DensityId>('Medium');
  const [accent, setAccent] = useState<string>('blue');

  useEffect(() => {
    try {
      setTheme((localStorage.getItem(THEME_KEY) as ThemeId | null) ?? 'Light');
      setDensity((localStorage.getItem(DENSITY_KEY) as DensityId | null) ?? 'Medium');
      setAccent(localStorage.getItem(ACCENT_KEY) ?? 'blue');
    } catch { /* noop */ }

    const handleThemeChange = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      if (mode) setTheme(mode as ThemeId);
    };

    const handleAccentChange = (event: Event) => {
      const id = (event as CustomEvent<{ accent?: { id: string } }>).detail?.accent?.id;
      if (id) setAccent(id);
    };

    window.addEventListener('themechange', handleThemeChange);
    window.addEventListener('accentcolorchange', handleAccentChange);
    return () => {
      window.removeEventListener('themechange', handleThemeChange);
      window.removeEventListener('accentcolorchange', handleAccentChange);
    };
  }, []);

  const handleThemeSelect = (themeId: ThemeId) => {
    setTheme(themeId);
    try { localStorage.setItem(THEME_KEY, themeId); } catch { /* noop */ }

    const resolved = resolveTheme(themeId);
    const container = document.querySelector('[data-theme-container]');

    if (container) {
      container.classList.remove('dark', 'theme-classic', 'theme-light', 'theme-dark');
      if (resolved === 'dark') {
        container.classList.add('dark', 'theme-dark');
      } else if (resolved === 'classic') {
        container.classList.add('theme-classic');
      } else {
        container.classList.add('theme-light');
      }
    }

    window.dispatchEvent(
      new CustomEvent('themechange', { detail: { theme: resolved, mode: themeId } }),
    );
  };

  const handleDensitySelect = (size: DensityId) => {
    setDensity(size);
    try { localStorage.setItem(DENSITY_KEY, size); } catch { /* noop */ }
    document.documentElement.style.fontSize = DENSITY_FONT_SIZE[size];
    window.dispatchEvent(new CustomEvent('themechange', { detail: { mode: theme } }));
  };

  const handleAccentSelect = (accentId: string) => {
    setAccent(accentId);
    applyAccentColor(accentId);
  };

  const accentName = ACCENT_COLORS.find((color) => color.id === accent)?.name ?? 'Blue';

  return (
    <div className="px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-700/70 space-y-3">
      {/* Theme mode */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Theme Mode
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {theme === 'Classic' ? 'Dark Sidebar + Light' : theme}
          </span>
        </div>
        <div className={cn('grid grid-cols-4', SEGMENT_SHELL)}>
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleThemeSelect(option.id)}
                aria-pressed={isSelected}
                title={option.id === 'Classic' ? 'Classic: Dark sidebar + Light content' : option.label}
                className={cn(
                  'flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg text-[10.5px] font-medium transition-all duration-150 cursor-pointer select-none',
                  isSelected ? SEGMENT_ACTIVE : SEGMENT_IDLE,
                )}
              >
                <Icon
                  size={12}
                  className={cn(isSelected ? 'text-[#2563EB] dark:text-blue-400' : 'text-slate-400 dark:text-slate-500')}
                />
                <span className="whitespace-nowrap">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Interface density */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Interface Density
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">{density}</span>
        </div>
        <div className={cn('grid grid-cols-3', SEGMENT_SHELL)}>
          {DENSITY_OPTIONS.map((size) => {
            const isSelected = density === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => handleDensitySelect(size)}
                aria-pressed={isSelected}
                className={cn(
                  'flex items-center justify-center py-1 px-2 rounded-lg text-[10.5px] font-medium transition-all duration-150 cursor-pointer select-none',
                  isSelected ? SEGMENT_ACTIVE : SEGMENT_IDLE,
                )}
              >
                {size}
              </button>
            );
          })}
        </div>
      </div>

      {/* Accent colour */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Accent Color
          </span>
          <span className="text-[10.5px] font-medium text-slate-500 dark:text-slate-400 capitalize">
            {accentName}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 pt-0.5">
          {ACCENT_COLORS.map((color) => {
            const isSelected = accent === color.id;
            return (
              <button
                key={color.id}
                type="button"
                onClick={() => handleAccentSelect(color.id)}
                title={color.name}
                aria-label={`Select ${color.name} accent`}
                aria-pressed={isSelected}
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer shadow-2xs',
                  color.previewClass,
                  'hover:scale-115 active:scale-90',
                  isSelected
                    ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#1E293B] ring-slate-900 dark:ring-white scale-105'
                    : 'opacity-90 hover:opacity-100',
                )}
              >
                {isSelected && <Check size={11} className="text-white drop-shadow-xs stroke-[3.5]" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

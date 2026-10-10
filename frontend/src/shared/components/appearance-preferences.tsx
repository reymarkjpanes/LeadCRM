'use client';

import React from 'react';
import { useTheme } from '@/shared/hooks/use-theme';
import { Sun, Moon, Monitor, Layout, Check } from 'lucide-react';
import { ACCENT_COLORS } from '@/lib/accent-colors';
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

const SEGMENT_SHELL =
  'gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl border border-slate-200/60 dark:border-slate-700/60';

const SEGMENT_ACTIVE =
  'bg-card text-slate-900 dark:text-white shadow-xs font-semibold';

const SEGMENT_IDLE =
  'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';

/** Compact appearance controls backed by the shared device preference store. */
export function AppearancePreferences(): React.ReactElement {
  const { mode: theme, density, accent, setTheme, setDensity, setAccent } = useTheme();

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
                onClick={() => setTheme(option.id)}
                aria-pressed={isSelected}
                title={option.id === 'Classic' ? 'Classic: Dark sidebar + Light content' : option.label}
                className={cn(
                  'flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg text-[10.5px] font-medium transition-all duration-150 cursor-pointer select-none',
                  isSelected ? SEGMENT_ACTIVE : SEGMENT_IDLE,
                )}
              >
                <Icon
                  size={12}
                  className={cn(isSelected ? 'text-primary' : 'text-slate-400 dark:text-slate-500')}
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
                onClick={() => setDensity(size)}
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
                onClick={() => setAccent(color.id)}
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

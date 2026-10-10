'use client';
import React from 'react';
import { Layout, Palette, Sun, Moon, Monitor, Check, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ACCENT_COLORS } from '@/lib/accent-colors';
import { THEME_PALETTES } from '@/lib/appearance-config';
import { useTheme } from '@/shared/hooks/use-theme';

/** Shared device-local controls for every Appearance entry point. */
export function AppearanceSettings(): React.ReactElement {
  const { mode, density, accent, systemDark, setTheme, setDensity, setAccent } = useTheme();
  return (
    <div className="w-full max-w-6xl space-y-6">
      <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-primary" /> System Appearance
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Choose how LeadCRM looks to you. Select a theme below.</p>
        </div>

        {/* Theme Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { id: "Classic", icon: Layout, desc: "Dark sidebar + Light", preview: THEME_PALETTES.classic },
            { id: "Light", icon: Sun, desc: "Fully light", preview: THEME_PALETTES.light },
            { id: "Dark", icon: Moon, desc: "Fully dark", preview: THEME_PALETTES.dark },
            { id: "System", icon: Monitor, desc: "Match your OS", preview: THEME_PALETTES[systemDark ? "dark" : "light"] },
          ] as const).map((theme) => {
            const isSelected = mode === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id)}
                aria-pressed={isSelected}
                aria-label={`Select ${theme.id} theme`}
                className={cn(
                  'relative flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  isSelected
                    ? 'border-primary/60 bg-primary/[0.04] shadow-sm'
                    : 'border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.14] bg-white dark:bg-white/[0.02]'
                )}
              >
                {/* Selection indicator dot */}
                {isSelected && (
                  <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-primary" />
                )}

                {/* Mini theme preview */}
                <div className="w-full aspect-[4/3] rounded-lg overflow-hidden border border-gray-100 dark:border-white/[0.06] shadow-sm">
                  <div className="w-full h-full flex" style={{ backgroundColor: theme.preview.bg }}>
                    <div className="w-[22%] h-full" style={{ backgroundColor: theme.preview.sidebar }} />
                    <div className="flex-1 p-1.5 flex flex-col gap-1">
                      <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'var(--primary)', opacity: 0.6 }} />
                      <div className="flex-1 rounded" style={{ backgroundColor: theme.preview.card, border: '1px solid rgba(0,0,0,0.06)' }} />
                    </div>
                  </div>
                </div>

                {/* Label */}
                <div className="text-center">
                  <div className={cn(
                    'text-xs font-semibold',
                    isSelected ? 'text-primary' : 'text-slate-700 dark:text-slate-200'
                  )}>{theme.id}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{theme.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Accent Color */}
        <div className="pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Accent Color</label>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Customize the primary brand and highlight color across the entire application.</p>
            </div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 capitalize">
              {ACCENT_COLORS.find(c => c.id === accent)?.name || 'Blue'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {ACCENT_COLORS.map((color) => {
              const isSelected = accent === color.id;
              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => setAccent(color.id)}
                  title={color.name}
                  aria-label={`Select ${color.name} accent color`}
                  aria-pressed={isSelected}
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer shadow-xs',
                    color.previewClass,
                    'hover:scale-110 active:scale-95',
                    isSelected
                      ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ring-slate-900 dark:ring-white scale-105'
                      : 'hover:opacity-90'
                  )}
                >
                  {isSelected && (
                    <Check size={14} className="text-white drop-shadow-xs stroke-[3]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Interface Density */}
        <div className="pt-5 border-t border-border">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">Interface Density</label>
          <div className="flex gap-3">
            {(["Small", "Medium", "Large"] as const).map((size) => (
              <button type="button" key={size} onClick={() => setDensity(size)}
                aria-pressed={density === size}
                className={cn(
                  'px-4 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer',
                  density === size
                    ? 'border-primary/50 bg-primary/[0.06] text-primary dark:text-primary'
                    : 'border-gray-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-gray-300 dark:hover:border-white/[0.12]'
                )}>
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Apply button */}
        <div className="flex justify-end pt-3 border-t border-border">
          <button type="button" onClick={() => toast.success("Appearance settings saved successfully")}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer">
            <Save className="w-3.5 h-3.5" /> Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}

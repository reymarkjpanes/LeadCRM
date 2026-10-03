/**
 * Shared Cell Renderers — Standardized cell renderers for the DataGrid.
 *
 * These utilities provide consistent formatting and styling across all CRM modules:
 * - Date: "MMM DD, YYYY" via toLocaleDateString('en-US')
 * - Links: blue text (text-[#2563EB] dark:text-blue-400)
 * - Status badges: shared StatusBadge with module-specific variant maps
 * - Avatars: 32×32px, 10px font, module accent colors, gap-2.5
 *
 * @example
 * ```tsx
 * import { renderDate, renderLink, renderAvatar } from '@/shared/components/data-grid/cell-renderers';
 *
 * const cellRenderers = {
 *   createdAt: (_v, row) => renderDate(row.createdAt),
 *   website: (_v, row) => renderLink(row.website),
 *   firstName: (_v, row) => renderAvatar({ name: row.firstName, subtitle: row.company, accentColor: 'bg-blue-500' }),
 * };
 * ```
 */

'use client';

import React from 'react';
import { StatusBadge } from '@/shared/components/crm';

// ─── Date Renderer ───────────────────────────────────────────────────────────

/**
 * Formats a date value consistently as "MMM D, YYYY" (e.g., "Jan 15, 2025").
 * Returns em-dash "—" for null/undefined/empty values.
 *
 * Uses `toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })`
 * as specified by Requirement 6.5.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Renders a date cell with consistent styling and formatting.
 * Applies 12px font, muted text color, and truncation.
 */
export function renderDate(value: string | Date | null | undefined): React.ReactElement {
  return (
    <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">
      {formatDate(value)}
    </p>
  );
}

// ─── Link Renderer ───────────────────────────────────────────────────────────

/**
 * Renders a link cell with the standardized blue color.
 * Uses text-[#2563EB] (dark: blue-400) per Requirement 19.3.
 * Returns em-dash "—" for null/undefined/empty values.
 */
export function renderLink(
  value: string | null | undefined,
  options?: { onClick?: () => void }
): React.ReactElement {
  if (!value) {
    return <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 truncate">—</p>;
  }

  if (options?.onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); options.onClick!(); }}
        className="text-[12px] text-[#2563EB] dark:text-blue-400 truncate hover:underline text-left"
      >
        {value}
      </button>
    );
  }

  return (
    <p className="text-[12px] text-[#2563EB] dark:text-blue-400 truncate">
      {value}
    </p>
  );
}

// ─── Status Badge Renderer ───────────────────────────────────────────────────

/** Variant types supported by the StatusBadge component */
export type StatusVariant = 'success' | 'info' | 'warn' | 'danger' | 'purple' | 'neutral';

/** Module-specific status variant maps */
export const LEAD_STATUS_VARIANTS: Record<string, StatusVariant> = {
  Qualified: 'success',
  New: 'info',
  Contacted: 'info',
  Nurturing: 'purple',
  Unqualified: 'danger',
  Hot: 'danger',
  Warm: 'warn',
  Cold: 'neutral',
};

export const CONTACT_STATUS_VARIANTS = LEAD_STATUS_VARIANTS;


export const DEAL_PRIORITY_VARIANTS: Record<string, StatusVariant> = {
  High: 'danger',
  Medium: 'warn',
  Low: 'neutral',
};

/**
 * Renders a status badge with the shared StatusBadge component.
 * Falls back to 'neutral' variant for unknown statuses.
 */
export function renderStatusBadge(
  label: string | null | undefined,
  variantMap: Record<string, StatusVariant>,
  options?: { dot?: boolean; fallbackLabel?: string }
): React.ReactElement {
  const effectiveLabel = label ?? options?.fallbackLabel ?? '—';
  if (effectiveLabel === '—') {
    return <p className="text-[12px] text-[#5A6B85] dark:text-slate-400">—</p>;
  }
  const variant = variantMap[effectiveLabel] ?? 'neutral';
  return <StatusBadge label={effectiveLabel} variant={variant} dot={options?.dot} />;
}

// ─── Avatar Renderer ─────────────────────────────────────────────────────────

/** Module accent colors for avatar backgrounds */
export const MODULE_ACCENT_COLORS = {
  leads: 'bg-blue-500',
  contacts: 'bg-teal-500',
  accounts: 'bg-amber-500',
  deals: 'bg-indigo-500',
} as const;

export type ModuleAccentColor = typeof MODULE_ACCENT_COLORS[keyof typeof MODULE_ACCENT_COLORS];

interface AvatarRendererOptions {
  /** Full display name (used for initials + primary text) */
  name: string;
  /** Optional subtitle line (e.g., company name, city) */
  subtitle?: string | null;
  /** Background color class for the avatar circle */
  accentColor: string;
}

/**
 * Computes 1–2 character initials from a name string.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Renders an avatar cell with 32×32px circle, 10px font initials,
 * module accent color, and gap-2.5 between avatar and text.
 *
 * Per Requirements 19.1–19.5 for cross-module visual consistency.
 */
export function renderAvatar(options: AvatarRendererOptions): React.ReactElement {
  const { name, subtitle, accentColor } = options;
  const initials = getInitials(name || 'UN');

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div
        className={`w-8 h-8 rounded-full ${accentColor} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}
      >
        {initials}
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[#0F172A] dark:text-white truncate leading-tight">
          {name || '—'}
        </p>
        {subtitle && (
          <p className="text-[11px] text-[#5A6B85] dark:text-slate-400 truncate">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Text Cell Renderer ──────────────────────────────────────────────────────

/**
 * Renders a plain text cell with standard styling.
 * Returns em-dash "—" for null/undefined/empty values (Requirement 6.6).
 */
export function renderText(
  value: string | null | undefined,
  options?: { muted?: boolean }
): React.ReactElement {
  const displayValue = value?.trim() || '—';
  const colorClass = options?.muted || displayValue === '—'
    ? 'text-[#5A6B85] dark:text-slate-400'
    : 'text-[#0F172A] dark:text-slate-200';

  return (
    <p className={`text-[12px] ${colorClass} truncate`}>
      {displayValue}
    </p>
  );
}

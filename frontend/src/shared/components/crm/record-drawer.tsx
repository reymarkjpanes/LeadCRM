'use client';

import React, { useId, useRef, ReactNode } from 'react';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { OverlayOwnerContext, ThemedPortal } from '@/shared/components/theme-scope';
import { motion, AnimatePresence } from 'motion/react';
import { X, Edit, Phone, Mail, ListTodo, MoreHorizontal, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface KpiTile {
  label: string;
  value: string;
}

interface TabConfig {
  id: string;
  label: string;
}

interface RecordDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Module label shown above the name */
  moduleLabel: string;
  /** Avatar initials or element */
  avatar?: ReactNode;
  /** Record name */
  name: string;
  /** Subtitle (email, phone, close date) */
  subtitle?: string;
  /** Status/priority/probability badges */
  badges?: ReactNode;
  /** 4 KPI tiles */
  kpiTiles?: KpiTile[];
  /** Available tabs */
  tabs: TabConfig[];
  /** Currently active tab */
  activeTab: string;
  /** Tab change handler */
  onTabChange: (tabId: string) => void;
  /** Actions bar (Edit, Log call, Email, Task) */
  actions?: ReactNode;
  /** Tab content */
  children: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecordDrawer({
  isOpen,
  onClose,
  moduleLabel,
  avatar,
  name,
  subtitle,
  badges,
  kpiTiles,
  tabs,
  activeTab,
  onTabChange,
  actions,
  children,
}: RecordDrawerProps): React.ReactElement | null {

  const panelRef = useRef<HTMLDivElement>(null);
  const owner = useId();
  useModalInteraction({ open: isOpen, panelRef, owner, onClose });

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-[200]"
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            role="dialog"
            aria-modal="true"
            aria-label={`${name} details`}
            className="fixed inset-y-0 right-0 h-dvh min-w-0 w-full max-w-full sm:w-[560px] bg-card shadow-2xl z-[210] flex flex-col border-l border-[#E4E9F0] dark:border-slate-700"
          >
            {/* ── Header ──────────────────────────────────────────── */}
            <div className="px-5 pt-5 pb-4 border-b border-[#E4E9F0] dark:border-slate-700">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 text-[#5A6B85] hover:text-[#0F172A] dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close drawer"
              >
                <X size={18} />
              </button>

              {/* Avatar + Info */}
              <div className="flex items-start gap-3">
                {avatar && (
                  <div className="shrink-0">
                    {avatar}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B85] dark:text-slate-400 mb-0.5">
                    {moduleLabel}
                  </p>
                  <h2 className="text-lg font-bold text-[#0F172A] dark:text-white truncate">
                    {name}
                  </h2>
                  {subtitle && (
                    <p className="text-[12px] text-[#5A6B85] dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      {subtitle}
                    </p>
                  )}
                  {badges && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {badges}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions bar */}
              {actions && (
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  {actions}
                </div>
              )}
            </div>

            {/* ── KPI Tiles ────────────────────────────────────────── */}
            {kpiTiles && kpiTiles.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-[#E4E9F0] dark:border-slate-700">
                {kpiTiles.map((tile, idx) => (
                  <div
                    key={tile.label}
                    className={cn(
                      'px-4 py-3 text-center',
                      idx < kpiTiles.length - 1 && 'border-r border-[#E4E9F0] dark:border-slate-700',
                    )}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B85] dark:text-slate-400">
                      {tile.label}
                    </p>
                    <p className="text-sm font-bold text-[#0F172A] dark:text-white mt-0.5 tabular-nums">
                      {tile.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Tabs ────────────────────────────────────────────── */}
            <div className="flex shrink-0 flex-wrap items-center border-b border-[#E4E9F0] dark:border-slate-700 px-3 sm:px-5 gap-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    'px-3 py-2.5 text-[13px] font-medium transition-colors relative',
                    activeTab === tab.id
                      ? 'text-primary'
                      : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white',
                  )}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* ── Tab content ──────────────────────────────────────── */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 sm:px-5 py-4 custom-scrollbar">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof window === 'undefined') return null;
  return <OverlayOwnerContext.Provider value={owner}><ThemedPortal>{content}</ThemedPortal></OverlayOwnerContext.Provider>;
}

// ── Helper: Status Badge ───────────────────────────────────────────────────────

interface StatusBadgeProps {
  label: string;
  variant?: 'success' | 'info' | 'warn' | 'danger' | 'purple' | 'neutral';
  dot?: boolean;
}

export function StatusBadge({ label, variant = 'neutral', dot = true }: StatusBadgeProps): React.ReactElement {
  const variantStyles: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
    warn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    danger: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
    neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  };

  const dotStyles: Record<string, string> = {
    success: 'bg-emerald-500',
    info: 'bg-blue-500',
    warn: 'bg-amber-500',
    danger: 'bg-red-500',
    purple: 'bg-purple-500',
    neutral: 'bg-slate-400',
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-semibold',
      variantStyles[variant],
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', dotStyles[variant])} />}
      {label}
    </span>
  );
}

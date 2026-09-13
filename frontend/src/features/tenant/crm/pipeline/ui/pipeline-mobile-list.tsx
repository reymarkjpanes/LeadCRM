'use client';

import React, { useState } from 'react';
import { ChevronDown, Plus, User as UserIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { formatCurrency, type CurrencyConfig } from '@/shared/utils/currency';
import type { Deal, Pipeline, User as UserType } from '@/store/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PipelineMobileListProps {
  pipeline: Pipeline;
  deals: Deal[];
  users: UserType[];
  currencyConfig?: CurrencyConfig;
  canCreate?: boolean;
  onDealClick: (deal: Deal) => void;
  onAddDeal: (stageId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineMobileList({
  pipeline,
  deals,
  users,
  currencyConfig,
  canCreate = false,
  onDealClick,
  onAddDeal,
}: PipelineMobileListProps): React.ReactElement {
  // Track which stages are collapsed — all expanded by default
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set());

  const toggleStage = (stageId: string): void => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) {
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2 pb-4">
      {pipeline.stages.map((stage) => {
        const stageDeals = deals.filter((d) => d.stageId === stage.id);
        const isCollapsed = collapsedStages.has(stage.id);
        const stageValue = stageDeals.reduce((acc, d) => acc + (d.value ?? 0), 0);

        return (
          <div
            key={stage.id}
            className="rounded-xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] overflow-hidden"
          >
            {/* Stage header — tap to collapse/expand */}
            <button
              type="button"
              onClick={() => toggleStage(stage.id)}
              className="w-full flex items-center justify-between px-4 py-3 min-h-[52px] text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
              aria-expanded={!isCollapsed}
              aria-controls={`stage-content-${stage.id}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {stage.color && (
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden="true"
                  />
                )}
                <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                  {stage.name}
                </span>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-white/[0.06] px-2 py-0.5 rounded-full tabular-nums shrink-0">
                  {stageDeals.length}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                {stageValue > 0 && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatCurrency(stageValue, currencyConfig)}
                  </span>
                )}
                <ChevronDown
                  size={16}
                  className={cn(
                    'text-slate-400 transition-transform duration-200',
                    isCollapsed && '-rotate-90',
                  )}
                />
              </div>
            </button>

            {/* Collapsible deal list */}
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  id={`stage-content-${stage.id}`}
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 space-y-2">
                    {stageDeals.length === 0 && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4 italic">
                        No deals in this stage
                      </p>
                    )}

                    {stageDeals.map((deal) => {
                      const assignedUser = users.find((u) => u.id === deal.assignedUserId);

                      return (
                        <button
                          key={deal.id}
                          type="button"
                          onClick={() => onDealClick(deal)}
                          className="w-full text-left p-3 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.04] hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50/30 dark:hover:bg-blue-500/[0.04] transition-colors min-h-[60px] active:scale-[0.98]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                {deal.title}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {deal.companyName || 'Unknown Company'}
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-1 shrink-0">
                              {(deal.value ?? 0) > 0 && (
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                  {formatCurrency(deal.value ?? 0, currencyConfig)}
                                </span>
                              )}
                              <span
                                className={cn(
                                  'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border',
                                  deal.priority === 'High'
                                    ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                                    : deal.priority === 'Medium'
                                      ? 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20'
                                      : 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
                                )}
                              >
                                {deal.priority}
                              </span>
                            </div>
                          </div>

                          {assignedUser && (
                            <div className="flex items-center gap-1.5 mt-2">
                              <UserIcon size={11} className="text-slate-400 shrink-0" aria-hidden="true" />
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                                {assignedUser.firstName} {assignedUser.lastName}
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}

                    {/* Add Deal button — only shown when RBAC allows creation */}
                    {canCreate && (
                      <button
                        type="button"
                        onClick={() => onAddDeal(stage.id)}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-gray-200 dark:border-white/[0.08] text-slate-400 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50/20 dark:hover:bg-blue-500/[0.04] text-xs font-medium transition-colors min-h-[44px]"
                      >
                        <Plus size={14} aria-hidden="true" />
                        Add Deal
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

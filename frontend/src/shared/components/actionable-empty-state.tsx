'use client';

import React from 'react';
import { LucideIcon, Plus } from 'lucide-react';

interface ActionableEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const ActionableEmptyState: React.FC<ActionableEmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 dark:bg-white/[0.01] border border-dashed border-slate-200 dark:border-white/10 rounded-2xl my-4">
      <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 text-primary dark:text-primary flex items-center justify-center mb-3 shadow-xs">
        <Icon size={22} />
      </div>

      <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
        {title}
      </h4>

      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4 leading-relaxed">
        {description}
      </p>

      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary/90 text-white shadow-sm shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus size={14} />
          {actionLabel}
        </button>
      )}
    </div>
  );
};

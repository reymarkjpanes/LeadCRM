'use client';

import React, { useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, User, Calendar, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/shared/utils/currency';
import type { Deal, User as UserType } from '@/store/types';
import { CrmStatusBadge } from '@/shared/components/crm/crm-status';

interface PipelineDealCardProps {
  deal: Deal;
  assignedUser?: UserType;
  canDrag: boolean;
  onClick: (deal: Deal) => void;
}

const PRIORITY_CLASSES: Record<string, string> = {
  High: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20',
  HIGH: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20',
  Medium: 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20',
  MEDIUM: 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20',
};
const DEFAULT_PRIORITY = 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20';

export function PipelineDealCard({ deal, assignedUser, canDrag, onClick }: PipelineDealCardProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id, data: { type: 'Deal', deal }, disabled: !canDrag,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : 1,
  };

  const stale = !deal.isArchived && deal.staleness?.isStale && deal.staleness.stageId === deal.stageId ? deal.staleness : undefined;
  const staleDays = stale?.daysInactive ?? stale?.daysInStage;

  const handleClick = useCallback(() => { if (!isDragging) onClick(deal); }, [isDragging, onClick, deal]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleClick}
      className={cn(
        'p-4 rounded-xl border transition-colors cursor-pointer group relative select-none',
        isDragging
          ? 'border-blue-500/50 bg-blue-500/5 ring-2 ring-blue-500/20 shadow-2xl'
          : cn(
              !stale && 'bg-white dark:bg-slate-950',
              stale && 'bg-red-50/10 dark:bg-red-500/5 border-red-300 dark:border-red-500/30 hover:border-red-400',
              !stale && 'border-slate-200 dark:border-white/[0.05] hover:border-blue-500/40',
              'shadow-sm hover:shadow-md',
            ),
      )}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-start gap-2 flex-1">
          {canDrag && (
            <div
              {...attributes}
              {...listeners}
              className="mt-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-grab active:cursor-grabbing"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </div>
          )}
          <div className="flex flex-col">
            <h4 className={cn(
              'font-semibold text-slate-900 dark:text-white text-sm leading-tight group-hover:text-blue-500 transition-colors',
              !canDrag && 'ml-1',
            )}>
              {deal.title}
            </h4>
            <div className="flex items-center text-xs text-slate-500 dark:text-slate-400 mt-1">
              <User size={12} className="mr-1.5 shrink-0" />
              <span className="truncate">
                {deal.contactPerson} &middot; <strong className="font-medium text-slate-700 dark:text-slate-300">{deal.companyName}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        <CrmStatusBadge status={deal.engagementStatus} />
        {deal.value > 0 && (
          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20 px-2 py-0.5 rounded text-xs font-semibold shrink-0">
            {formatCurrency(deal.value)}
          </span>
        )}
        <span className={cn(
          'inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0',
          PRIORITY_CLASSES[deal.priority] || DEFAULT_PRIORITY,
        )}>
          {deal.priority}
        </span>
        {stale && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider shrink-0 bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
            title={`Stale deal: ${staleDays} ${staleDays === 1 ? 'day' : 'days'}${stale.daysInactive === undefined ? '' : ' inactive'} in ${stale.stageName} (threshold: ${stale.thresholdDays} ${stale.thresholdDays === 1 ? 'day' : 'days'})`}
          >
            <AlertTriangle size={10} />
            {staleDays}d
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 dark:border-white/[0.05]">
        <div className="flex items-center text-[11px] font-medium">
          {deal.expectedCloseDate ? (
            <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400" title="Expected Close Date">
              <Calendar size={12} />
              {new Date(deal.expectedCloseDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          ) : (
            <span className="opacity-0">-</span>
          )}
        </div>
        {assignedUser ? (
          <div
            className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center text-[9px] font-bold text-blue-700 dark:text-blue-400"
            title={`Assigned to ${assignedUser.firstName} ${assignedUser.lastName}`}
          >
            {assignedUser.firstName[0]}{assignedUser.lastName[0]}
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400" title="Unassigned">
            <User size={10} />
          </div>
        )}
      </div>
    </div>
  );
}

export default PipelineDealCard;

'use client';
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';

export interface FilterGroup {
  id: string;
  label: string;
  isExpanded?: boolean;
  items: FilterItem[];
}

interface FilterItem {
  id: string;
  label: string;
  count?: number;
  isChecked?: boolean;
}

interface ModuleFilterRailProps {
  filterContent?: React.ReactNode;
  showFilters: boolean;
  filterGroups?: FilterGroup[];
  onToggleFilters?: () => void;
  filterSearchTerm?: string;
  onFilterSearch?: (term: string) => void;
  onFilterToggle?: (groupId: string, itemId: string) => void;
  totalRecords?: number;
  onClearFilters?: () => void;
}

/** Leads filter rail: inline on desktop, a left drawer with a backdrop on mobile. */
export function ModuleFilterRail({ filterContent, showFilters, filterGroups, onToggleFilters, filterSearchTerm = '', onFilterSearch, onFilterToggle, totalRecords = 0, onClearFilters }: ModuleFilterRailProps) {
  const mobilePanel = useRef<HTMLElement>(null);
  const desktopPanel = useRef<HTMLElement>(null);
  const closeFilters = useRef(onToggleFilters);
  closeFilters.current = onToggleFilters;
  useEffect(() => {
    if (!showFilters) return;
    const fitPanel = () => {
      const panel = desktopPanel.current;
      if (!panel) return;
      const top = Math.max(0, panel.getBoundingClientRect().top);
      panel.style.setProperty('--filter-available-height', `${Math.max(0, window.innerHeight - top - 16)}px`);
    };
    fitPanel();
    window.addEventListener('resize', fitPanel);
    document.addEventListener('scroll', fitPanel, true);
    return () => {
      window.removeEventListener('resize', fitPanel);
      document.removeEventListener('scroll', fitPanel, true);
    };
  }, [showFilters]);
  useEffect(() => {
    if (!showFilters) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const isMobile = () => window.matchMedia('(max-width: 639px)').matches;
    if (isMobile()) mobilePanel.current?.querySelector('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFilters.current?.();
      if (event.key !== 'Tab' || !isMobile()) return;
      const controls = mobilePanel.current?.querySelectorAll<HTMLElement>('button, input, select');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [showFilters]);
  return <>
        {/* Filter Rail — backdrop for mobile */}
        {showFilters && filterGroups && (
          <div
            className="fixed inset-0 z-50 bg-black/30 sm:hidden"
            onClick={onToggleFilters}
            aria-hidden="true"
          />
        )}

        {/* Filter Rail — mobile: fixed overlay slide-in from left (hidden on sm+) */}
        <AnimatePresence>
          {showFilters && filterGroups && (
            <motion.aside
              ref={mobilePanel}
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              initial={{ x: -260, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -260, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-[60] w-[260px] max-w-full sm:hidden shadow-2xl"
            >
              <div className="w-full h-full flex flex-col bg-white dark:bg-slate-800 border-r border-[#E4E9F0] dark:border-slate-700 overflow-hidden">
                {/* Filter header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E9F0] dark:border-slate-700">
                  <span className="text-[13px] font-semibold text-[#0F172A] dark:text-white">
                    Filter by
                  </span>
                  <TooltipProvider><Tooltip><TooltipTrigger asChild>
                  <button
                    onClick={onToggleFilters}
                    className="p-1 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5A6B85] hover:text-[#0F172A] dark:hover:text-white rounded transition-colors"
                    aria-label="Close filters"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                  </TooltipTrigger><TooltipContent className="z-[70]">Close filters</TooltipContent></Tooltip></TooltipProvider>
                </div>
                {/* Filter search */}
                <div className="px-3 py-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={filterSearchTerm}
                      onChange={(e) => onFilterSearch?.(e.target.value)}
                      placeholder="Search filters"
                      aria-label="Search filters"
                      className="w-full h-8 pl-8 pr-3 text-[12px] rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 placeholder:text-[#5A6B85] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 transition-all"
                    />
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6B85]" aria-hidden="true" />
                  </div>
                </div>
                {/* Filter groups */}
                <div className="flex-1 overflow-y-auto px-3 py-1 custom-scrollbar">
                  {filterContent}
                  {filterGroups.map((group) => (
                    <FilterGroupSection
                      key={group.id}
                      group={group}
                      filterSearchTerm={filterSearchTerm}
                      onToggle={onFilterToggle}
                    />
                  ))}
                </div>
                {/* Footer */}
                <div className="px-4 py-2.5 border-t border-[#E4E9F0] dark:border-slate-700 text-[11.5px] text-[#5A6B85] dark:text-slate-400">
                  {totalRecords} records in this module
                  {onClearFilters && <button onClick={onClearFilters} className="block mt-2 text-blue-600 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600">Clear filters</button>}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Filter Rail — desktop: inline side panel animates width (hidden on mobile) */}
        <AnimatePresence>
          {showFilters && filterGroups && (
            <motion.aside
              ref={desktopPanel}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="hidden sm:block shrink-0 overflow-hidden"
            >
              <div className="w-[260px] h-full max-h-[var(--filter-available-height)] flex flex-col bg-white dark:bg-slate-800/40 border border-[#E4E9F0] dark:border-slate-700 rounded-xl mr-3 overflow-hidden">
                {/* Filter header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E9F0] dark:border-slate-700">
                  <span className="text-[13px] font-semibold text-[#0F172A] dark:text-white">
                    Filter by
                  </span>
                  <TooltipProvider><Tooltip><TooltipTrigger asChild>
                  <button
                    onClick={onToggleFilters}
                    className="p-1 text-[#5A6B85] hover:text-[#0F172A] dark:hover:text-white rounded transition-colors"
                    aria-label="Close filters"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                  </TooltipTrigger><TooltipContent className="z-[70]">Close filters</TooltipContent></Tooltip></TooltipProvider>
                </div>

                {/* Filter search */}
                <div className="px-3 py-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={filterSearchTerm}
                      onChange={(e) => onFilterSearch?.(e.target.value)}
                      placeholder="Search filters"
                      aria-label="Search filters"
                      className="w-full h-8 pl-8 pr-3 text-[12px] rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 placeholder:text-[#5A6B85] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 transition-all"
                    />
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6B85]" aria-hidden="true" />
                  </div>
                </div>

                {/* Filter groups */}
                <div className="flex-1 overflow-y-auto px-3 py-1 custom-scrollbar">
                  {filterContent}
                  {filterGroups.map((group) => (
                    <FilterGroupSection
                      key={group.id}
                      group={group}
                      filterSearchTerm={filterSearchTerm}
                      onToggle={onFilterToggle}
                    />
                  ))}
                </div>

                {/* Footer */}
                <div className="px-4 py-2.5 border-t border-[#E4E9F0] dark:border-slate-700 text-[11.5px] text-[#5A6B85] dark:text-slate-400">
                  {totalRecords} records in this module
                  {onClearFilters && <button onClick={onClearFilters} className="block mt-2 text-blue-600 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600">Clear filters</button>}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

  </>;
}

interface FilterGroupSectionProps {
  group: FilterGroup;
  filterSearchTerm?: string;
  onToggle?: (groupId: string, itemId: string) => void;
}

export function FilterGroupSection({ group, filterSearchTerm = '', onToggle }: FilterGroupSectionProps): React.ReactElement | null {
  const [isExpanded, setIsExpanded] = useState(group.isExpanded ?? true);

  const visibleItems = React.useMemo(() => {
    if (!filterSearchTerm.trim()) return group.items;
    const term = filterSearchTerm.toLowerCase().trim();
    return group.items.filter((item) => item.label.toLowerCase().includes(term));
  }, [group.items, filterSearchTerm]);

  if (visibleItems.length === 0 && filterSearchTerm.trim()) {
    return null;
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 w-full text-left py-1.5"
      >
        <ChevronDown
          size={12}
          className={cn(
            'text-[#5A6B85] transition-transform',
            !isExpanded && '-rotate-90',
          )}
        />
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[#5A6B85] dark:text-slate-400">
          {group.label}
        </span>
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-0.5 pl-1">
              {visibleItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={item.isChecked ?? false}
                    onChange={() => onToggle?.(group.id, item.id)}
                    className="w-3.5 h-3.5 rounded border-[#E4E9F0] dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]/20 cursor-pointer"
                    aria-label={`Filter by ${item.label}`}
                  />
                  <span className="flex-1 text-[12.5px] text-[#0F172A] dark:text-slate-200 truncate min-w-0">
                    {item.label}
                  </span>
                  {item.count !== undefined && (
                    <span className="text-[11px] text-[#5A6B85] dark:text-slate-500 tabular-nums shrink-0">
                      {item.count}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


'use client';

import React from 'react';

/**
 * KanbanBoardSkeleton — loading placeholder for the Pipeline kanban board.
 * Shown via app/(tenant)/crm/pipeline/loading.tsx during dynamic() chunk load.
 * Matches the approximate column + card structure of the real pipeline board.
 *
 * Accessibility: role="status" + aria-label so screen readers announce loading.
 * Motion: animate-pulse respects prefers-reduced-motion via motion-reduce:animate-none.
 */
export default function KanbanBoardSkeleton(): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading pipeline board"
      className="p-4 lg:p-6 flex gap-4 overflow-hidden"
    >
      {Array.from({ length: 4 }).map((_, colIdx) => (
        <div
          key={colIdx}
          className="flex-shrink-0 w-72 bg-white dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.06] rounded-xl overflow-hidden"
        >
          {/* Column header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2">
            <div className="h-3 w-24 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse motion-reduce:animate-none" />
            <div className="ml-auto h-5 w-6 rounded bg-slate-200 dark:bg-slate-700 animate-pulse motion-reduce:animate-none" />
          </div>
          {/* Cards */}
          <div className="p-3 space-y-2.5">
            {Array.from({ length: 3 }).map((_, cardIdx) => (
              <div
                key={cardIdx}
                className="bg-white dark:bg-slate-800/60 border border-gray-100 dark:border-white/[0.06] rounded-lg p-3.5 space-y-2"
              >
                <div className="h-3 w-3/4 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse motion-reduce:animate-none" />
                <div className="h-2.5 w-1/2 rounded-full bg-slate-100 dark:bg-slate-700/60 animate-pulse motion-reduce:animate-none" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-5 w-14 rounded-full bg-slate-100 dark:bg-slate-700/60 animate-pulse motion-reduce:animate-none" />
                  <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

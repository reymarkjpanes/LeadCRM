'use client';

import React, { type ReactNode, useEffect, useState } from 'react';
import { ThemedPortal } from '@/shared/components/theme-scope';
import { X } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';

/** Shared presentation for bulk row actions floating dock; each module retains its permission and mutation rules. */
export function SelectedRowsBar({ count, onClear, children, disabled = false }: {
  count: number; onClear: () => void; children: ReactNode; disabled?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || count <= 0) return null;

  const hasActions = Boolean(children) && (Array.isArray(children) ? children.some(Boolean) : true);

  return <ThemedPortal>{<div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-1.5 sm:px-4">
      <section
        data-selected-row-actions
        role="toolbar"
        aria-label="Selected row actions"
        className="pointer-events-auto flex max-w-[calc(100vw-0.75rem)] flex-wrap items-center justify-center gap-1 sm:max-w-[calc(100vw-2rem)] sm:gap-2.5 rounded-xl sm:rounded-2xl border border-border bg-card/95 px-2 py-1 sm:px-4 sm:py-2.5 shadow-2xl backdrop-blur-md text-xs sm:text-sm text-foreground animate-in fade-in slide-in-from-bottom-4 duration-200 [&_button]:shrink-0 [&_button]:whitespace-nowrap"
      >
        <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 sm:px-2.5 py-1 text-[10px] sm:text-sm font-medium text-primary shrink-0 whitespace-nowrap">
          <span aria-live="polite" className="tabular-nums font-semibold">{count} selected</span>
        </div>
        <div className="h-4 w-px bg-border shrink-0 hidden sm:block" aria-hidden="true" />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onClear}
          aria-label="Clear selection"
          className="text-muted-foreground hover:text-foreground text-[11px] sm:text-sm h-8 px-1 sm:px-2.5"
        >
          <X className="size-3.5 mr-0.5 sm:mr-1 shrink-0 opacity-70" aria-hidden="true" />
          <span className="hidden min-[360px]:inline">Clear selection</span>
        </Button>
        {hasActions && (
          <>
            <div className="h-4 w-px bg-gray-200 dark:bg-white/10 shrink-0" aria-hidden="true" />
            <div className="flex min-w-0 max-w-full flex-wrap justify-center items-center gap-1 sm:gap-2 [&_button]:!h-8 [&_button]:!min-h-8 [&_button]:!px-2 [&_button]:!text-[11px] sm:[&_button]:!h-9 sm:[&_button]:!min-h-9 sm:[&_button]:!px-3 sm:[&_button]:!text-sm">
              {children}
            </div>
          </>
        )}
      </section>
    </div>}</ThemedPortal>;
}


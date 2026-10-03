'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/shared/components/ui/button';

/** Shared presentation; each module retains its permission and mutation rules. */
export function SelectedRowsBar({ count, onClear, children, disabled = false }: {
  count: number; onClear: () => void; children: ReactNode; disabled?: boolean;
}) {
  const bar = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!count || !bar.current) return;
    const measure = () => setHeight(bar.current?.getBoundingClientRect().height ?? 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, [count]);
  if (!count) return null;
  return <>
    <div aria-hidden="true" style={{ height: height + 24 }} />
    {createPortal(<section ref={bar} role="toolbar" aria-label="Selected row actions"
      className="fixed inset-x-3 z-40 mx-auto flex w-fit flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-background p-3 text-sm text-foreground shadow-xl [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:rounded-lg [&_button]:px-3"
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))', maxWidth: 'calc(100vw - 1.5rem)' }}>
      <span aria-live="polite" className="whitespace-nowrap px-1 tabular-nums">{count} selected</span>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onClear}>Clear selection</Button>
      {children}
    </section>, document.body)}
  </>;
}

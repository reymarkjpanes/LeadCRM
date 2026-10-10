import type { ReactNode } from 'react';

// Presentation only: callers retain their existing dialog and form behavior.
export const panelThemeClass =
  'border-border bg-card text-card-foreground [--surface:var(--card)] [--text-primary:var(--card-foreground)]';
export const panelSurfaceClass =
  'h-dvh w-full max-w-lg sm:max-w-lg md:max-w-xl ' + panelThemeClass;
export const panelHeaderClass =
  'shrink-0 border-b border-border bg-muted/50 px-4 py-5 sm:px-6';
export const panelTitleClass =
  'text-xl font-bold tracking-tight text-foreground [overflow-wrap:anywhere]';
export const panelBodyClass =
  'min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6';
export const panelFooterClass =
  'shrink-0 flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6';
export const panelLabelClass =
  'block text-xs font-semibold text-muted-foreground';
export const panelInputClass =
  'min-h-[42px] w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:[--surface:var(--muted)]';
export const panelSecondaryButtonClass =
  'h-[42px] rounded-xl border-border bg-secondary px-5 text-secondary-foreground hover:bg-accent';
export const panelPrimaryButtonClass =
  'h-[42px] rounded-xl px-6 shadow-lg shadow-primary/20';
export const panelCloseClass =
  'h-11 w-11 shrink-0 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring';
export const panelPrimaryActionClass = panelPrimaryButtonClass +
  ' inline-flex items-center justify-center gap-2 bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
export const panelSecondaryActionClass = panelSecondaryButtonClass +
  ' inline-flex items-center justify-center gap-2 border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function PanelSectionHeading({ number, children }: { number: number; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-3 text-sm font-bold text-foreground">
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{number}</span>
      <span className="min-w-0">{children}</span>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
    </h3>
  );
}

import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';

/** Mirrors the builder's header, library, canvas and desktop inspector. */
export function WorkflowBuilderSkeleton() {
  return <div role="status" aria-label="Loading workflow builder" aria-live="polite" className="flex min-w-0 flex-col bg-[var(--background)] text-[var(--text-primary)]" style={{ height: 'calc(100dvh - 80px)', minHeight: 640 }}>
    <span className="sr-only">Loading workflow builder…</span>
    <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
      <header className="space-y-3 border-b border-[var(--border)] bg-[var(--card)] p-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-64 max-w-full"><DataLoadingSkeleton rowCount={1} columnCount={1} rowHeight={52} /></div>
          <div className="w-72 max-w-full"><DataLoadingSkeleton rowCount={1} columnCount={3} rowHeight={36} /></div>
        </div>
        <div className="max-w-lg"><DataLoadingSkeleton rowCount={1} columnCount={5} rowHeight={40} /></div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <aside aria-label="Builder library placeholder" className="hidden w-72 shrink-0 space-y-4 overflow-hidden border-r border-[var(--border)] p-4 xl:block">
          <DataLoadingSkeleton rowCount={2} columnCount={1} rowHeight={40} />
          <DataLoadingSkeleton rowCount={1} columnCount={3} rowHeight={40} />
          <DataLoadingSkeleton rowCount={5} columnCount={1} rowHeight={68} />
        </aside>
        <div className="border-b border-[var(--border)] p-2 xl:hidden"><div className="w-28"><DataLoadingSkeleton rowCount={1} columnCount={1} rowHeight={36} /></div></div>
        <section aria-label="Workflow canvas placeholder" className="flex min-w-0 flex-1 flex-col bg-[var(--muted)]/30">
          <DataLoadingSkeleton rowCount={1} columnCount={2} rowHeight={44} />
          <div className="mx-auto w-full max-w-sm space-y-0 px-6 py-10">
            {[0, 1, 2].map(index => <div key={index}>
              {index > 0 && <div className="mx-auto h-10 w-px bg-[var(--border)]" />}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"><DataLoadingSkeleton rowCount={2} columnCount={1} rowHeight={32} /></div>
            </div>)}
          </div>
        </section>
        <aside aria-label="Step configuration placeholder" className="hidden w-80 shrink-0 space-y-4 overflow-hidden border-l border-[var(--border)] p-4 xl:block">
          <DataLoadingSkeleton rowCount={1} columnCount={2} rowHeight={48} />
          <DataLoadingSkeleton rowCount={5} columnCount={1} rowHeight={64} />
        </aside>
      </div>
    </div>
  </div>;
}

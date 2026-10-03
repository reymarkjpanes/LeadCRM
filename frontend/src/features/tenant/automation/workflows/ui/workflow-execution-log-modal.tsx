'use client';
import { useEffect, useState } from 'react';
import type { WorkflowExecutionRun } from '@leadcrm/shared';
import { WORKFLOW_TRIGGERS } from '@leadcrm/shared';
import { workflowActionLabel } from '../services/workflow-editor';
import { workflowsApi } from '@/shared/services/workflows.api';
import { Button } from '@/shared/components/ui/button';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { X } from 'lucide-react';
interface WorkflowRunsProps {
  workflowId: string;
  name: string;
  status?: string;
  onClose: () => void;
}
export function WorkflowExecutionLogModal({
  workflowId,
  name,
  status,
  onClose,
}: WorkflowRunsProps) {
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent showClose={false} aria-label={`Runs — ${name}`} className="w-full max-w-full sm:max-w-[480px]">
        <header className="flex shrink-0 items-start gap-3 border-b border-border bg-card p-4">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Workflow runs{status ? ` · ${status}` : ''}</p>
            <h2 className="text-lg font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{name}</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClose} aria-label="Close workflow runs"><X size={16} /></Button>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4">
          <WorkflowRuns key={workflowId} workflowId={workflowId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
export function WorkflowRuns({ workflowId }: { workflowId: string }) {
  const [runs, setRuns] = useState<WorkflowExecutionRun[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    workflowsApi
      .getExecutions(workflowId, page)
      .then((response) => {
        if (!cancelled) setRuns(response.data);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : 'Unable to load runs.',
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, page, retry]);
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <p className="text-sm text-[var(--muted-foreground)]">
        Runs show the action order at execution time. Older runs may differ from
        the current canvas.
      </p>
      <Button
        variant="outline"
        disabled={loading}
        onClick={() => setRetry(retry + 1)}
      >
        Refresh activity
      </Button>
      {loading ? (
        <div role="status" aria-label="Loading workflow runs"><DataLoadingSkeleton rowCount={4} columnCount={2} /></div>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !runs.length ? (
        <p>
          No runs on this page. Activity appears after a matching CRM event.
        </p>
      ) : (
        runs.map((run) => (
          <details key={run.id} className="min-w-0 rounded-xl border border-border bg-card p-3">
            <summary className="cursor-pointer">
              {run.status} · {new Date(run.startedAt).toLocaleString()} ·{' '}
              {run.entityType}
            </summary>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Record: {run.trigger.payload?.recordName || run.entityType}
              <br />
              Trigger: {WORKFLOW_TRIGGERS.find(trigger => trigger.type === run.trigger.triggerType)?.label ?? run.trigger.triggerType.replaceAll('_', ' ')}
              <br />
              Finished:{' '}
              {run.completedAt
                ? new Date(run.completedAt).toLocaleString()
                : 'In progress or interrupted — review before replay'}
            </p>
            {run.errorMessage && <p role="alert">{run.errorMessage}</p>}
            <ol className="mt-3 space-y-2">
              {run.steps.map((step) => (
                <li key={step.id} className="rounded border border-[var(--border)] p-2">
                  {step.stepIndex + 1}. {workflowActionLabel(step.actionType)} —{' '}
                  {step.status}
                  {step.output?.reason === 'Action disabled' && (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Action disabled
                    </p>
                  )}
                  {step.error && (
                    <p className="text-red-600 dark:text-red-400">
                      {step.error}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </details>
        ))
      )}
      {
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={loading || page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>Page {page}</span>
          <Button
            variant="outline"
            disabled={loading || runs.length < 25}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      }
    </div>
  );
}

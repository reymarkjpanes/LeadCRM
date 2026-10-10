'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Workflow, WorkflowExecutionRun } from '@leadcrm/shared';
import { WORKFLOW_TRIGGERS, WORKFLOW_ASSIGNMENT_METHODS } from '@leadcrm/shared';
import { workflowActionLabel } from '../services/workflow-editor';
import { workflowsApi } from '@/shared/services/workflows.api';
import { Button } from '@/shared/components/ui/button';
import { StatusBadge } from '@/shared/components/crm/record-drawer';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { DataLoadingSkeleton } from '@/shared/components/crm/data-view-states';
import { useAuth } from '@/store/AuthContext';
import { RefreshButton } from '@/shared/components/crm/refresh-button';
import { LeadsPagination } from '@/shared/components/crm/leads-pagination';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';
import {
  panelBodyClass,
  panelCloseClass,
  panelHeaderClass,
  panelSurfaceClass,
  panelTitleClass,
} from '@/shared/components/side-panel-styles';
import { ChevronRight, X, MoreHorizontal, Edit, Pause, Play, Copy, Archive } from 'lucide-react';
interface WorkflowRunsProps {
  workflowId: string;
  name: string;
  status?: string;
  onClose: () => void;
  onUpdated?: () => void | Promise<unknown>;
}
export function WorkflowExecutionLogModal({
  workflowId,
  name,
  status,
  onClose,
  onUpdated,
}: WorkflowRunsProps) {
  const router = useRouter();
  const { userCan } = useAuth();
  const canViewRuns = userCan('workflows', 'canViewRuns');
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(canViewRuns);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    workflowsApi.get(workflowId).then(response => { if (!cancelled) setWorkflow(response.data); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load workflow.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workflowId, revision]);
  const refresh = () => { setLoading(true); setRunsLoading(canViewRuns); setRevision(value => value + 1); };
  const mutate = async (action: () => Promise<unknown>, message: string, propagateError = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); setArchiveOpen(false); await onUpdated?.(); refresh(); toast.success(message); }
    catch (reason) { if (propagateError) throw reason; toast.error(reason instanceof Error ? reason.message : 'Unable to update workflow.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const savedStatus = workflow ? workflow.isArchived ? 'Archived' : workflow.status === 'DRAFT' ? 'Draft' : workflow.isActive ? 'Active' : 'Paused' : status;
  const unavailable = busy || loading || !workflow || workflow.isArchived;
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent showClose={false} aria-label={`Workflow details — ${workflow?.name ?? name}`} className={panelSurfaceClass}>
        <header className={panelHeaderClass + ' flex flex-wrap items-start gap-2'}>
          <div className="min-w-0 flex-1">
            <p className="mb-1 flex flex-wrap items-center gap-1 text-xs font-medium text-muted-foreground">Workflow details{savedStatus && <> · <StatusBadge label={savedStatus} variant={savedStatus === 'Active' ? 'success' : savedStatus === 'Paused' ? 'warn' : 'neutral'} /></>}{workflow?.version ? ` · v${workflow.version}` : ''}</p>
            <h2 className={panelTitleClass}>{workflow?.name ?? name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <RefreshButton label="Refresh workflow activity" refreshing={loading || runsLoading} disabled={busy} onClick={refresh} />
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Workflow actions" title="Workflow actions"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent aria-label="Workflow actions menu">
                {userCan('workflows', 'canEdit') && <DropdownMenuItem disabled={unavailable} onSelect={() => router.push(`/automation/workflows/${workflowId}/edit`)}><Edit size={16} />Edit</DropdownMenuItem>}
                {userCan('workflows', 'canActivate') && <DropdownMenuItem disabled={unavailable} onSelect={() => void mutate(() => workflowsApi.toggle(workflowId, !workflow!.isActive), workflow?.isActive ? 'Workflow paused.' : 'Workflow activated.')}>
                  {workflow?.isActive ? <Pause size={16} /> : <Play size={16} />}{workflow?.isActive ? 'Pause' : 'Resume'}
                </DropdownMenuItem>}
                {userCan('workflows', 'canDuplicate') && <DropdownMenuItem disabled={busy || loading || !workflow} onSelect={() => void mutate(() => workflowsApi.duplicate(workflowId), 'Workflow duplicated as a draft.')}><Copy size={16} />Duplicate</DropdownMenuItem>}
                {userCan('workflows', 'canArchive') && <DropdownMenuItem disabled={unavailable} destructive onSelect={() => setArchiveOpen(true)}><Archive size={16} />Archive</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className={panelCloseClass} onClick={onClose} aria-label="Close workflow details"><X size={16} /></Button>
          </div>
        </header>
        {error && <p role="alert" className="px-4 py-2 text-sm text-red-600">{error}</p>}
        {workflow?.description && <p className="px-4 pt-4 text-sm text-muted-foreground [overflow-wrap:anywhere] sm:px-6">{workflow.description}</p>}
        {canViewRuns ? <WorkflowRuns key={workflowId} workflowId={workflowId} layout="panel" refreshVersion={revision} onLoadingChange={setRunsLoading} /> : <p className="p-4 text-sm text-muted-foreground">Run history requires permission to view workflow runs.</p>}
        <ConfirmActionDialog open={archiveOpen} onOpenChange={setArchiveOpen} title="Archive workflow?" description="This pauses the workflow and preserves its run history." confirmLabel="Archive" variant="destructive" isLoading={busy}
          onConfirm={() => mutate(() => workflowsApi.archive(workflowId), 'Workflow archived.', true)} />
      </SheetContent>
    </Sheet>
  );
}
function runStatusClass(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'failed':
      return 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
    case 'running':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
}

export function WorkflowRuns({ workflowId, layout = 'inline', refreshVersion = 0, onLoadingChange }: { workflowId: string; layout?: 'inline' | 'panel'; refreshVersion?: number; onLoadingChange?: (loading: boolean) => void }) {
  const [runs, setRuns] = useState<WorkflowExecutionRun[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onLoadingChange?.(true);
    setError('');
    workflowsApi
      .getExecutions(workflowId, page, pageSize)
      .then((response) => {
        if (!cancelled) {
          setRuns(response.data); setTotal(response.meta.total);
          const lastPage = Math.max(1, Math.ceil(response.meta.total / pageSize));
          if (page > lastPage) setPage(lastPage);
        }
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : 'Unable to load runs.',
          );
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); onLoadingChange?.(false); }
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, page, pageSize, retry, refreshVersion, onLoadingChange]);
  return (
    <div className={'min-w-0 [overflow-wrap:anywhere] ' + (layout === 'panel' ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4')}>
      <div className={layout === 'panel' ? panelBodyClass + ' space-y-4' : 'space-y-4'}>
        <p className="text-sm text-[var(--muted-foreground)]">
          Runs show the action order at execution time. Older runs may differ from
          the current canvas.
        </p>
        {layout === 'inline' && <RefreshButton label="Refresh workflow activity" refreshing={loading} onClick={() => { setLoading(true); setRetry(value => value + 1); }} />}
        {loading ? (
          <div role="status" aria-label="Loading workflow runs"><DataLoadingSkeleton rowCount={4} columnCount={2} /></div>
        ) : error ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
        ) : !runs.length ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600 dark:border-white/10 dark:bg-slate-800/50 dark:text-slate-300">
            No runs on this page. Activity appears after a matching CRM event.
          </p>
        ) : (
          runs.map((run) => (
            <details key={run.id} className="group min-w-0 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
              <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-4 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-slate-800/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" size={16} className="mt-1 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className={'rounded-full px-2.5 py-1 text-xs font-semibold capitalize ' + runStatusClass(run.status)}>{run.status}</span>
                  <span className="text-slate-600 dark:text-slate-300">{formatDateTime(run.startedAt, { seconds: true })} · {run.entityType}</span>
                  {run.workflowVersion != null && <span className="text-xs text-muted-foreground">v{run.workflowVersion}</span>}
                </span>
              </summary>
              <div className="space-y-3 border-t border-slate-100 p-4 dark:border-white/5">
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  Record: {run.trigger.payload?.recordName || run.entityType}
                  <br />
                  Trigger: {WORKFLOW_TRIGGERS.find(trigger => trigger.type === run.trigger.triggerType)?.label ?? run.trigger.triggerType.replaceAll('_', ' ')}
                  <br />
                  Finished:{' '}
                  {run.completedAt
                    ? formatDateTime(run.completedAt, { seconds: true })
                    : 'In progress or interrupted — review before replay'}
                </p>
                {run.errorMessage && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{run.errorMessage}</p>}
                {run.definitionSnapshot ? <details className="min-w-0 text-sm">
                  <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Definition used in this run{run.workflowVersion != null ? ` · v${run.workflowVersion}` : ''}</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">{JSON.stringify(run.definitionSnapshot, null, 2)}</pre>
                </details> : <p className="text-xs text-muted-foreground">Definition snapshot unavailable for this older run.</p>}
                <ol className="space-y-2">
                  {run.steps.map((step) => (
                    <li key={step.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-slate-800/50">
                      {step.stepIndex + 1}. {workflowActionLabel(step.actionType)} —{' '}
                      {step.status}
                      {typeof step.output?.resolvedUserId === 'string' && <p className="mt-1 text-xs text-muted-foreground">
                        {step.status === 'failed' ? 'Selected assignee:' : 'Assigned to'} {typeof step.output.resolvedUserName === 'string' ? step.output.resolvedUserName : step.output.resolvedUserId}
                        {typeof step.output.strategy === 'string' && Object.entries(WORKFLOW_ASSIGNMENT_METHODS).some(([method]) => method === step.output!.strategy) && ` · ${String(step.output.assignmentTargetName ?? step.output.assignmentTargetType)} · ${Object.entries(WORKFLOW_ASSIGNMENT_METHODS).find(([method]) => method === step.output!.strategy)?.[1]}`}
                      </p>}
                      {typeof step.output?.resolvedUserId === 'string' && typeof step.output.reason === 'string' && <p className="mt-1 text-xs text-muted-foreground">{step.output.reason}</p>}
                      {typeof step.output?.workload === 'number' && <p className="mt-1 text-xs text-muted-foreground">Workload before assignment: {step.output.workload}{typeof step.output.capacityLimit === 'number' ? ` / ${step.output.capacityLimit}` : ''}</p>}
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
              </div>
            </details>
          ))
        )}
      </div>
      {!loading && !error && <div className={layout === 'panel' ? 'shrink-0 px-2 pb-3' : undefined}>
        <LeadsPagination currentPage={page} totalRecords={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
      </div>}
    </div>
  );
}

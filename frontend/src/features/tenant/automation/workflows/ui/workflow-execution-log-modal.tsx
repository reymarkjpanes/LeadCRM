'use client';
import { useEffect, useRef, useState } from 'react';
import { useReadRecordNotifications } from '@/features/tenant/notifications/hooks/use-record-notifications';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from '@/shared/utils/toast';
import { WorkflowDefinitionSummary, emptySnapshotOptions } from './workflow-definition-summary';
import { workflowStateAction, workflowRunOutcome, WORKFLOW_TRIGGERS, WORKFLOW_ASSIGNMENT_METHODS } from '@leadcrm/shared';
import { workflowActionLabel } from '../services/workflow-editor';
import { workflowsApi } from '@/shared/services/workflows.api';
import { Button } from '@/shared/components/ui/button';
import { StatusBadge } from '@/shared/components/crm/record-drawer';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { Sheet, SheetContent } from '@/shared/components/ui/sheet';
import { DataLoadingSkeleton, DataLoadingSpinner } from '@/shared/components/crm/data-view-states';
import { useAuth } from '@/store/AuthContext';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
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
import { ChevronRight, X, MoreHorizontal, Eye, Edit, Pause, Play, Copy, Archive } from 'lucide-react';
// Historical runs retain the method that actually executed, including retired methods.
const executionAssignmentMethods = new Map<string, string>(Object.entries({
  ...WORKFLOW_ASSIGNMENT_METHODS, least_workload: 'Least workload', random: 'Random',
  availability: 'Availability-based', capacity: 'Capacity-based', sticky: 'Previous assignee / Sticky assignment',
}));
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
  const canDelete = userCan('workflows', 'canDelete');
  const [revision, setRevision] = useState(0);
  const [runsLoading, setRunsLoading] = useState(canViewRuns);
  const { data: workflowResponse, isInitialLoad, isRefreshing, error, refetch } = useCachedPage({
    module: 'workflows', params: { type: 'execution-workflow', workflowId },
    disabled: !userCan('workflows', 'canView'), revalidateOnInvalidation: true,
    fetchFn: signal => workflowsApi.get(workflowId, signal),
  });
  const workflow = workflowResponse?.data ?? null;
  const loading = isInitialLoad || isRefreshing;
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const lock = useRef(false);
  useEffect(() => { if (!canDelete) setArchiveOpen(false); }, [canDelete]);
  const refresh = () => { setRevision(value => value + 1); void refetch(); };
  const mutate = async (action: () => Promise<unknown>, message: string, propagateError = false) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      await action(); setArchiveOpen(false);
      try { await onUpdated?.(); toast.success(message); }
      catch { toast.warning(`${message} Refresh the list to see the changes.`); }
      refresh();
    }
    catch (reason) { if (propagateError) throw reason; toast.error(reason instanceof Error ? reason.message : 'Unable to update workflow.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const savedStatus = workflow ? workflow.isArchived ? 'Archived' : workflow.status === 'DRAFT' ? 'Draft' : workflow.isActive ? 'Active' : 'Paused' : status;
  const unavailable = busy || loading || !workflow || workflow.isArchived;
  useReadRecordNotifications('Workflow', workflowId, !loading && !error && !!workflow && !workflow.isArchived);
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
                <DropdownMenuItem disabled={unavailable} onSelect={() => router.push(`/automation/workflows/${workflowId}/edit?view=true`)}><Eye size={16} />View definition</DropdownMenuItem>
                {userCan('workflows', 'canEdit') && <DropdownMenuItem disabled={unavailable} onSelect={() => router.push(`/automation/workflows/${workflowId}/edit`)}><Edit size={16} />Edit</DropdownMenuItem>}
                {workflow && userCan('workflows', workflowStateAction(workflow, !workflow.isActive)) && <DropdownMenuItem disabled={unavailable || (!workflow?.isActive && !!workflow?.repairReason)} onSelect={() => void mutate(() => workflowsApi.toggle(workflowId, !workflow!.isActive), workflow?.isActive ? 'Workflow paused.' : 'Workflow activated.')}>
                  {workflow?.isActive ? <Pause size={16} /> : <Play size={16} />}{workflow?.isActive ? 'Pause' : workflow.status === 'PAUSED' ? 'Resume' : 'Activate'}
                </DropdownMenuItem>}
                {userCan('workflows', 'canDuplicate') && <DropdownMenuItem disabled={busy || loading || !workflow} onSelect={() => void mutate(() => workflowsApi.duplicate(workflowId), 'Workflow duplicated as a draft.')}><Copy size={16} />Duplicate</DropdownMenuItem>}
                {canDelete && <DropdownMenuItem disabled={unavailable} destructive onSelect={() => setArchiveOpen(true)}><Archive size={16} />Archive</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className={panelCloseClass} onClick={onClose} aria-label="Close workflow details"><X size={16} /></Button>
          </div>
        </header>
        {error && <p role="alert" className="px-4 py-2 text-sm text-red-600">{error}</p>}
        {workflow?.repairReason && <p role="alert" className="px-4 pt-4 text-sm text-destructive sm:px-6">{workflow.repairReason}</p>}
        {workflow?.description && <p className="px-4 pt-4 text-sm text-muted-foreground [overflow-wrap:anywhere] sm:px-6">{workflow.description}</p>}
        {canViewRuns ? <WorkflowRuns key={workflowId} workflowId={workflowId} layout="panel" refreshVersion={revision} onLoadingChange={setRunsLoading} /> : <p className="p-4 text-sm text-muted-foreground">Run history requires permission to view workflow runs.</p>}
        <ConfirmActionDialog open={archiveOpen} onOpenChange={setArchiveOpen} title="Archive workflow?" description="This pauses the workflow and preserves its run history." confirmLabel="Archive" variant="destructive" isLoading={busy}
          confirmDisabled={!canDelete} onConfirm={() => canDelete ? mutate(() => workflowsApi.archive(workflowId), 'Workflow archived.', true) : Promise.resolve()} />
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
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
}

export function WorkflowRuns({ workflowId, layout = 'inline', refreshVersion = 0, onLoadingChange }: { workflowId: string; layout?: 'inline' | 'panel'; refreshVersion?: number; onLoadingChange?: (loading: boolean) => void }) {
  const { userCan } = useAuth();
  const canViewRuns = userCan('workflows', 'canViewRuns');
  const optionScope = JSON.stringify(['users', 'roles', 'groups', 'products', 'leads', 'contacts', 'accounts', 'deals', 'campaigns', 'templates'].map(module => userCan(module, 'canView')));
  // The shared reader evicts both history and optional labels when authorization or group scope changes.
  const { data: optionData } = useCachedPage({
    module: 'workflows', params: { type: 'execution-reference-options', workflowId, optionScope },
    disabled: !canViewRuns || !userCan('workflows', 'canView'), revalidateOnInvalidation: true,
    fetchFn: async signal => (await workflowsApi.options(signal)).data,
  });
  const options = optionData ?? emptySnapshotOptions;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data, isInitialLoad, isRefreshing, error, refetch } = useCachedPage({
    module: 'workflows', params: { type: 'execution-outcomes', workflowId, page, pageSize, view: 'outcomes' },
    disabled: !canViewRuns, intervalMs: 30000, pauseWhenHidden: true, revalidateOnInvalidation: true,
    fetchFn: signal => workflowsApi.getExecutions(workflowId, page, pageSize, 'outcomes', signal),
  });
  const runs = (data?.data ?? []).flatMap(run => {
    const outcome = workflowRunOutcome(run.status);
    return outcome ? [{ ...run, outcome }] : [];
  });
  const total = data?.meta.total ?? 0;
  const loading = isInitialLoad || isRefreshing;
  const previousRefresh = useRef(refreshVersion);
  useEffect(() => {
    if (previousRefresh.current === refreshVersion) return;
    previousRefresh.current = refreshVersion;
    void refetch();
  }, [refreshVersion, refetch]);
  useEffect(() => { onLoadingChange?.(loading); }, [loading, onLoadingChange]);
  useEffect(() => {
    if (data) setPage(current => Math.min(current, Math.max(1, Math.ceil(data.meta.total / pageSize))));
  }, [data, pageSize]);
  if (!canViewRuns) return <p className="text-sm text-muted-foreground">Run history requires permission to view workflow runs.</p>;
  return (
    <div className={'min-w-0 [overflow-wrap:anywhere] ' + (layout === 'panel' ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4')}>
      <div className={'relative ' + (layout === 'panel' ? panelBodyClass + ' space-y-4' : 'space-y-4')} aria-busy={loading}>
        {loading && !!runs.length && <DataLoadingSpinner label="Refreshing workflow runs..." hideLabel className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card/95 p-3" />}
        <p className="text-sm text-[var(--muted-foreground)]">
          Runs show the action order at execution time. Older runs may differ from
          the current canvas.
        </p>
        {layout === 'inline' && <RefreshButton label="Refresh workflow activity" refreshing={loading} onClick={() => void refetch()} />}
        {loading && !runs.length ? (
          <div role="status" aria-label="Loading workflow runs"><DataLoadingSkeleton rowCount={4} columnCount={2} /></div>
        ) : error && !runs.length ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>
        ) : !loading && !runs.length ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600 dark:border-white/10 dark:bg-slate-800/50 dark:text-slate-300">
            No finished runs on this page. Results appear after a matching CRM event is processed.
          </p>
        ) : (
          runs.map((run) => (
            <details key={run.id} className="group min-w-0 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
              <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" size={16} className="mt-1 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className={'rounded-full px-2.5 py-1 text-xs font-semibold capitalize ' + runStatusClass(run.outcome)}>{run.outcome}</span>
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
                    : 'Completion time unavailable for this older run'}
                </p>
                {run.entityId && ['lead', 'contact', 'account', 'deal'].includes(run.entityType) && userCan(`${run.entityType}s`, 'canView') && <Link className="inline-flex rounded text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href={`/crm/${run.entityType}s/${encodeURIComponent(run.entityId)}`}>Open {run.entityType}</Link>}
                {run.errorMessage && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{run.errorMessage}</p>}
                {run.status === 'interrupted' && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">The action outcome is uncertain. Review CRM and delivery history before replay; automatic replay is disabled.</p>}
                {run.definitionSnapshot ? <details className="min-w-0 text-sm">
                  <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Definition used in this run{run.workflowVersion != null ? ` · v${run.workflowVersion}` : ''}</summary>
                  <WorkflowDefinitionSummary definition={run.definitionSnapshot} options={options} />
                </details> : <p className="text-xs text-muted-foreground">Definition snapshot unavailable for this older run.</p>}
                <ol className="space-y-2">
                  {run.steps.map((step) => (
                    <li key={step.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-white/10 dark:bg-slate-800/50">
                      {step.stepIndex + 1}. {workflowActionLabel(step.actionType)} —{' '}
                      {step.status}
                      {typeof step.output?.resolvedUserId === 'string' && <p className="mt-1 text-xs text-muted-foreground">
                        {['success', 'completed'].includes(step.status) ? 'Assigned to' : 'Selected assignee:'} {typeof step.output.resolvedUserName === 'string' ? step.output.resolvedUserName : step.output.resolvedUserId}
                        {typeof step.output.strategy === 'string' && executionAssignmentMethods.has(step.output.strategy) && ` · ${String(step.output.assignmentTargetName ?? step.output.assignmentTargetType)} · ${executionAssignmentMethods.get(step.output.strategy)}`}
                      </p>}
                      {typeof step.output?.reason === 'string' && <p className="mt-1 text-xs text-muted-foreground">{step.output.reason}</p>}
                      {typeof step.output?.associationSummary === 'string' && <p className="mt-1 text-sm">{step.output.associationSummary}</p>}
                      {Array.isArray(step.output?.deals) && userCan('deals', 'canView') && <p className="mt-1 text-xs text-muted-foreground">{step.output.deals.flatMap(deal => deal && typeof deal === 'object' && 'title' in deal && typeof deal.title === 'string' ? [deal.title] : []).join(', ')}</p>}
                      {Array.isArray(step.output?.warnings) && <ul className="mt-1 list-inside list-disc text-xs text-amber-800 dark:text-amber-200">{step.output.warnings.filter((warning): warning is string => typeof warning === 'string').map(warning => <li key={warning}>{warning}</li>)}</ul>}
                      {typeof step.output?.workload === 'number' && <p className="mt-1 text-xs text-muted-foreground">Workload before assignment: {step.output.workload}{typeof step.output.capacityLimit === 'number' ? ` / ${step.output.capacityLimit}` : ''}</p>}
                      {typeof step.output?.taskId === 'string' && userCan('tasks', 'canView') && <Link className="mt-2 inline-flex rounded text-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href={`/operations/taskboard?taskId=${encodeURIComponent(step.output.taskId)}`}>Open Task</Link>}
                      {typeof step.output?.cleanupWarning === 'string' && <p className="mt-1 text-xs text-muted-foreground">{step.output.cleanupWarning}</p>}
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
        {error && !!runs.length && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      {(!loading || !!runs.length) && <div className={layout === 'panel' ? 'shrink-0 px-2 pb-3' : undefined}>
        <LeadsPagination currentPage={page} totalRecords={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
      </div>}
    </div>
  );
}

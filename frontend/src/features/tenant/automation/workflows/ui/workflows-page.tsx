'use client';
import { StatusBadge } from '@/shared/components/crm/record-drawer';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { useNotificationRecordLink } from '@/features/tenant/notifications/hooks/use-notification-record-link';
import { PageHeader } from '@/shared/components/ui/page-header';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { type Workflow, type WorkflowDraft, type TriggerDefinition, type ActionDefinition } from '@leadcrm/shared';
import { Eye, Edit, Copy, Activity, Pause, Play, Archive } from 'lucide-react';
import { DataGrid, type DataGridColumnDef, type SortState } from '@/shared/components/data-grid';
import { TableIconButton } from '@/shared/components/data-grid/table-icon-button';
import { FilterButton } from '@/shared/components/crm/filter-button';
import { ModuleTableToolbar } from '@/shared/components/crm/module-table-toolbar';
import { useModuleTableColumns } from '@/shared/hooks/use-module-table-columns';
import { WORKFLOWS_TABLE_COLUMNS } from '@leadcrm/shared';
import { ModuleFilterRail } from '@/shared/components/crm/module-filter-rail';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { useAuth } from '@/store/AuthContext';
import { workflowsApi, getWorkflowMetadata } from '@/shared/services/workflows.api';
import { BulkSelectionBar, executeSelectedRows } from '@/shared/components/crm/bulk-selection-bar';
import { Button, CreateButton } from '@/shared/components/ui/button';

import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';

import { LeadsPagination } from '@/shared/components/crm/leads-pagination';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { WorkflowExecutionLogModal } from './workflow-execution-log-modal';
import { WorkflowCreateDialog } from './workflow-create-dialog';
export function toWorkflowDraft(workflow: Workflow): WorkflowDraft {
  return { name: workflow.name, description: workflow.description, trigger: workflow.trigger, conditions: workflow.conditions,
    actions: workflow.actions, isActive: workflow.isActive };
}
export default function WorkflowsPage() {
  const router = useRouter();
  const { user, tenant, userCan, isLoading: authLoading, authError } = useAuth();
  const canView = userCan('workflows', 'canView'), canCreate = userCan('workflows', 'canCreate');
  const canEdit = userCan('workflows', 'canEdit'), canDelete = userCan('workflows', 'canArchive');
  const canActivate = userCan('workflows', 'canActivate'), canDuplicate = userCan('workflows', 'canDuplicate'), canViewRuns = userCan('workflows', 'canViewRuns');
  const [metadata, setMetadata] = useState<{triggers:TriggerDefinition[];actions:ActionDefinition[]} | null>(null);
  const [metadataError, setMetadataError] = useState('');
  const [retry, setRetry] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ field: 'createdAt', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [runs, setRuns] = useState<Workflow | null>(null);
  const [archiving, setArchiving] = useState<Workflow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { setSelected(new Set()); setArchiving(null); setRuns(null); }, [tenant?.id, page, pageSize, search, statuses, triggers]);
  useNotificationRecordLink('workflowId', (tenant?.id ?? '') + ':' + (user?.id ?? ''), canView && canViewRuns,
    async id => (await workflowsApi.get(id)).data, setRuns);
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  useEffect(() => {
    if (authLoading || authError || !canView || !tenant?.id) return;
    let cancelled = false;
    setMetadata(null); setMetadataError('');
    const request = getWorkflowMetadata(`${tenant.id}:${user?.id}`);
    request.then(result => { if (!cancelled) setMetadata(result); }).catch(failure => { if (!cancelled) setMetadataError(failure instanceof Error ? failure.message : 'Unable to load workflow options.'); });
    return () => { cancelled = true; };
  }, [tenant?.id, user?.id, authLoading, authError, canView, retry]);
  const { data, isInitialLoad, isRefreshing, error: workflowsError, refetch: refreshWorkflows } = useCachedPage({
    module: 'workflows', params: { page, pageSize, search, statuses, triggers, sort }, disabled: !canView,
    fetchFn: () => workflowsApi.list({ sort: `${sort.field}:${sort.direction}`, page, limit: pageSize, search, status: statuses.join(','), trigger: triggers.join(',') }),
  });
  const workflows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const workflowsLoading = isInitialLoad || isRefreshing;
  useEffect(() => { if (data && page > Math.max(1, Math.ceil(total / pageSize))) setPage(Math.max(1, Math.ceil(total / pageSize))); }, [data, total, page, pageSize]);
  const triggerLabel = (type: string) => (metadata?.triggers.find(trigger => trigger.type === type)?.label ?? type).replace(/Client Profile/gi, 'Contact');
  const clearFilters = () => { setSearch(''); setStatuses([]); setTriggers([]); setPage(1); };
  const columns: DataGridColumnDef<Workflow>[] = [
    { id: 'name', sortable: true, header: 'Name', accessor: row => row.name, width: 240 },
    { id: 'trigger', header: 'Trigger', accessor: row => triggerLabel(row.trigger), width: 210 },
    { id: 'status', header: 'Status', accessor: row => row.status === 'DRAFT' ? 'Draft' : row.isActive ? 'Active' : 'Paused', width: 110,
      cell: (_, row) => <StatusBadge label={row.status === 'DRAFT' ? 'Draft' : row.isActive ? 'Active' : 'Paused'} variant={row.status === 'DRAFT' ? 'neutral' : row.isActive ? 'success' : 'warn'} /> },
    { id: 'lastRun', header: 'Last run', accessor: row => row.lastRunAt, width: 230,
      cell: (_, row) => <span title={formatDateTime(row.lastRunAt, { seconds: true })}>{formatDateTime(row.lastRunAt, { seconds: true })}</span> },
    { id: 'runs', header: 'Runs', accessor: row => row.totalRuns ?? 0, width: 190,
      cell: (_, row) => <div><span>{row.totalRuns ?? 0} total</span><span className="block text-xs text-slate-500">{row.successfulRuns ?? 0} successful / {row.failedRuns ?? 0} failed</span></div> },
    { id: 'actions', header: 'Actions', accessor: row => row.id, width: 170,
      cell: (_, workflow) => <div className="flex items-center gap-1">
        <TableIconButton touchFriendly label="View runs" disabled={!canViewRuns} onClick={() => setRuns(workflow)}><Activity size={14} /></TableIconButton>
        {canDuplicate && <TableIconButton touchFriendly label="Duplicate workflow" disabled={busy} onClick={() => duplicateWorkflow(workflow)}><Copy size={14} /></TableIconButton>}
        {canActivate && <TableIconButton touchFriendly label={workflow.isActive ? 'Pause workflow' : workflow.status === 'PAUSED' ? 'Resume workflow' : 'Activate workflow'} disabled={busy} onClick={() => toggleWorkflow(workflow)}>{workflow.isActive ? <Pause size={14} /> : <Play size={14} />}</TableIconButton>}
      </div> },
  ];
  const tableColumns = useModuleTableColumns('workflows', WORKFLOWS_TABLE_COLUMNS, columns.filter(column => canViewRuns || !['lastRun', 'runs'].includes(column.id)));
  async function mutate(work: () => Promise<unknown>, message: string, propagateError = false) {
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true);
    try { await work(); await refreshWorkflows(); toast.success(message); }
    catch (failure) { if (propagateError) throw failure; toast.error(failure instanceof Error ? failure.message : 'Unable to complete this action.'); }
    finally { mutationLock.current = false; setBusy(false); }
  }
  const duplicateWorkflow = (workflow: Workflow) => void mutate(async () => {
    await workflowsApi.duplicate(workflow.id);
  }, 'Workflow duplicated as a draft.');
  const toggleWorkflow = (workflow: Workflow) => void mutate(() => workflowsApi.toggle(workflow.id, !workflow.isActive), workflow.isActive ? 'Workflow paused.' : 'Workflow activated.');
  if (!canView) return <p className="p-6 text-[var(--text-primary)]">You do not have permission to view workflows.</p>;
  return <div className="p-4 sm:p-6 space-y-6 text-[var(--text-primary)]">
    <PageHeader title="Workflows" subtitle="Automate CRM actions based on triggers and conditions." actions={canCreate && <CreateButton label="Create Workflow" disabled={!metadata || busy} onClick={() => setCreateOpen(true)} />} />
    {metadataError && <div role="alert">{metadataError} <Button variant="outline" onClick={() => setRetry(retry + 1)}>Retry options</Button></div>}
    {workflowsError && <div role="alert">{workflowsError} <Button variant="outline" onClick={() => void refreshWorkflows()}>Retry workflows</Button></div>}
    {tableColumns.drawer}
    <ModuleTableToolbar label="Workflows" search={search} onSearch={value => { setSearch(value); setPage(1); }} placeholder="Search workflows..."
      filter={<FilterButton title="Workflows" open={showFilters} active={!!(statuses.length || triggers.length)} onClick={() => setShowFilters(!showFilters)} />}
      refreshing={workflowsLoading} onRefresh={refreshWorkflows} onManageColumns={tableColumns.openColumns} />
    <div className="flex items-start gap-3 min-w-0">
      <ModuleFilterRail showFilters={showFilters} onToggleFilters={() => setShowFilters(false)} filterSearchTerm={filterSearch} onFilterSearch={setFilterSearch} totalRecords={total} onClearFilters={clearFilters}
        filterGroups={[
          { id: 'status', label: 'Status', items: ['Active', 'Paused', 'Draft'].map(label => ({ id: label.toUpperCase(), label, isChecked: statuses.includes(label.toUpperCase()) })) },
          { id: 'trigger', label: 'Trigger', items: (metadata?.triggers ?? []).map(trigger => ({ id: trigger.type, label: triggerLabel(trigger.type), isChecked: triggers.includes(trigger.type) })) },
        ]}
        onFilterToggle={(group, id) => { const setter = group === 'status' ? setStatuses : setTriggers; setter(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); setPage(1); }} />
      <div className="min-w-0 flex-1">
        {workflowsLoading ? <TableLoadingState label="Loading workflows..." /> : <DataGrid<Workflow> sort={sort} sortingMode="external" onSortChange={next => { setSort(next ?? { field: 'createdAt', direction: 'desc' }); setPage(1); }} columns={tableColumns.columns} data={workflows} getRowId={row => row.id} height="auto" selectable={canActivate || canDelete} selectedIds={selected} onSelectionChange={setSelected}
          onRowClick={workflow => setRuns(workflow)} rowActions={workflow => [
            { id: 'view', label: 'View', icon: <Eye size={14} />, onClick: () => setRuns(workflow) },
            ...(canEdit ? [{ id: 'edit', label: 'Edit', icon: <Edit size={14} />, disabled: busy, onClick: () => router.push(`/automation/workflows/${workflow.id}/edit`) }] : []),
            ...(canDuplicate ? [{ id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, disabled: busy, onClick: () => duplicateWorkflow(workflow) }] : []),
            ...(canActivate ? [{ id: 'pause', label: workflow.isActive ? 'Pause' : workflow.status === 'PAUSED' ? 'Resume' : 'Activate', icon: workflow.isActive ? <Pause size={14} /> : <Play size={14} />, disabled: busy, onClick: () => toggleWorkflow(workflow) }] : []),
            ...(canDelete ? [{ id: 'archive', label: 'Archive', icon: <Archive size={14} />, separator: true, disabled: busy, onClick: () => setArchiving(workflow) }] : []),
          ]} enableColumnMenu={false} ariaLabel="Workflows table"
          summaryLabel={`${total} total ${total === 1 ? 'record' : 'records'}`} emptyMessage={workflowsError ? 'Unable to load workflows.' : 'No workflows match. Create a workflow or adjust your filters.'} />}
        <LeadsPagination currentPage={page} totalRecords={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} loading={isInitialLoad} refreshing={isRefreshing} disabled={workflowsLoading} />
      </div>
    </div>
    <BulkSelectionBar selectedCount={selected.size} selectedIds={selected} onClearSelection={() => setSelected(new Set())} onRemoveIds={ids => setSelected(previous => new Set([...previous].filter(id => !ids.includes(id))))}
      actions={[
        ...(canActivate ? [{ id: 'pause', label: 'Pause', destructive: false, onExecute: async (ids: string[]) => { const result = await executeSelectedRows(ids, async id => { const current = (await workflowsApi.get(id)).data; if (current.isActive) await workflowsApi.toggle(id, false); }); await refreshWorkflows(); return result; } }] : []),
        ...(canDelete ? [{ id: 'archive', label: 'Archive', destructive: true, entityName: 'workflow', onExecute: async (ids: string[]) => { const result = await executeSelectedRows(ids, workflowsApi.archive); await refreshWorkflows(); return result; } }] : []),
      ]} />
    {createOpen && canCreate && metadata && <WorkflowCreateDialog key={`${tenant?.id}:${user?.id}`} triggers={metadata.triggers} actions={metadata.actions} onClose={() => setCreateOpen(false)} onChoose={index => { router.push(index === undefined ? '/automation/workflows/new' : `/automation/workflows/new?template=${index}`); setCreateOpen(false); }} />}
    {runs && <WorkflowExecutionLogModal key={runs.id} workflowId={runs.id} name={runs.name} status={runs.status === 'DRAFT' ? 'Draft' : runs.isActive ? 'Active' : 'Paused'} onUpdated={refreshWorkflows} onClose={() => setRuns(null)} />}
    <ConfirmActionDialog open={!!archiving} onOpenChange={open => {if (!open) setArchiving(null);}} title="Archive workflow?" description="This pauses the workflow and preserves its run history." confirmLabel="Archive" variant="destructive" onConfirm={async () => { if (archiving) await mutate(async () => {await workflowsApi.archive(archiving.id);setSelected(new Set());setArchiving(null);},'Workflow archived.', true); }} />
  </div>;
}

"use client";
import { matchesDealView } from '@leadcrm/shared';
import { ExportCsvButton } from '@/shared/components/crm/export-csv-button';
import { PageHeader } from '@/shared/components/ui/page-header';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/shared/utils/toast';
import { useData } from '@/store/DataContext';
import { getAssignableAgents } from '@/shared/utils/assigned-agents';
import { useAuth } from '@/store/AuthContext';
import { useCrmTabs } from '@/shared/hooks/use-crm-tabs';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCachedPage } from '@/shared/hooks/use-cached-page';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { toFrontendDeal } from '@/lib/api/adapters/deal.adapter';
import { ModuleFilterRail, type FilterGroup } from '@/shared/components/crm/module-filter-rail';
import { FilterButton } from '@/shared/components/crm/filter-button';
import { RefreshButton } from '@/shared/components/crm/refresh-button';
import { ModuleTabs } from '@/shared/components/crm/module-tabs';
import { ModuleSearchInput } from '@/shared/components/crm/module-search-input';
import { DataLoadingSpinner } from '@/shared/components/crm/data-view-states';
import { DealPanel } from '@/shared/components/crm';
import { DealFormSheet } from '@/features/tenant/crm/deals/ui/deal-form';
import { DealLostDialog } from '@/shared/components/crm/deal-lost-dialog';
import { PipelineKanbanBoard } from './pipeline-kanban-board';
import KanbanBoardSkeleton from '@/shared/components/kanban-skeleton';
import { Button, CreateButton } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { getTenantCurrency } from '@/shared/utils/currency';
import type { Deal } from '@/store/types';

export default function PipelinePage({ navigate }: { navigate?: (path: string) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pipelines, deals, users, addDeals, moveDealStage, refreshPipelines } = useData();
  const { user, tenant } = useAuth();
  const tabAccess = useCrmTabs('deals', [{ id: 'all', label: 'All Deals' }, { id: 'my', label: 'My Deals' }]);
  const canCreate = useHasPermission('deals.create'), canEdit = useHasPermission('deals.edit'), canDelete = useHasPermission('deals.archive');
  const highlightId = searchParams.get('highlight');
  const [activeHighlightId, setActiveHighlightId] = useState(highlightId);
  useEffect(() => { setActiveHighlightId(highlightId); }, [highlightId]);
  // A deliberate detail destination remains distinct from a search locator.
  const detailId = searchParams.get('dealId');
  const targetId = highlightId || detailId;
  const targetKey = `${user?.id}:${tenant?.id}:${targetId}:${tabAccess.permissionKey}`;
  const [resolvedTarget, setResolvedTarget] = useState<{ key: string; deal: Deal } | null>(null);
  const [targetError, setTargetError] = useState('');
  const [locatedTargetKey, setLocatedTargetKey] = useState<string>();
  const target = resolvedTarget?.key === targetKey ? resolvedTarget.deal : undefined;
  const availablePipelines = pipelines.filter(p => !p.isArchived);
  const defaultPipeline = availablePipelines.find(p => p.name.trim().toLowerCase() === 'sales pipeline') ?? availablePipelines[0];
  const pipeline = target ? availablePipelines.find(p => p.id === target.pipelineId)
    : availablePipelines.find(p => p.id === searchParams.get('pipelineId')) ?? defaultPipeline;
  const initialStageId = (pipeline?.stages.find(s => s.isDefault) ?? pipeline?.stages.find(s => s.name.toLowerCase() === 'lead'))?.id ?? pipeline?.stages[0]?.id;
  const [search, setSearch] = useState('');
  const [selectedTab, setSelectedTab] = useState(searchParams.get('tab') || 'all');
  const activeTab = tabAccess.tabs.some(tab => tab.id === selectedTab) ? selectedTab : tabAccess.firstId;
  const myDeals = activeTab === 'my';
  useEffect(() => {
    if (selectedTab !== activeTab) setSelectedTab(activeTab);
    const expected = activeTab === 'all' ? null : activeTab || null;
    if (searchParams.get('tab') !== expected) {
      const params = new URLSearchParams(searchParams.toString());
      if (expected) params.set('tab', expected); else params.delete('tab');
      router.replace('/crm/deals?' + params.toString(), { scroll: false });
    }
  }, [activeTab, selectedTab, searchParams, router]);
  const [showFilters, setShowFilters] = useState(false), [filterSearch, setFilterSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const refreshPending = useRef(false);
  const [pipelineError, setPipelineError] = useState('');
  const [selected, setSelected] = useState<Deal | null>(null);
  React.useLayoutEffect(() => { setSelected(null); }, [tabAccess.firstId]);
  useEffect(() => {
    setResolvedTarget(null); setTargetError('');
    if (!tabAccess.firstId || !targetId || !user?.id || !tenant?.id) return;
    const controller = new AbortController();
    setSelected(null);
    const read = USE_MOCK_DATA ? Promise.resolve({ data: deals.find(deal => deal.id === targetId) })
      : apiClient.get<{ data: Record<string, unknown> }>('/crm/deals/' + encodeURIComponent(targetId), { signal: controller.signal });
    void read.then(async response => {
      if (controller.signal.aborted) return;
      if (!response.data || response.data.id !== targetId || response.data.isArchived || ('deletedAt' in response.data && response.data.deletedAt)) {
        throw new Error('This Deal is no longer available.');
      }
      const deal = USE_MOCK_DATA ? response.data as Deal : toFrontendDeal(response.data as Record<string, unknown>);
      if (!USE_MOCK_DATA && !availablePipelines.some(p => p.id === deal.pipelineId && p.stages.some(stage => stage.id === deal.stageId))) {
        await refreshPipelines();
        if (controller.signal.aborted) return;
      }
      setResolvedTarget({ key: targetKey, deal });
      if (detailId && !highlightId) setSelected(deal);
      const params = new URLSearchParams(searchParams.toString());
      if (deal.pipelineId && params.get('pipelineId') !== deal.pipelineId) {
        params.set('pipelineId', deal.pipelineId);
        router.replace('/crm/deals?' + params.toString(), { scroll: false });
      }
    }).catch(error => { if (!controller.signal.aborted) {
      const message = error instanceof Error ? error.message : 'This Deal is unavailable or you do not have access.';
      setTargetError(message); toast.error(message);
    } });
    return () => controller.abort();
  }, [targetKey, router]);
  const [createStage, setCreateStage] = useState<string>();
  const [lost, setLost] = useState<{ id: string; stageId: string }>();
  const query = useCachedPage<Deal[]>({ module: 'deals', params: { pipelineId: pipeline?.id, scope: activeTab }, disabled: USE_MOCK_DATA || !pipeline || !activeTab,
    revalidateOnInvalidation: true, fetchFn: async signal => {
      const records: Deal[] = [];
      for (let page = 1; ; page++) {
        const response = await apiClient.get<{ data: Record<string, unknown>[]; meta: { hasMore: boolean } }>('/crm/deals', { signal, params: { pipelineId: pipeline!.id, scope: activeTab, page, limit: 100 } });
        records.push(...response.data.map(toFrontendDeal));
        if (!response.meta.hasMore) break;
      }
      return records;
    } });
  useEffect(() => {
    setLocatedTargetKey(undefined);
    if (!target || target.pipelineId !== pipeline?.id) return;
    let current = true;
    // A second search in the same pipeline must revalidate its list too: a newly
    // created or moved Deal may not be in the previously loaded board snapshot.
    void query.refetchSilently().then(() => { if (current) setLocatedTargetKey(targetKey); });
    return () => { current = false; };
  }, [targetKey, target?.id, pipeline?.id, query.refetchSilently]);
  const reloadPipelines = async () => {
    setPipelineError('');
    try { await refreshPipelines(); }
    catch (error) { setPipelineError(error instanceof Error ? error.message : 'Unable to load Sales Pipeline'); }
  };
  useEffect(() => { if (!pipeline) void reloadPipelines(); }, [pipeline?.id]);
  const refresh = async () => {
    if (refreshPending.current || query.isRefreshing || query.isInitialLoad) return;
    refreshPending.current = true; setRefreshing(true);
    try { await Promise.all([query.refetch(), reloadPipelines()]); } finally { refreshPending.current = false; setRefreshing(false); }
  };
  const patch = (deal?: Deal) => {
    if (!deal) { void query.refetchSilently(); return; }
    const rows = query.data ?? [];
    query.setData(deal.isArchived || deal.pipelineId !== pipeline?.id ? rows.filter(d => d.id !== deal.id) : rows.some(d => d.id === deal.id) ? rows.map(d => d.id === deal.id ? deal : d) : [...rows, deal]);
    setSelected(current => current?.id === deal.id ? deal : current);
  };
  const openDeal = (deal: Deal) => {
    setSelected(deal);
    setActiveHighlightId(null);
    if (!highlightId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('highlight');
    if (deal.pipelineId) params.set('pipelineId', deal.pipelineId);
    router.replace('/crm/deals?' + params.toString(), { scroll: false });
  };
  const all = (USE_MOCK_DATA ? deals : query.data ?? []).filter(d => d.pipelineId === pipeline?.id && !d.isArchived);
  const stageStatus = (deal: Deal) => { const stage = pipeline?.stages.find(s => s.id === deal.stageId); return stage?.isWon ? 'Won' : stage?.isLost ? 'Lost' : 'Open'; };
  const exportView = { search, my: myDeals, filters,
    accountId: searchParams.get('accountId') || searchParams.get('organizationId') || undefined,
    leadId: searchParams.get('leadId') || undefined, contactId: searchParams.get('contactId') || undefined };
  const hasExportData = all.some(deal => matchesDealView({ ...deal, status: stageStatus(deal) }, exportView, user?.id ?? ''));
  const visible = all.filter(deal => (highlightId && target?.id === deal.id) || matchesDealView({ ...deal, status: stageStatus(deal) }, exportView, user?.id ?? ''));
  const locatedDeal = target && all.find(deal => deal.id === target.id);
  const locatorMessage = targetError || (target && !query.isInitialLoad && !query.isRefreshing && !query.error &&
    (!pipeline || locatedTargetKey === targetKey && (!locatedDeal || !pipeline.stages.some(stage => stage.id === locatedDeal.stageId)))
    ? 'This Deal is no longer available in an accessible pipeline stage.' : '');
  const groups: FilterGroup[] = [
    { id: 'stage', label: 'Stage', items: pipeline?.stages.map(s => ({ id: s.id, label: s.name })) ?? [] },
    { id: 'owner', label: 'Assigned Agent', items: [...getAssignableAgents(users, ['deals']).map(u => ({ id: u.id, label: `${u.firstName} ${u.lastName}` })), { id: 'unassigned', label: 'Unassigned' }] },
    { id: 'product', label: 'Product Interest', items: [...new Set(all.flatMap(d => d.productInterests ?? []))].map(name => ({ id: name, label: name })) },
    { id: 'priority', label: 'Priority', items: ['Low', 'Medium', 'High'].map(name => ({ id: name, label: name })) },
    { id: 'status', label: 'Deal Status', items: ['Open', 'Won', 'Lost'].map(name => ({ id: name, label: name })) },
    { id: 'created', label: 'Created Date', items: [{ id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: '90', label: 'Last 90 days' }] },
  ].map(group => ({ ...group, isExpanded: true, items: group.items.map(item => ({ ...item, isChecked: filters[group.id]?.includes(item.id) })) }));
  const move = async (id: string, stageId: string, reason?: string) => {
    if (pipeline?.stages.find(s => s.id === stageId)?.isLost && !reason) { setLost({ id, stageId }); return; }
    try { const next = await moveDealStage(id, stageId, undefined, reason); patch(next); setLost(undefined); toast.success('Deal stage updated.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to move Deal'); throw error; }
  };
  if (!tabAccess.firstId) return <p role="alert" className="p-4">You do not have permission to access this module.</p>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <PageHeader title="Deals" subtitle="Track opportunities throughout your pipelines." actionsInlineWithTitle
      actions={pipeline && <div className="flex items-center gap-2">
        {canCreate && <CreateButton label="New Deal" disabled={!initialStageId} onClick={() => setCreateStage(initialStageId)} />}
      </div>} />
    <ModuleTabs tabs={tabAccess.tabs} activeTab={activeTab} onTabChange={setSelectedTab} ariaLabel="Deals views" className="mb-3" />
    <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
      <ModuleSearchInput value={search} onChange={setSearch} placeholder="Search deals..." label="Search deals" />
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:contents">
        <div className="contents min-w-0 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
          <div className="flex shrink-0 items-center gap-2 sm:contents">
            <FilterButton title="Deals" open={showFilters} onClick={() => setShowFilters(!showFilters)} className="h-11 sm:h-8" />
            <ExportCsvButton module="deals" hasData={hasExportData}
              disabled={!pipeline || query.isInitialLoad || query.isRefreshing || refreshing || !!query.error || !!pipelineError}
              params={{ pipelineId: pipeline?.id, scope: activeTab, view: JSON.stringify(exportView) }} />
          </div>
          <label className="order-last flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground sm:order-none sm:w-auto">Pipeline<Input type="text" readOnly aria-label="Pipeline" value={pipeline?.name ?? ''} size={pipeline?.name.length || 1} className="h-8 w-auto min-w-0 max-w-[min(18rem,calc(100vw-5rem))] rounded-lg border-border bg-card px-2 py-0 text-xs text-foreground dark:border-border dark:bg-card" /></label>
        </div>
        <div className="ml-auto shrink-0"><RefreshButton onClick={refresh} disabled={query.isRefreshing || query.isInitialLoad} refreshing={refreshing} /></div>
      </div>
    </div>
    <div className="flex min-h-0 min-w-0 flex-1 gap-3">
      <ModuleFilterRail showFilters={showFilters} filterGroups={groups} onToggleFilters={() => setShowFilters(false)} filterSearchTerm={filterSearch} onFilterSearch={setFilterSearch} totalRecords={all.length} onClearFilters={() => setFilters({})} onFilterToggle={(group, item) => setFilters(old => ({ ...old, [group]: old[group]?.includes(item) ? old[group].filter(id => id !== item) : [...(old[group] ?? []), item] }))} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {(query.error || pipelineError) && <p role="alert" className="rounded border border-red-200 p-3 text-sm text-red-600">{query.error || pipelineError}</p>}
        {locatorMessage && <p role="alert" className="text-sm text-destructive">{locatorMessage}</p>}
        {!USE_MOCK_DATA && (query.isInitialLoad && !query.data || !pipeline && !pipelineError && !locatorMessage) ? <KanbanBoardSkeleton /> : pipeline ? <div className="relative flex min-h-[440px] min-w-0 flex-1 overflow-hidden" aria-busy={refreshing || query.isRefreshing}>{refreshing && <DataLoadingSpinner label="Refreshing deals..." hideLabel className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-card/95 p-3" />}<PipelineKanbanBoard pipeline={pipeline} deals={visible} highlightDealId={!locatorMessage && locatedDeal?.id === activeHighlightId ? activeHighlightId : undefined} users={users} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} currencyConfig={getTenantCurrency(tenant)} onDealClick={openDeal} onDealMutated={patch} onDealDragEnd={move} onAddDeal={setCreateStage} onLoadMore={() => {}} loadingStages={new Set()} hasMoreByStage={{}} /></div> : null}
      </div>
    </div>
    <DealPanel open={!!selected} deal={selected} onOpenChange={open => { if (!open) setSelected(null); }} />
    <DealFormSheet isOpen={!!createStage} mode="create" onClose={() => setCreateStage(undefined)} preselect={{ pipelineId: pipeline?.id, stageId: createStage }} onSubmit={async values => { await addDeals(values); setCreateStage(undefined); await query.refetchSilently(); }} />
    {lost && <DealLostDialog onClose={() => setLost(undefined)} onSave={reason => move(lost.id, lost.stageId, reason)} />}

  </div>;
}

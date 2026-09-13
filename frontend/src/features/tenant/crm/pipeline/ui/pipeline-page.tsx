'use client';

import { uuid } from '@/lib/utils';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { useFilterUrlSync } from '@/shared/hooks/use-filter-url-sync';
import { useDebounce } from '@/shared/hooks/use-debounce';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { USE_MOCK_DATA } from '@/lib/config';
import { ModuleErrorBoundary } from '@/shared/components/error-boundary';
import {
  Plus, X, Settings, ChevronRight, ChevronDown,
  LayoutGrid, Table, List, SlidersHorizontal, RotateCcw, Search,
  Shield, Layers, Rocket, Trash2, CheckCircle2, Archive, AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { Deal, Stage, Pipeline } from '@/store/types';
import { motion } from 'motion/react';
import { DealPanel } from '@/shared/components/crm';
import { HandoffModal } from './handoff-modal';
import EmptyState from '@/shared/components/empty-state';
import { DealFormSheet } from '@/features/tenant/crm/deals/ui/deal-form';
import type { CreateDealFormData, UpdateDealFormData } from '@/features/tenant/crm/deals/ui/deal-form';
import { PipelineKanbanBoard } from './pipeline-kanban-board';
import { PipelineMobileList } from './pipeline-mobile-list';
import { PipelineTableView } from './pipeline-table-view';
import { PIPELINE_TEMPLATES, STAGE_BADGE_CLASSES, DEFAULT_STAGE_BADGE } from './pipeline-templates';
import { usePipelineViewMode } from '../hooks/use-pipeline-view-mode';
import ForecastBar from './forecast-bar';
import type { ForecastResult } from './forecast-bar';
import { formatCurrency, getTenantCurrency } from '@/shared/utils/currency';

// ── Table columns config for PipelineTableView ────────────────────────────────
const TABLE_COLUMNS = [
  { key: 'title', label: 'Deal / Title', sortable: true },  { key: 'companyName', label: 'Company', sortable: true },
  { key: 'value', label: 'Value', sortable: true },  { key: 'stageId', label: 'Stage', sortable: true },
  { key: 'assignedUserId', label: 'Assigned', sortable: true },  { key: 'expectedCloseDate', label: 'Expected Close', sortable: true },
  { key: 'priority', label: 'Priority', sortable: true },
];

// ── Main Page Component ───────────────────────────────────────────────────────

export default function PipelinePage({ navigate }: { navigate: (path: string) => void }): React.ReactElement {
  const {
    pipelines,
    deals,
    updateDeal,
    moveDealStage,
    addDeal,
    addPipeline,
    updatePipeline,
    deletePipeline,
    deleteDeal,
    users,
    tasks,
    addTask,
    updateTask,
    isBillingModuleEnabled,
  } = useData();
  const { user, tenant } = useAuth();
  const tenantCurrency = useMemo(() => getTenantCurrency(tenant), [tenant]);

  // ── RBAC via useHasPermission ────────────────────────────────────────────
  const canCreateDeal = useHasPermission('deals.create');
  const canEditDeal = useHasPermission('deals.edit');
  const canDeleteDeal = useHasPermission('deals.delete');
  const canManagePipelines = useHasPermission('deals.create');
  // ── Pipeline selection ───────────────────────────────────────────────────
  const [activePipelineId, setActivePipelineId] = useState(pipelines[0]?.id || '');

  useEffect(() => {
    if (!activePipelineId && pipelines.length > 0) {
      setActivePipelineId(pipelines[0].id);
    }
  }, [pipelines, activePipelineId]);

  // ── Forecast state (server-side weighted forecast) ───────────────────────
  const [forecastData, setForecastData] = useState<ForecastResult | null>(null);

  useEffect(() => {
    if (USE_MOCK_DATA || !activePipelineId) {
      setForecastData(null);
      return;
    }

    let cancelled = false;

    apiClient
      .get<{ success: boolean; data: ForecastResult }>('/crm/deals/forecast', {
        params: { pipelineId: activePipelineId },
      })
      .then((response) => {
        if (!cancelled) {
          setForecastData(response.data);
        }
      })
      .catch(() => {
        // Silently fall back to client-side forecast on error
        if (!cancelled) {
          setForecastData(null);
        }
      });

    return () => { cancelled = true; };
  }, [activePipelineId]);

  // ── URL sync & view mode ─────────────────────────────────────────────────
  const { getParam, getArrayParam, updateParams } = useFilterUrlSync();
  const urlViewParam = getParam('view');
  const { viewMode, setViewMode: handleViewModeChange } = usePipelineViewMode(urlViewParam);
  // ── Filter state ─────────────────────────────────────────────────────────
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>(() => getParam('status') || 'all');
  const [filterStages, setFilterStages] = useState<string[]>(() => getArrayParam('stages'));
  const [filterStaff, setFilterStaff] = useState<string[]>(() => getArrayParam('staff'));
  const [filterPriority, setFilterPriority] = useState<string[]>(() => getArrayParam('priority'));
  const [searchQuery, setSearchQuery] = useState(() => getParam('search'));
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Table sort state
  const [tableSortField, setTableSortField] = useState<string | null>(null);
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('asc');
  // Sync to URL
  useEffect(() => {
    updateParams({
      view: viewMode !== 'kanban' ? viewMode : null,
      search: debouncedSearchQuery || null,
      status: filterStatus !== 'all' ? filterStatus : null,
      stages: filterStages,
      staff: filterStaff,
      priority: filterPriority,
    });
  }, [viewMode, debouncedSearchQuery, filterStatus, filterStages, filterStaff, filterPriority, updateParams]);

  // ── Automation mode ──────────────────────────────────────────────────────
  const [isAutomatedOnly, setIsAutomatedOnly] = useState(() => localStorage.getItem('is_automated_pipeline_only') === 'true');
  const toggleAutomatedOnly = (): void => { const v = !isAutomatedOnly; setIsAutomatedOnly(v); localStorage.setItem('is_automated_pipeline_only', String(v)); };
  // ── Modal state ──────────────────────────────────────────────────────────
  const [isDealFormOpen, setIsDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [dealFormPreselect, setDealFormPreselect] = useState<{ pipelineId?: string; stageId?: string }>({});
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const [pipelineModalStep, setPipelineModalStep] = useState<'template' | 'name'>('template');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('inquiry');
  const [isManagePipelinesModalOpen, setIsManagePipelinesModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [dealToDelete, setDealToDelete] = useState<Deal | null>(null);
  const [isDeleteDealModalOpen, setIsDeleteDealModalOpen] = useState(false);
  const [pipelineToDeleteId, setPipelineToDeleteId] = useState<string | null>(null);
  const [isDeletePipelineModalOpen, setIsDeletePipelineModalOpen] = useState(false);
  const [isLostReasonModalOpen, setIsLostReasonModalOpen] = useState(false);
  const [dealBeingLost, setDealBeingLost] = useState<Deal | null>(null);
  const [isHandoffModalOpen, setIsHandoffModalOpen] = useState(false);
  const [dealBeingWon, setDealBeingWon] = useState<Deal | null>(null);
  const [targetWonStageId, setTargetWonStageId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [isTransitioning] = useState(false);
  // ── Derived data ─────────────────────────────────────────────────────────
  const activePipeline = pipelines.find(p => p.id === activePipelineId);

  const pipelineDeals = useMemo(() => {
    let result = deals.filter(d => d.pipelineId === activePipelineId && !d.isArchived);

    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.trim().toLowerCase();
      result = result.filter(d =>
        (d.title || '').toLowerCase().includes(q) ||
        (d.companyName || '').toLowerCase().includes(q) ||
        (d.contactPerson || '').toLowerCase().includes(q)
      );
    }

    if (filterStatus !== 'all' && activePipeline) {
      const stageFlagMap: Record<string, { isWon: boolean; isLost: boolean }> = {};
      activePipeline.stages.forEach((s: Stage) => {
        stageFlagMap[s.id] = { isWon: !!s.isWon, isLost: !!s.isLost };
      });
      result = result.filter(d => {
        const flags = stageFlagMap[d.stageId];
        const isWon = flags?.isWon ?? false;
        const isLost = flags?.isLost ?? false;
        if (filterStatus === 'won') return isWon;
        if (filterStatus === 'lost') return isLost;
        if (filterStatus === 'open') return !isWon && !isLost;
        return true;
      });
    }

    if (filterStages.length > 0) {
      result = result.filter(d => filterStages.includes(d.stageId));
    }

    if (filterStaff.length > 0) {
      result = result.filter(d => {
        if (filterStaff.includes('unassigned') && !d.assignedUserId) return true;
        return !!d.assignedUserId && filterStaff.includes(d.assignedUserId);
      });
    }

    if (filterPriority.length > 0) {
      result = result.filter(d => filterPriority.includes(d.priority));
    }

    return result.sort((a, b) => a.order - b.order);
  }, [deals, activePipelineId, debouncedSearchQuery, filterStatus, filterStages, filterStaff, filterPriority, activePipeline]);

  const selectedDeal = deals.find(d => d.id === selectedDealId);
  // ── Pipeline pagination state (production mode — grouped-by-stage) ───────
  const [stagePageMap, setStagePageMap] = useState<Record<string, number>>({});
  const [paginationLoadingStages, setPaginationLoadingStages] = useState<Set<string>>(new Set());
  const [hasMoreByStage, setHasMoreByStage] = useState<Record<string, boolean>>({});
  const [paginatedDeals, setPaginatedDeals] = useState<Deal[]>([]);

  // Initial load: fetch deals grouped by stage for the active pipeline (production mode)
  useEffect(() => {
    if (USE_MOCK_DATA || !activePipelineId) return;

    let cancelled = false;

    const fetchGroupedDeals = async (): Promise<void> => {
      try {
        const response = await apiClient.get<{
          success: boolean;
          data: { stages: Array<{ stageId: string; deals: Deal[]; total: number; page: number; hasMore: boolean }> };
        }>('/crm/deals', {
          params: { groupByStage: 'true', pipelineId: activePipelineId },
        });

        if (cancelled) return;

        const allDeals: Deal[] = [];
        const newHasMore: Record<string, boolean> = {};
        const newPageMap: Record<string, number> = {};

        for (const stageGroup of response.data.stages) {
          allDeals.push(...stageGroup.deals);
          newHasMore[stageGroup.stageId] = stageGroup.hasMore;
          newPageMap[stageGroup.stageId] = stageGroup.page;
        }

        setPaginatedDeals(allDeals);
        setHasMoreByStage(newHasMore);
        setStagePageMap(newPageMap);
      } catch {
        // Silently fall back to DataContext deals on error
        if (!cancelled) {
          setPaginatedDeals([]);
          setHasMoreByStage({});
          setStagePageMap({});
        }
      }
    };

    fetchGroupedDeals();
    return () => { cancelled = true; };
  }, [activePipelineId]);

  // Load more deals for a specific stage (production mode)
  const handleLoadMore = useCallback(async (stageId: string): Promise<void> => {
    if (USE_MOCK_DATA || !activePipelineId) return;

    setPaginationLoadingStages(prev => new Set(prev).add(stageId));

    const nextPage = (stagePageMap[stageId] ?? 1) + 1;
    const updatedPageMap = { ...stagePageMap, [stageId]: nextPage };

    try {
      const response = await apiClient.get<{
        success: boolean;
        data: { stages: Array<{ stageId: string; deals: Deal[]; total: number; page: number; hasMore: boolean }> };
      }>('/crm/deals', {
        params: {
          groupByStage: 'true',
          pipelineId: activePipelineId,
          stagePages: JSON.stringify({ [stageId]: nextPage }),
        },
      });

      const stageResult = response.data.stages.find(s => s.stageId === stageId);
      if (stageResult) {
        setPaginatedDeals(prev => [...prev, ...stageResult.deals]);
        setHasMoreByStage(prev => ({ ...prev, [stageId]: stageResult.hasMore }));
        setStagePageMap(updatedPageMap);
      }
    } catch {
      toast.error('Failed to load more deals');
    } finally {
      setPaginationLoadingStages(prev => {
        const next = new Set(prev);
        next.delete(stageId);
        return next;
      });
    }
  }, [activePipelineId, stagePageMap]);
  // ── Event handlers ───────────────────────────────────────────────────────

  const handleAddDealFromStage = useCallback((stageId: string): void => {
    if (!canCreateDeal || !activePipelineId) return;
    setDealFormPreselect({ pipelineId: activePipelineId, stageId });
    setIsDealFormOpen(true);
  }, [canCreateDeal, activePipelineId]);

  const handleDealFormSubmit = async (data: CreateDealFormData | UpdateDealFormData): Promise<void> => {
    try {
      const createData = data as CreateDealFormData;
      await addDeal({
        ...createData,
        pipelineId: createData.pipelineId || activePipelineId,
        order: deals.filter(d => d.pipelineId === activePipelineId && d.stageId === createData.stageId).length,
      } as never);
      toast.success('Deal created successfully');
      setIsDealFormOpen(false);
      setDealFormPreselect({});
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create deal');
    }
  };

  const handleDealDragEnd = useCallback(async (dealId: string, newStageId: string): Promise<void> => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;

    const targetStage = activePipeline?.stages.find((s: Stage) => s.id === newStageId);
    if (!targetStage) return;

    // Handle lost stage — show lost reason modal
    if (targetStage.isLost) {
      setDealBeingLost(deal);
      setIsLostReasonModalOpen(true);
      setLostReason('');
      return;
    }

    // Handle won stage — show handoff modal
    if (targetStage.isWon) {
      setDealBeingWon(deal);
      setTargetWonStageId(targetStage.id);
      setIsHandoffModalOpen(true);
      return;
    }

    // Client-side requiredFields pre-check
    if (targetStage.requiredFields && targetStage.requiredFields.length > 0) {
      const missing = targetStage.requiredFields.filter(field => {
        const val = (deal as unknown as Record<string, unknown>)[field];
        return val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
      });
      if (missing.length > 0) {
        toast.error(`Cannot move to "${targetStage.name}": missing ${missing.join(', ')}`);
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
      }
    }

    try {
      await moveDealStage(dealId, newStageId);
      toast.success(`Deal moved to ${targetStage.name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to move deal');
    }
  }, [deals, activePipeline, moveDealStage]);

  const handleSaveLostReason = async (): Promise<void> => {
    if (!dealBeingLost) return;
    const dealPipeline = pipelines.find(p => p.id === dealBeingLost.pipelineId) ?? activePipeline;
    const lostStage = dealPipeline?.stages.find(s => s.isLost);
    if (!lostStage) {
      toast.error('No lost stage found in this pipeline.');
      return;
    }
    try {
      await moveDealStage(dealBeingLost.id, lostStage.id, undefined, lostReason);
      setIsLostReasonModalOpen(false);
      setDealBeingLost(null);
      setLostReason('');
      toast.success('Deal marked as lost');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update deal');
    }
  };

  const handleConfirmHandoff = async (payload: { handoff: unknown }): Promise<void> => {
    if (dealBeingWon && targetWonStageId) {
      try { await moveDealStage(dealBeingWon.id, targetWonStageId, undefined, undefined, payload.handoff); toast.success(`Deal won! ${dealBeingWon.companyName || dealBeingWon.title} is now a customer.`); } catch { toast.error('Failed to move deal to won stage'); }
    }
    setIsHandoffModalOpen(false); setDealBeingWon(null); setTargetWonStageId(null);
  };

  const handleAddPipeline = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!newPipelineName.trim()) return;

    const template = PIPELINE_TEMPLATES.find(t => t.id === selectedTemplateId) ?? PIPELINE_TEMPLATES[0];
    const templateStages: Stage[] = template.stages.map(s => ({
      id: uuid(),
      name: s.name,
      order: s.order,
      probability: s.probability,
      color: s.color,
      isDefault: s.isDefault ?? false,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
    }));

    try {
      await addPipeline({ name: newPipelineName.trim(), stages: templateStages });
      setIsPipelineModalOpen(false);
      setPipelineModalStep('template');
      setSelectedTemplateId('inquiry');
      setNewPipelineName('');
      toast.success('Pipeline created successfully');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create pipeline');
    }
  };

  const handleUpdatePipeline = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!editingPipeline) return;
    try { await updatePipeline(editingPipeline.id, editingPipeline); setEditingPipeline(null); toast.success('Pipeline updated successfully'); } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to update pipeline'); }
  };

  const handleDeletePipeline = (id: string): void => {
    if (pipelines.length <= 1) { toast.error('You must have at least one pipeline.'); return; }
    setPipelineToDeleteId(id);
    setIsDeletePipelineModalOpen(true);
  };

  const handleConfirmDeletePipeline = async (): Promise<void> => {
    if (!pipelineToDeleteId) return;
    try {
      await deletePipeline(pipelineToDeleteId);
      if (activePipelineId === pipelineToDeleteId) setActivePipelineId(pipelines.find(p => p.id !== pipelineToDeleteId)?.id || '');
      setIsDeletePipelineModalOpen(false);
      setPipelineToDeleteId(null);
      toast.success('Pipeline archived successfully.');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to archive pipeline'); }
  };

  const handleConfirmArchiveDeal = async (): Promise<void> => {
    if (!dealToDelete) return;
    try {
      await deleteDeal(dealToDelete.id);
      setSelectedDealId(null); setIsDeleteDealModalOpen(false); setDealToDelete(null);
      toast.success('Deal archived successfully.');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to archive deal'); }
  };

  const handleTableSortChange = (sort: { field: string; direction: 'asc' | 'desc' } | null): void => { setTableSortField(sort?.field ?? null); setTableSortDirection(sort?.direction ?? 'asc'); };
  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-full flex flex-col relative overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[28px] font-extrabold text-[#0F172A] dark:text-white tracking-tight leading-tight">Deals</h1>
          <p className="text-[13px] text-[#5A6B85] dark:text-slate-400 mt-0.5">
            One workspace for the pipeline board, deal table and weighted forecast.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pipelines.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-[#5A6B85] dark:text-slate-400">Pipeline</span>
              <select
                value={activePipelineId}
                onChange={(e) => setActivePipelineId(e.target.value)}
                className="h-9 px-3 pr-8 text-[13px] font-semibold text-[#0F172A] dark:text-white bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 cursor-pointer appearance-none"
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%235A6B85\' stroke-width=\'2\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")', backgroundPosition: 'right 10px center', backgroundRepeat: 'no-repeat' }}
              >
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {canManagePipelines && (
            <button
              onClick={() => { setPipelineModalStep('template'); setSelectedTemplateId('inquiry'); setNewPipelineName(''); setIsPipelineModalOpen(true); }}
              title="Create New Pipeline"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Plus size={14} /><span className="hidden sm:inline">New Pipeline</span>
            </button>
          )}

          {canManagePipelines && (
            <button
              onClick={() => setIsManagePipelinesModalOpen(true)}
              title="Manage Pipelines"
              aria-label="Manage Pipelines"
              className="h-9 w-9 flex items-center justify-center text-[#5A6B85] dark:text-slate-400 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Settings size={15} />
            </button>
          )}

          <button className="inline-flex items-center gap-1.5 h-9 px-3.5 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">Import</button>

          {canCreateDeal && activePipeline && (
            <button
              onClick={() => { setDealFormPreselect({ pipelineId: activePipelineId, stageId: activePipeline?.stages?.[0]?.id || '' }); setIsDealFormOpen(true); }}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-[13px] font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-lg transition-colors shadow-sm"
            >
              <Plus size={14} /> New Deal
              <ChevronDown size={13} className="ml-0.5 opacity-60" />
            </button>
          )}
        </div>
      </div>

      {/* ── Saved View Tabs ────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-3 border-b border-[#E4E9F0] dark:border-slate-700">
        <button className="px-3 py-2 text-[13px] font-medium text-[#2563EB] dark:text-blue-400 relative">
          All Deals
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2563EB] dark:bg-blue-400 rounded-full" />
        </button>
        <button className="px-3 py-2 text-[13px] font-medium text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white transition-colors">My Deals</button>
        <button className="px-2 py-2 text-[#5A6B85] hover:text-[#0F172A] dark:hover:text-white transition-colors"><span className="text-lg leading-none">···</span></button>
      </div>

      {/* ── Toolbar ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
          className={`inline-flex items-center gap-1.5 h-8 min-h-[44px] sm:min-h-0 px-3 text-[12px] font-semibold rounded-lg border transition-colors ${
            isFilterPanelOpen ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white dark:bg-slate-800 text-[#5A6B85] dark:text-slate-300 border-[#E4E9F0] dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <SlidersHorizontal size={13} />Filter
        </button>

        <button className="inline-flex items-center gap-1.5 h-8 min-h-[44px] sm:min-h-0 px-3 text-[12px] font-medium text-[#5A6B85] dark:text-slate-300 bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <ArrowRight size={13} className="rotate-90" />Sort
        </button>

        <div className="inline-flex items-center bg-white dark:bg-slate-800 border border-[#E4E9F0] dark:border-slate-700 rounded-lg p-0.5">
          <button onClick={() => handleViewModeChange('kanban')} title="Kanban View" className={`p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-[#2563EB] text-white shadow-sm' : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'}`}><LayoutGrid size={15} /></button>
          <button onClick={() => handleViewModeChange('list')} title="List View" className={`p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-md transition-colors ${viewMode === 'list' ? 'bg-[#2563EB] text-white shadow-sm' : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'}`}><List size={15} /></button>
          <button onClick={() => handleViewModeChange('table')} title="Table View" className={`p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 rounded-md transition-colors ${viewMode === 'table' ? 'bg-[#2563EB] text-white shadow-sm' : 'text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'}`}><Table size={15} /></button>
        </div>

        <button type="button" onClick={toggleAutomatedOnly} aria-label={isAutomatedOnly ? 'Automation Mode: Active' : 'Automation Mode: Off'} className={`h-8 w-8 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center rounded-lg border transition-all ${isAutomatedOnly ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 border-blue-200 dark:border-blue-800/60' : 'bg-white dark:bg-slate-800 border-[#E4E9F0] dark:border-slate-700 text-[#5A6B85] hover:bg-slate-50'}`}><Shield size={13} /></button>

        <button className="p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Refresh"><RotateCcw size={15} /></button>

        <div className="flex-1" />

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deals..."
            className="h-8 w-40 sm:w-48 lg:w-56 pl-8 pr-3 text-[12px] rounded-lg border border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 placeholder:text-[#5A6B85] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-all"
          />
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5A6B85]" />
        </div>

        <button className="p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#5A6B85] dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Manage columns"><SlidersHorizontal size={15} /></button>
      </div>

      {/* ── Main Content ──────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-hidden">

        {/* Forecast Bar */}
        <ForecastBar
          deals={deals}
          pipelines={pipelines}
          serverForecast={forecastData}
          tenant={tenant}
        />

        {/* Apply Template Banner */}
        {(() => {
          const stages = activePipeline?.stages || [];
          const hasGenericStages = stages.length <= 2 || stages.every(s => /^stage\s*\d+$/i.test(s.name));
          const hasNoDeals = pipelineDeals.length === 0;
          if (!(hasGenericStages && hasNoDeals && canManagePipelines)) return null;
          return (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="rounded-2xl border border-dashed border-blue-500/30 bg-blue-500/[0.04] dark:bg-blue-500/[0.06] p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0"><Layers size={18} className="text-blue-400" /></div>
                <div>
                  <p className="font-semibold text-sm text-slate-900 dark:text-white">This pipeline has no stages set up yet</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Apply a ready-to-use template to get started in seconds.</p>
                </div>
              </div>
              <button type="button" onClick={() => { setPipelineModalStep('template'); setSelectedTemplateId('inquiry'); setNewPipelineName(''); setIsPipelineModalOpen(true); }} className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2">
                <Rocket size={14} /> Browse Templates
              </button>
            </motion.div>
          );
        })()}

        {/* Kanban View */}
        {viewMode === 'kanban' && activePipeline && (
          <ModuleErrorBoundary fallbackLabel="Pipeline Board">
            {/* Mobile (<lg): collapsible stage-grouped deal list */}
            <div className="lg:hidden overflow-y-auto flex-1">
              <PipelineMobileList
                pipeline={activePipeline}
                deals={USE_MOCK_DATA ? pipelineDeals : (paginatedDeals.length > 0 ? paginatedDeals : pipelineDeals)}
                users={users}
                currencyConfig={tenantCurrency}
                canCreate={canCreateDeal}
                onDealClick={(deal) => setSelectedDealId(deal.id)}
                onAddDeal={handleAddDealFromStage}
              />
            </div>
            {/* Desktop (≥lg): full Kanban board */}
            <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden">
              <PipelineKanbanBoard
                pipeline={activePipeline}
                deals={USE_MOCK_DATA ? pipelineDeals : (paginatedDeals.length > 0 ? paginatedDeals : pipelineDeals)}
                users={users}
                canCreate={canCreateDeal}
                canEdit={canEditDeal && !isAutomatedOnly}
                canDelete={canDeleteDeal}
                currencyConfig={tenantCurrency}
                onDealClick={(deal) => setSelectedDealId(deal.id)}
                onDealDragEnd={handleDealDragEnd}
                onAddDeal={handleAddDealFromStage}
                onLoadMore={handleLoadMore}
                loadingStages={paginationLoadingStages}
                hasMoreByStage={hasMoreByStage}
              />
            </div>
          </ModuleErrorBoundary>
        )}

        {/* Table View */}
        {viewMode === 'table' && (
          <ModuleErrorBoundary fallbackLabel="Table View">
            <PipelineTableView
              deals={pipelineDeals}
              columns={TABLE_COLUMNS}
              sort={tableSortField ? { field: tableSortField, direction: tableSortDirection } : null}
              onSortChange={handleTableSortChange}
              onDealClick={(deal) => setSelectedDealId(deal.id)}
            />
            {pipelineDeals.length === 0 && (
              <div className="p-12 flex justify-center">
                <EmptyState
                  type="deals"
                  title="No Deals in Pipeline"
                  description="Start populating this pipeline with potential sales opportunities."
                  actionLabel={canCreateDeal ? "Add Deal" : undefined}
                  onAction={canCreateDeal ? () => { setDealFormPreselect({ pipelineId: activePipelineId }); setIsDealFormOpen(true); } : undefined}
                />
              </div>
            )}
          </ModuleErrorBoundary>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pipelineDeals.map((deal) => {
              const assignedRep = users.find(u => u.id === deal.assignedUserId);
              const activeStage = activePipeline?.stages.find((s: Stage) => s.id === deal.stageId);
              return (
                <div key={deal.id} onClick={() => setSelectedDealId(deal.id)} className="group p-4 bg-white dark:bg-slate-950/40 rounded-2xl border border-gray-200 dark:border-white/[0.05] shadow-sm hover:border-blue-500/30 transition-all cursor-pointer flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-1.5">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-blue-500 transition-colors">{deal.title}</h4>
                      <span className={`text-[9px] font-black tracking-widest uppercase px-1.5 py-0.5 rounded border shrink-0 ${deal.priority === 'High' ? 'bg-red-500/10 text-red-500 border-red-500/10' : deal.priority === 'Medium' ? 'bg-orange-500/10 text-orange-500 border-orange-500/10' : 'bg-blue-500/10 text-blue-500 border-blue-500/10'}`}>{deal.priority}</span>
                    </div>
                    <p className="text-xs text-slate-500 font-semibold mb-3">{deal.companyName || 'Unknown Company'}</p>
                    {activeStage && <span className="bg-blue-500/[0.07] text-blue-500 dark:text-blue-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg border border-blue-500/10">{activeStage.name}</span>}
                  </div>
                  <div className="border-t border-slate-100 dark:border-white/5 pt-3 mt-3 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-900 dark:text-white font-mono">{formatCurrency(deal.value || 0, tenantCurrency)}</span>
                    {assignedRep ? <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{assignedRep.firstName}</span> : <span className="text-xs italic text-slate-400">Unassigned</span>}
                  </div>
                </div>
              );
            })}
            {pipelineDeals.length === 0 && (
              <div className="col-span-full p-12 flex justify-center">
                <EmptyState type="deals" title="No Deals in Pipeline" description="Start populating this pipeline." actionLabel={canCreateDeal ? "Add Deal" : undefined} onAction={canCreateDeal ? () => { setDealFormPreselect({ pipelineId: activePipelineId }); setIsDealFormOpen(true); } : undefined} />
              </div>
            )}
          </div>
        )}

        {/* Deal Details Side Panel */}
        <DealPanel
          open={!!selectedDeal}
          onOpenChange={(open) => { if (!open) setSelectedDealId(null); }}
          deal={selectedDeal ?? null}
          onEdit={(d) => { setEditingDeal(d); setIsDealFormOpen(true); }}
        />


        {/* ── Deal Form Sheet (unified create form) ──────── */}
        <DealFormSheet
          isOpen={isDealFormOpen}
          onClose={() => { setIsDealFormOpen(false); setDealFormPreselect({}); setEditingDeal(null); }}
          mode={editingDeal ? 'edit' : 'create'}
          initialData={editingDeal ?? undefined}
          preselect={editingDeal ? undefined : dealFormPreselect}
          onSubmit={async (data) => {
            if (editingDeal) {
              await updateDeal(editingDeal.id, data as any);
              toast.success('Deal updated');
              setEditingDeal(null);
              setIsDealFormOpen(false);
            } else {
              await handleDealFormSubmit(data);
            }
          }}
        />

        {/* ── Manage Pipelines Modal ─────────────────────── */}
        {isManagePipelinesModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-300 dark:border-white/[0.1] w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl max-h-[80vh]">
              <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-white/[0.05] shrink-0">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Manage Pipelines</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Edit or delete your custom pipelines.</p>
                </div>
                <button onClick={() => setIsManagePipelinesModalOpen(false)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors"><X size={20} /></button>
              </div>
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                <div className="space-y-6">
                  {pipelines.map(p => (
                    <div key={p.id} className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-xl p-4 space-y-4">
                      {editingPipeline?.id === p.id ? (
                        <form onSubmit={handleUpdatePipeline} className="space-y-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Pipeline Name</label>
                            <input value={editingPipeline.name} onChange={e => setEditingPipeline({ ...editingPipeline, name: e.target.value })} className="w-full bg-black/20 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Stages</label>
                            <div className="space-y-2">
                              {editingPipeline.stages.map((s, idx) => (
                                <div key={s.id} className="flex items-center gap-2">
                                  <input value={s.name} onChange={e => { const ns = [...editingPipeline.stages]; ns[idx] = { ...s, name: e.target.value }; setEditingPipeline({ ...editingPipeline, stages: ns }); }} className="flex-1 bg-black/20 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500/50" />
                                  <button type="button" onClick={() => { const ns = editingPipeline.stages.filter((_, i) => i !== idx); setEditingPipeline({ ...editingPipeline, stages: ns }); }} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"><Trash2 size={16} /></button>
                                </div>
                              ))}
                              <button type="button" onClick={() => { const ns = { id: uuid(), name: 'New Stage', order: editingPipeline.stages.length }; setEditingPipeline({ ...editingPipeline, stages: [...editingPipeline.stages, ns] }); }} className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"><Plus size={12} /> Add Stage</button>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button type="button" onClick={() => setEditingPipeline(null)} className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Cancel</button>
                            <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-500 transition-colors">Save Changes</button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                            <p className="text-xs text-slate-500 mt-1">{p.stages.length} stages &middot; {deals.filter(d => d.pipelineId === p.id).length} deals</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setEditingPipeline(p)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors"><Settings size={18} /></button>
                            <button onClick={() => handleDeletePipeline(p.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={18} /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── New Pipeline Modal ──────────────────────────── */}
        {isPipelineModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} className="bg-white dark:bg-slate-950 rounded-2xl border border-gray-200 dark:border-white/[0.1] w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] shrink-0">
                <div>
                  {pipelineModalStep === 'template' ? (
                    <><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Choose a Pipeline Template</h2><p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Pick a starting point — you can rename stages anytime.</p></>
                  ) : (
                    <><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Name Your Pipeline</h2><p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Based on: <span className={`font-medium ${PIPELINE_TEMPLATES.find(t => t.id === selectedTemplateId)?.accentColor}`}>{PIPELINE_TEMPLATES.find(t => t.id === selectedTemplateId)?.name}</span></p></>
                  )}
                </div>
                <button onClick={() => { setIsPipelineModalOpen(false); setPipelineModalStep('template'); setSelectedTemplateId('inquiry'); setNewPipelineName(''); }} aria-label="Close modal" className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors"><X size={18} /></button>
              </div>

              {pipelineModalStep === 'template' && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[60vh] custom-scrollbar">
                  {PIPELINE_TEMPLATES.map(tpl => (
                    <button key={tpl.id} type="button" onClick={() => { setSelectedTemplateId(tpl.id); setNewPipelineName(tpl.id === 'custom' ? '' : tpl.name); setPipelineModalStep('name'); }} className={`text-left p-4 rounded-xl border-2 transition-all hover:scale-[1.01] active:scale-[0.99] group ${selectedTemplateId === tpl.id ? `${tpl.color} shadow-md` : 'border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.02] hover:border-gray-300 dark:hover:border-white/[0.1]'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 shrink-0 ${tpl.accentColor}`}>{tpl.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white leading-tight">{tpl.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">{tpl.description}</p>
                          <div className="flex flex-wrap gap-1 mt-2.5">
                            {tpl.stages.filter(s => !s.isLost).map(s => (
                              <span key={s.name} className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${STAGE_BADGE_CLASSES[s.color] ?? DEFAULT_STAGE_BADGE}`}>
                                {s.isWon && <CheckCircle2 size={9} />}{s.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {pipelineModalStep === 'name' && (
                <div className="p-6 space-y-5">
                  <div className="rounded-xl border border-gray-100 dark:border-white/[0.05] bg-gray-50 dark:bg-white/[0.02] p-4">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Stages included</p>
                    <div className="flex flex-wrap gap-2">
                      {(PIPELINE_TEMPLATES.find(t => t.id === selectedTemplateId)?.stages ?? []).map((s, idx, arr) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${STAGE_BADGE_CLASSES[s.color] ?? DEFAULT_STAGE_BADGE}`}>
                            {s.isWon && <CheckCircle2 size={11} />}{s.isLost && <X size={11} />}{s.name}
                          </span>
                          {idx < arr.length - 1 && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600 shrink-0" />}
                        </div>
                      ))}
                    </div>
                  </div>
                  <form id="add-pipeline-form" onSubmit={handleAddPipeline}>
                    <label htmlFor="pipeline-name-input" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Pipeline Name <span className="text-red-500">*</span></label>
                    <input id="pipeline-name-input" required value={newPipelineName} onChange={e => setNewPipelineName(e.target.value)} className="h-9 w-full rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.02] px-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors" placeholder="e.g., Q4 Sales Pipeline" autoFocus />
                  </form>
                </div>
              )}

              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-white/[0.05] shrink-0 bg-gray-50 dark:bg-slate-950">
                {pipelineModalStep === 'name' ? (
                  <button type="button" onClick={() => setPipelineModalStep('template')} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"><ChevronRight size={14} className="rotate-180" /> Back</button>
                ) : <span />}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setIsPipelineModalOpen(false); setPipelineModalStep('template'); setSelectedTemplateId('inquiry'); setNewPipelineName(''); }} className="h-9 px-4 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-transparent text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">Cancel</button>
                  {pipelineModalStep === 'template' ? (
                    <button type="button" onClick={() => { setNewPipelineName(selectedTemplateId === 'custom' ? '' : (PIPELINE_TEMPLATES.find(t => t.id === selectedTemplateId)?.name ?? '')); setPipelineModalStep('name'); }} className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md shadow-blue-500/20 active:scale-95 transition-all">Use Template →</button>
                  ) : (
                    <button type="submit" form="add-pipeline-form" className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md shadow-blue-500/20 active:scale-95 transition-all">Create Pipeline</button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Lost Reason Modal ────────────────────────────── */}
        {isLostReasonModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-300 dark:border-white/[0.1] w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-white/[0.05]">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center"><AlertCircle size={20} /></div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Reason for Loss</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Please provide a reason why this deal was lost.</p>
              </div>
              <div className="p-6">
                <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Loss Reason *</label>
                <textarea required value={lostReason} onChange={e => setLostReason(e.target.value)} className="w-full bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.05] rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500/50 transition-all resize-none h-32" placeholder="e.g. Competitor offered lower price, Budget constraints, etc." />
              </div>
              <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-white/[0.05] bg-white/[0.01]">
                <button onClick={() => { setIsLostReasonModalOpen(false); setDealBeingLost(null); }} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors">Skip</button>
                <button onClick={handleSaveLostReason} disabled={!lostReason.trim()} className="px-6 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all shadow-lg shadow-red-500/20">Save Reason</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Archive Deal Confirmation Modal ──────────────── */}
        {isDeleteDealModalOpen && dealToDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-300 dark:border-white/[0.1] w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-white/[0.05]">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center"><Archive size={20} /></div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Archive Deal</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Are you sure you want to archive <span className="font-semibold text-slate-900 dark:text-white">&ldquo;{dealToDelete.title}&rdquo;</span>?</p>
              </div>
              <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-white/[0.05] bg-white/[0.02]">
                <button onClick={() => { setIsDeleteDealModalOpen(false); setDealToDelete(null); }} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors">Cancel</button>
                <button onClick={handleConfirmArchiveDeal} className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg transition-all shadow-lg shadow-amber-500/20">Yes, Archive</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Delete Pipeline Confirmation Modal ───────────── */}
        {isDeletePipelineModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-gray-50 dark:bg-slate-950 rounded-2xl border border-gray-300 dark:border-white/[0.1] w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-white/[0.05]">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center"><Archive size={20} /></div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Archive Sales Pipeline</h2>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Are you sure you want to archive this pipeline? All stages and deals inside will be archived.</p>
              </div>
              <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-white/[0.05] bg-white/[0.02]">
                <button onClick={() => { setIsDeletePipelineModalOpen(false); setPipelineToDeleteId(null); }} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors">Cancel</button>
                <button onClick={handleConfirmDeletePipeline} className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 active:scale-95">Confirm Archive</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Handoff Modal */}
        {dealBeingWon && (
          <HandoffModal
            isOpen={isHandoffModalOpen}
            onClose={() => { setIsHandoffModalOpen(false); setDealBeingWon(null); setTargetWonStageId(null); }}
            onConfirm={handleConfirmHandoff}
            deal={dealBeingWon}
            users={users}
          />
        )}

      </div>{/* end main content wrapper */}
    </motion.div>
  );
}

'use client';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';
import { UnreadRecordDot } from '@/features/tenant/notifications/hooks/use-record-notifications';


import React from 'react';
import { SALES_PIPELINE_STAGES, pipelineStageColor } from '@leadcrm/shared';
import { CrmStatusBadge } from '@/shared/components/crm/crm-status';
import { dealStageValueVisibility } from '@/shared/utils/deal-stage-pipeline';
import { formatDate } from '@/shared/components/data-grid/cell-renderers';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
  useDroppable,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableSyntheticListeners } from '@dnd-kit/core';
import {
  GripVertical,
  User,
  Calendar,
  Lock,
  Shield,
  Plus,
} from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { DealCardMenu } from '@/shared/components/crm/deal-card-menu';
import { formatCurrency, type CurrencyConfig, DEFAULT_CURRENCY } from '@/shared/utils/currency';
import type { Deal, Stage, Pipeline, User as UserType } from '@/store/types';

// Horizontal keyboard movement must select a stage, not the enclosing column
// of the active sortable card (which sits slightly to its left).
const stageKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const { active, over, collisionRect, droppableContainers, droppableRects } = args.context;
  if (!active || !collisionRect) return;
  const columns = droppableContainers.getEnabled().filter(entry => entry.data.current?.type === 'Stage').flatMap(entry => {
    const rect = droppableRects.get(entry.id);
    return rect ? [{ entry, rect }] : [];
  }).sort((a, b) => a.rect.left - b.rect.left);
  const currentStageId = over?.data.current?.type === 'Stage' ? over.id : over?.data.current?.sortable?.containerId ?? active.data.current?.sortable?.containerId;
  const currentIndex = columns.findIndex(column => column.entry.id === currentStageId);
  if (currentIndex < 0) return;
  const target = columns[currentIndex + (event.code === 'ArrowLeft' ? -1 : 1)];
  if (!target) return;
  return {
    x: target.rect.left + Math.max(0, (target.rect.width - collisionRect.width) / 2),
    y: Math.max(target.rect.top, Math.min(collisionRect.top, target.rect.bottom - collisionRect.height)),
  };
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface PipelineKanbanBoardProps {
  pipeline: Pipeline;
  deals: Deal[];
  users: UserType[];
  canCreate?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  currencyConfig?: CurrencyConfig;
  onDealClick: (deal: Deal) => void;
  onDealMutated?: (deal?: Deal) => void;
  onDealDragEnd: (dealId: string, newStageId: string) => Promise<void>;
  onAddDeal: (stageId: string) => void;
  onLoadMore: (stageId: string) => void;
  loadingStages: Set<string>;
  hasMoreByStage: Record<string, boolean>;
  highlightDealId?: string;
}

// ─── Deal Card Content ───────────────────────────────────────────────────────

interface DealCardContentProps {
  showValue: boolean;
  showExpectedCloseDate: boolean;
  currencyConfig?: CurrencyConfig;
  deal: Deal;
  assignedUser?: Pick<UserType, 'id' | 'firstName' | 'lastName'>;
  canDrag?: boolean;
  isAutomatedOnly?: boolean;
  attributes?: React.HTMLAttributes<HTMLElement>;
  listeners?: DraggableSyntheticListeners;
  isDragOverlay?: boolean;
  onMutated?: (deal?: Deal) => void;
}

function DealCardContent({
  showValue,
  showExpectedCloseDate,
  currencyConfig,
  deal,
  assignedUser,
  canDrag = false,
  isAutomatedOnly = false,
  attributes,
  listeners,
  isDragOverlay = false,
  onMutated,
}: DealCardContentProps): React.ReactElement {
  const stale = !deal.isArchived && deal.staleness?.isStale && deal.staleness.stageId === deal.stageId ? deal.staleness : undefined;
  const staleDays = stale?.daysInactive ?? stale?.daysInStage;

  return (
    <div className={`flex flex-col gap-3 ${isDragOverlay ? 'opacity-90' : ''}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="flex min-w-0 items-start gap-2 flex-1">
          {canDrag && !isAutomatedOnly && !isDragOverlay ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Drag ${deal.title}`}
              title="Hold and drag to move deal"
              className="-ml-2 flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-primary transition-colors cursor-grab active:cursor-grabbing sm:ml-0 sm:h-8 sm:w-6"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={16} />
            </button>
          ) : isAutomatedOnly && !isDragOverlay ? (
            <div
              className="mt-0.5 text-blue-500/50 dark:text-blue-400/40 flex items-center justify-center shrink-0"
              title="Locked: Process managed by sales automation rules"
            >
              <Lock size={12} className="text-blue-400/70" />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2"><h4
              className={`font-medium text-[#1a73e8] dark:text-blue-400 text-[13px] leading-5 [overflow-wrap:anywhere] group-hover:underline transition-colors ${
                (!canDrag && !isDragOverlay) || isAutomatedOnly ? 'ml-1' : ''
              }`}
            >
              {deal.title}
            </h4>{!isDragOverlay && <UnreadRecordDot entityType="Deal" entityId={deal.id} />}</div>
            {(deal.contactPerson || deal.companyName) && <div className="flex min-w-0 items-start text-xs text-slate-500 dark:text-slate-400 mt-1">
              <User size={12} className="mr-1.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {[deal.contactPerson, deal.companyName].filter(Boolean).join(' · ')}
              </span>
            </div>}
          </div>
        </div>
        {!isDragOverlay && <DealCardMenu dealId={deal.id} dealTitle={deal.title} deal={deal} onMutated={onMutated} />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
        {showValue && typeof deal.value === 'number' && (
          <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200 text-[13px] font-medium shrink-0">
            {formatCurrency(deal.value, currencyConfig)}
          </span>
        )}
        <span
          className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0
            ${
              deal.priority === 'High'
                ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                : deal.priority === 'Medium'
                  ? 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20'
                  : 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20'
            }`}
        >
          {deal.priority}
        </span>

        <CrmStatusBadge status={deal.engagementStatus} />
        {stale && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider shrink-0 bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
            title={`Stale deal: ${staleDays} ${staleDays === 1 ? 'day' : 'days'}${stale.daysInactive === undefined ? '' : ' inactive'} in ${stale.stageName} (threshold: ${stale.thresholdDays} ${stale.thresholdDays === 1 ? 'day' : 'days'})`}
          >
            <AlertTriangle size={10} />
            {staleDays}d
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 mt-1 pt-2.5 border-t border-slate-100 dark:border-white/[0.05] text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {showExpectedCloseDate && <span className="flex shrink-0 items-center gap-1 whitespace-nowrap" title="Expected Close Date">
          <Calendar size={12} aria-hidden="true" />
          {formatDate(deal.expectedCloseDate)}
        </span>}
        <span className="ml-auto flex min-w-0 items-center justify-end gap-1.5"
          title={assignedUser ? `Assigned to ${assignedUser.firstName} ${assignedUser.lastName}` : 'Unassigned'}>
          <User size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{assignedUser ? `${assignedUser.firstName} ${assignedUser.lastName}` : 'Unassigned'}</span>
        </span>
      </div>
    </div>
  );
}

// ─── Sortable Deal Card ──────────────────────────────────────────────────────

interface SortableDealCardProps {
  showValue: boolean;
  showExpectedCloseDate: boolean;
  currencyConfig?: CurrencyConfig;
  deal: Deal;
  assignedUser?: Pick<UserType, 'id' | 'firstName' | 'lastName'>;
  onClick: (deal: Deal) => void;
  onMutated?: (deal?: Deal) => void;
  canDrag?: boolean;
  isAutomatedOnly?: boolean;
  highlighted?: boolean;
}

function SortableDealCard({
  showValue,
  showExpectedCloseDate,
  currencyConfig,
  deal,
  assignedUser,
  onClick,
  onMutated,
  canDrag = true,
  isAutomatedOnly = false,
  highlighted = false,
}: SortableDealCardProps): React.ReactElement {
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!highlighted) return;
    // Scroll both the stage's vertical viewport and the board's horizontal viewport.
    const frame = requestAnimationFrame(() => cardRef.current?.scrollIntoView({
      block: 'center', inline: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    }));
    return () => cancelAnimationFrame(frame);
  }, [highlighted, deal.stageId]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { type: 'Deal', deal },
    disabled: !canDrag || isAutomatedOnly,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : 1,
    cursor: isDragging ? 'grabbing' : 'pointer',
  };

  const isStale = !deal.isArchived && deal.staleness?.isStale && deal.staleness.stageId === deal.stageId;

  let borderStyle = 'border-slate-200 dark:border-white/[0.05] hover:border-blue-500/40';
  if (isStale) {
    borderStyle =
      'border-red-300 dark:border-red-500/30 bg-red-50/10 dark:bg-red-500/5 hover:border-red-400 dark:hover:border-red-500/50';
  }

  return (
    <div
      ref={node => { cardRef.current = node; setNodeRef(node); }}
      data-deal-id={deal.id}
      data-search-highlight={highlighted || undefined}
      style={style}
      onClick={() => onClick(deal)}
      className={`search-highlight-card p-4 rounded-xl border transition-colors cursor-pointer group relative select-none ${
        isDragging
          ? 'border-blue-500/50 bg-blue-500/5 ring-2 ring-blue-500/20 shadow-2xl'
          : `${isStale ? '' : 'bg-white dark:bg-slate-950'} ${borderStyle} shadow-sm hover:shadow-md`
      }`}
    >
      <DealCardContent showValue={showValue} showExpectedCloseDate={showExpectedCloseDate} currencyConfig={currencyConfig}
        deal={deal}
        assignedUser={assignedUser}
        canDrag={canDrag}
        isAutomatedOnly={isAutomatedOnly}
        attributes={attributes}
        listeners={listeners}
        onMutated={onMutated}
      />
    </div>
  );
}

// ─── Droppable Stage Column ──────────────────────────────────────────────────

interface DroppableStageProps {
  stage: Stage;
  children: React.ReactNode;
  stageValue: number;
  showValue: boolean;
  count: number;
  isDraggingAny: boolean;
  isAutomatedOnly?: boolean;
  currencyConfig?: CurrencyConfig;
}

function DroppableStage({
  stage,
  children,
  stageValue,
  showValue,
  count,
  isDraggingAny,
  isAutomatedOnly = false,
  currencyConfig,
}: DroppableStageProps): React.ReactElement {
  const { isOver, setNodeRef } = useDroppable({
    id: stage.id,
    data: { type: 'Stage', stage },
    disabled: isAutomatedOnly,
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-[min(20rem,calc(100vw-2rem))] sm:w-80 flex flex-col bg-white dark:bg-white/[0.02] rounded-2xl border flex-shrink-0 max-h-full backdrop-blur-sm transition-all duration-200 ${
        isOver
          ? 'border-blue-500/60 bg-blue-500/[0.08] shadow-[0_0_30px_rgba(59,130,246,0.2)] scale-[1.02] z-10 ring-2 ring-blue-500/30'
          : isDraggingAny
            ? 'border-blue-500/20 bg-blue-500/[0.02]'
            : 'border-gray-200 dark:border-white/[0.05]'
      }`}
    >
      <div className="p-4 flex justify-between items-start">
        <div className="flex items-center gap-2">
          {(
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: pipelineStageColor(stage) }}
              aria-hidden="true"
            />
          )}
          <div>
            <h3
              className={`font-semibold text-base transition-colors ${
                isOver ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-white'
              }`}
            >
              {stage.name}
            </h3>
            {showValue && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {formatCurrency(stageValue, currencyConfig)}
            </p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isAutomatedOnly && (
            <span
              className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1"
              title="Managed by CRM Automation workflows"
            >
              <Shield size={10} /> Auto
            </span>
          )}
          <span className="bg-gray-50 dark:bg-white/[0.05] text-slate-700 dark:text-slate-300 text-xs font-medium px-2.5 py-1 rounded-full">
            {count}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Pipeline Kanban Board ───────────────────────────────────────────────────

export function PipelineKanbanBoard({
  pipeline,
  deals,
  users,
  canCreate = false,
  canEdit,
  canDelete: _canDelete,
  currencyConfig,
  onDealClick,
  onDealMutated,
  onDealDragEnd,
  onAddDeal,
  onLoadMore,
  loadingStages,
  hasMoreByStage,
  highlightDealId,
}: PipelineKanbanBoardProps): React.ReactElement {
  const recordAccess = useCrmRecordAccess('deals');
  const qualifiedStageId = pipeline.stages.find(stage => !stage.isWon && !stage.isLost &&
    stage.name.trim().toLowerCase() === SALES_PIPELINE_STAGES[2].toLowerCase())?.id;
  const boardRef = React.useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = React.useState<number>();
  React.useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    // Give percentage-height stage columns a definite viewport. Otherwise a long
    // stage grows the page and scrollIntoView scrolls the page instead of the stage.
    const measure = () => setBoardHeight(Math.max(440, window.innerHeight - Math.max(0, board.getBoundingClientRect().top) - 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board.parentElement!);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [pipeline.id]);
  const [activeDeal, setActiveDeal] = React.useState<Deal | null>(null);
  const [optimisticStageMap, setOptimisticStageMap] = React.useState<Record<string, string>>({});

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: stageKeyboardCoordinates,
    })
  );

  const customCollisionDetection: CollisionDetection = React.useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    const intersections = rectIntersection(args);
    if (intersections.length > 0) return intersections;
    return closestCenter(args);
  }, []);

  const handleDragStart = (event: DragStartEvent): void => {
    if (!canEdit) return;
    const deal = deals.find((d) => d.id === event.active.id);
    if (deal && recordAccess.canMutate(deal)) {
      setActiveDeal(deal);
    }
  };

  const [pendingDeals, setPendingDeals] = React.useState<Set<string>>(new Set());
  const targetStage = (event: DragOverEvent | DragEndEvent) => {
    if (!event.over) return undefined;
    const id = String(event.over.id);
    if (id === String(event.active.id)) return optimisticStageMap[String(event.active.id)] ?? deals.find(d => d.id === id)?.stageId;
    return pipeline.stages.find(s => s.id === id)?.id ?? optimisticStageMap[id] ?? deals.find(d => d.id === id)?.stageId;
  };
  const clearPreview = (id: string) => setOptimisticStageMap(previous => {
    const next = { ...previous }; delete next[id]; return next;
  });
  const handleDragOver = (event: DragOverEvent): void => {
    if (!canEdit) return;
    const id = String(event.active.id), target = targetStage(event);
    const dragged = deals.find(d => d.id === id);
    const stage = pipeline.stages.find(s => s.id === target);
    if (!dragged || !recordAccess.canMutate(dragged) || !stage || stage.id === dragged.stageId || stage.isWon || stage.isLost) { clearPreview(id); return; }
    setOptimisticStageMap(previous => previous[id] === stage.id ? previous : { ...previous, [id]: stage.id });
  };
  const handleDragEnd = (event: DragEndEvent): void => {
    const id = String(event.active.id), target = targetStage(event);
    const dragged = deals.find(d => d.id === id);
    setActiveDeal(null);
    if (!canEdit || !event.over || !dragged || !recordAccess.canMutate(dragged) || !target || target === dragged.stageId || pendingDeals.has(id)) { clearPreview(id); return; }
    const stage = pipeline.stages.find(s => s.id === target);
    if (stage?.isWon || stage?.isLost) clearPreview(id);
    else setOptimisticStageMap(previous => ({ ...previous, [id]: target }));
    setPendingDeals(previous => new Set(previous).add(id));
    void onDealDragEnd(id, target).catch(() => { /* The page/dialog owns error feedback. */ }).finally(() => {
      clearPreview(id);
      setPendingDeals(previous => { const next = new Set(previous); next.delete(id); return next; });
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={event => { setActiveDeal(null); clearPreview(String(event.active.id)); }}
    >
      <div ref={boardRef} role="region" aria-label="Deal pipeline" style={boardHeight ? { height: boardHeight } : undefined} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-4 custom-scrollbar">
        <div className="flex gap-6 h-full min-w-max items-start">
          {pipeline.stages.map((stage) => {
            const stageDeals = deals
              .map((d) =>
                optimisticStageMap[d.id] ? { ...d, stageId: optimisticStageMap[d.id] } : d
              )
              .filter((d) => d.stageId === stage.id)
              .sort((a, b) => {
                const preview = Number(!!optimisticStageMap[b.id]) - Number(!!optimisticStageMap[a.id]);
                const movement = new Date(b.lastStageChangeDate ?? b.createdAt).getTime()
                  - new Date(a.lastStageChangeDate ?? a.createdAt).getTime();
                return preview || movement || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
              });
            const stageValue = stageDeals.reduce((acc, d) => acc + d.value, 0);
            const isLoading = loadingStages.has(stage.id);
            const hasMore = hasMoreByStage[stage.id] ?? false;

            return (
              <DroppableStage
                key={stage.id}
                stage={stage}
                stageValue={stageValue}
                showValue={dealStageValueVisibility(pipeline, stage.id).header}
                count={stageDeals.length}
                isDraggingAny={!!activeDeal}
                isAutomatedOnly={!canEdit}
                currencyConfig={currencyConfig}
              >
                <SortableContext
                  id={stage.id}
                  items={stageDeals.map((d) => d.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="p-3 flex-1 overflow-y-auto space-y-3 custom-scrollbar min-h-[200px]">
                    {stageDeals.map((deal) => (
                      <SortableDealCard showValue={dealStageValueVisibility(pipeline, stage.id).card} showExpectedCloseDate={stage.id === qualifiedStageId} currencyConfig={currencyConfig}
                        key={deal.id}
                        deal={deal}
                        highlighted={boardHeight !== undefined && deal.id === highlightDealId}
                        assignedUser={deal.assignedUser ?? users.find((u) => u.id === deal.assignedUserId)}
                        onClick={onDealClick}
                        canDrag={canEdit && recordAccess.canMutate(deal) && !pendingDeals.has(deal.id)}
                         onMutated={onDealMutated}
                         isAutomatedOnly={!canEdit}
                      />
                    ))}
                    {stageDeals.length === 0 && (
                      <div
                        className={`h-24 border-2 border-dashed rounded-xl flex items-center justify-center text-sm transition-all ${
                          !!activeDeal
                            ? 'border-blue-400 dark:border-blue-500/50 bg-blue-50 dark:bg-blue-500/5 text-blue-600 dark:text-blue-400 font-medium'
                            : 'border-gray-200 dark:border-white/[0.05] bg-white/[0.01] text-slate-500'
                        }`}
                      >
                        {!!activeDeal ? '↓ Drop deal here' : 'No deals in this stage'}
                      </div>
                    )}

                    {/* Load More button */}
                    {hasMore && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadMore(stage.id);
                        }}
                        disabled={isLoading}
                        className="w-full py-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                      >
                        {isLoading ? 'Loading...' : 'Load More'}
                      </button>
                    )}

                    {/* Loading indicator */}
                    {isLoading && !hasMore && (
                      <div className="flex items-center justify-center py-2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                </SortableContext>

                {/* Add Deal button per stage */}
                {canCreate && (
                  <div className="p-3 pt-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddDeal(stage.id);
                      }}
                      className="w-full py-2 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.05] rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-700 dark:hover:text-slate-300 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus size={12} />
                      Add Deal
                    </button>
                  </div>
                )}
              </DroppableStage>
            );
          })}
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.4' } },
          }),
        }}
      >
        {activeDeal ? (
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border-2 border-blue-500/60 shadow-[0_20px_60px_rgba(0,0,0,0.3)] flex flex-col gap-3 w-80 rotate-1 cursor-grabbing">
            <DealCardContent showValue={dealStageValueVisibility(pipeline, activeDeal.stageId).card} showExpectedCloseDate={activeDeal.stageId === qualifiedStageId} currencyConfig={currencyConfig}
              deal={activeDeal}
              assignedUser={activeDeal.assignedUser ?? users.find((u) => u.id === activeDeal.assignedUserId)}
              isDragOverlay={true}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default PipelineKanbanBoard;

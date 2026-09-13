'use client';

import React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
  useDroppable,
  type CollisionDetection,
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
  Clock,
  Lock,
  Shield,
  Plus,
} from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency, type CurrencyConfig, DEFAULT_CURRENCY } from '@/shared/utils/currency';
import type { Deal, Stage, Pipeline, User as UserType } from '@/store/types';

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
  onDealDragEnd: (dealId: string, newStageId: string) => Promise<void>;
  onAddDeal: (stageId: string) => void;
  onLoadMore: (stageId: string) => void;
  loadingStages: Set<string>;
  hasMoreByStage: Record<string, boolean>;
}

// ─── Deal Card Content ───────────────────────────────────────────────────────

interface DealCardContentProps {
  deal: Deal;
  assignedUser?: UserType;
  canDrag?: boolean;
  isAutomatedOnly?: boolean;
  attributes?: React.HTMLAttributes<HTMLElement>;
  listeners?: DraggableSyntheticListeners;
  isDragOverlay?: boolean;
}

function DealCardContent({
  deal,
  assignedUser,
  canDrag = false,
  isAutomatedOnly = false,
  attributes,
  listeners,
  isDragOverlay = false,
}: DealCardContentProps): React.ReactElement {
  const stageDateStr = deal.lastStageChangeDate || deal.updatedAt || deal.createdAt || Date.now();
  const daysSinceUpdate = Math.floor(
    (new Date().getTime() - new Date(stageDateStr).getTime()) / (1000 * 3600 * 24)
  );
  const isRotting = daysSinceUpdate >= 14;
  const isAging = daysSinceUpdate >= 7 && daysSinceUpdate < 14;

  return (
    <div className={`flex flex-col gap-3 ${isDragOverlay ? 'opacity-90' : ''}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-start gap-2 flex-1">
          {canDrag && !isAutomatedOnly && !isDragOverlay ? (
            <div
              {...attributes}
              {...listeners}
              className="mt-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-grab active:cursor-grabbing"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </div>
          ) : isAutomatedOnly && !isDragOverlay ? (
            <div
              className="mt-0.5 text-blue-500/50 dark:text-blue-400/40 flex items-center justify-center shrink-0"
              title="Locked: Process managed by sales automation rules"
            >
              <Lock size={12} className="text-blue-400/70" />
            </div>
          ) : null}
          <div className="flex flex-col">
            <h4
              className={`font-semibold text-slate-900 dark:text-white text-sm leading-tight group-hover:text-blue-500 transition-colors ${
                (!canDrag && !isDragOverlay) || isAutomatedOnly ? 'ml-1' : ''
              }`}
            >
              {deal.title}
            </h4>
            <div className="flex items-center text-xs text-slate-500 dark:text-slate-400 mt-1">
              <User size={12} className="mr-1.5 shrink-0" />
              <span className="truncate">
                {deal.contactPerson} &middot;{' '}
                <strong className="font-medium text-slate-700 dark:text-slate-300">
                  {deal.companyName}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
        {deal.value > 0 && (
          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20 px-2 py-0.5 rounded text-xs font-semibold shrink-0">
            {formatCurrency(deal.value)}
          </span>
        )}
        <span
          className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0
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

        {(isAging || isRotting) && (
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider shrink-0 ${
              isRotting
                ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
                : 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
            }`}
            title={`Stale deal: Not moved in ${daysSinceUpdate} days`}
          >
            {isRotting ? <AlertTriangle size={10} /> : <Clock size={10} />}
            {daysSinceUpdate}d
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-1 pt-2.5 border-t border-slate-100 dark:border-white/[0.05]">
        <div className="flex items-center text-[11px] font-medium">
          {deal.expectedCloseDate ? (
            <span
              className="flex items-center gap-1 text-slate-500 dark:text-slate-400"
              title="Expected Close Date"
            >
              <Calendar size={12} />{' '}
              {new Date(deal.expectedCloseDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          ) : (
            <span className="opacity-0">-</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {assignedUser ? (
            <div
              className="flex items-center gap-1.5"
              title={`Assigned to ${assignedUser.firstName} ${assignedUser.lastName}`}
            >
              <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/30 flex items-center justify-center text-[9px] font-bold text-blue-700 dark:text-blue-400">
                {assignedUser.firstName[0]}
                {assignedUser.lastName[0]}
              </div>
            </div>
          ) : (
            <div
              className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400"
              title="Unassigned"
            >
              <User size={10} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sortable Deal Card ──────────────────────────────────────────────────────

interface SortableDealCardProps {
  deal: Deal;
  assignedUser?: UserType;
  onClick: (deal: Deal) => void;
  canDrag?: boolean;
  isAutomatedOnly?: boolean;
}

function SortableDealCard({
  deal,
  assignedUser,
  onClick,
  canDrag = true,
  isAutomatedOnly = false,
}: SortableDealCardProps): React.ReactElement {
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

  const daysSinceUpdate = Math.floor(
    (new Date().getTime() -
      new Date(deal.lastStageChangeDate || deal.updatedAt || deal.createdAt || Date.now()).getTime()) /
      (1000 * 3600 * 24)
  );
  const isRotting = daysSinceUpdate >= 14;
  const isAging = daysSinceUpdate >= 7 && daysSinceUpdate < 14;

  let borderStyle = 'border-slate-200 dark:border-white/[0.05] hover:border-blue-500/40';
  if (isRotting) {
    borderStyle =
      'border-red-300 dark:border-red-500/30 bg-red-50/10 dark:bg-red-500/5 hover:border-red-400 dark:hover:border-red-500/50';
  } else if (isAging) {
    borderStyle =
      'border-amber-300 dark:border-amber-500/30 bg-amber-50/10 dark:bg-amber-500/5 hover:border-amber-400 dark:hover:border-amber-500/50';
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onClick(deal)}
      className={`p-4 rounded-xl border transition-colors cursor-pointer group relative select-none ${
        isDragging
          ? 'border-blue-500/50 bg-blue-500/5 ring-2 ring-blue-500/20 shadow-2xl'
          : `${isRotting || isAging ? '' : 'bg-white dark:bg-slate-950'} ${borderStyle} shadow-sm hover:shadow-md`
      }`}
    >
      <DealCardContent
        deal={deal}
        assignedUser={assignedUser}
        canDrag={canDrag}
        isAutomatedOnly={isAutomatedOnly}
        attributes={attributes}
        listeners={listeners}
      />
    </div>
  );
}

// ─── Droppable Stage Column ──────────────────────────────────────────────────

interface DroppableStageProps {
  stage: Stage;
  children: React.ReactNode;
  stageValue: number;
  count: number;
  isDraggingAny: boolean;
  isAutomatedOnly?: boolean;
  currencyConfig?: CurrencyConfig;
}

function DroppableStage({
  stage,
  children,
  stageValue,
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
      className={`w-80 flex flex-col bg-white dark:bg-white/[0.02] rounded-2xl border flex-shrink-0 max-h-full backdrop-blur-sm transition-all duration-200 ${
        isOver
          ? 'border-blue-500/60 bg-blue-500/[0.08] shadow-[0_0_30px_rgba(59,130,246,0.2)] scale-[1.02] z-10 ring-2 ring-blue-500/30'
          : isDraggingAny
            ? 'border-blue-500/20 bg-blue-500/[0.02]'
            : 'border-gray-200 dark:border-white/[0.05]'
      }`}
    >
      <div className="p-4 flex justify-between items-start">
        <div className="flex items-center gap-2">
          {stage.color && (
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: stage.color }}
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
            {stageValue > 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {formatCurrency(stageValue, currencyConfig)}
              </p>
            )}
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
  onDealDragEnd,
  onAddDeal,
  onLoadMore,
  loadingStages,
  hasMoreByStage,
}: PipelineKanbanBoardProps): React.ReactElement {
  const [activeDeal, setActiveDeal] = React.useState<Deal | null>(null);
  const [optimisticStageMap, setOptimisticStageMap] = React.useState<Record<string, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
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
    if (deal) {
      setActiveDeal(deal);
    }
  };

  const handleDragOver = (event: DragOverEvent): void => {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const dragged = deals.find((d) => d.id === activeId);
    if (!dragged) return;

    let targetStageId: string | null = null;

    const stageMatch = pipeline.stages.find((s) => s.id === overId);
    if (stageMatch) {
      targetStageId = stageMatch.id;
    } else {
      const overDeal = deals.find((d) => d.id === overId);
      if (overDeal && overDeal.stageId !== dragged.stageId) {
        targetStageId = overDeal.stageId;
      }
    }

    if (targetStageId && targetStageId !== dragged.stageId) {
      const targetStage = pipeline.stages.find((s) => s.id === targetStageId);
      if (targetStage?.isWon || targetStage?.isLost) return;

      setOptimisticStageMap((prev) => {
        if (prev[activeId] !== targetStageId) {
          return { ...prev, [activeId]: targetStageId! };
        }
        return prev;
      });
    }
  };

  // Clear optimistic entries once deals state confirms the stage move
  React.useEffect(() => {
    if (Object.keys(optimisticStageMap).length === 0) return;
    setOptimisticStageMap((prev) => {
      const next: Record<string, string> = {};
      for (const [dealId, targetStageId] of Object.entries(prev)) {
        const deal = deals.find((d) => d.id === dealId);
        // Keep entry only if the deal's stageId hasn't caught up yet
        if (deal && deal.stageId !== targetStageId) {
          next[dealId] = targetStageId;
        }
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [deals, optimisticStageMap]);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    const activeId = String(active.id);
    const draggedDeal = deals.find((d) => d.id === activeId);

    const optimisticTarget = optimisticStageMap[activeId] ?? null;

    setActiveDeal(null);

    if (!over || !draggedDeal || !canEdit) {
      // Drag cancelled — clear optimistic entry for this deal only
      setOptimisticStageMap((prev) => {
        const { [activeId]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    const overId = String(over.id);

    // Use optimistic target if dropped on self
    if (activeId === overId && optimisticTarget && optimisticTarget !== draggedDeal.stageId) {
      onDealDragEnd(activeId, optimisticTarget).catch(() => {
        setOptimisticStageMap((prev) => {
          const { [activeId]: _, ...rest } = prev;
          return rest;
        });
      });
      return;
    }

    if (activeId === overId) {
      // No move — clear optimistic entry for this deal
      setOptimisticStageMap((prev) => {
        const { [activeId]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    // Determine target stage
    let targetStageId: string | null = null;
    const stageMatch = pipeline.stages.find((s) => s.id === overId);
    if (stageMatch) {
      targetStageId = stageMatch.id;
    } else {
      const overDeal = deals.find((d) => d.id === overId);
      if (overDeal) {
        targetStageId = overDeal.stageId;
      }
    }

    if (targetStageId && targetStageId !== draggedDeal.stageId) {
      // Keep optimistic entry — it will be cleared by the useEffect once deals confirms
      setOptimisticStageMap((prev) => ({ ...prev, [activeId]: targetStageId! }));
      onDealDragEnd(activeId, targetStageId).catch(() => {
        setOptimisticStageMap((prev) => {
          const { [activeId]: _, ...rest } = prev;
          return rest;
        });
      });
    } else {
      // No actual move — clear optimistic entry
      setOptimisticStageMap((prev) => {
        const { [activeId]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 overflow-x-auto pb-4 custom-scrollbar">
        <div className="flex gap-6 h-full min-w-max items-start">
          {pipeline.stages.map((stage) => {
            const stageDeals = deals
              .map((d) =>
                optimisticStageMap[d.id] ? { ...d, stageId: optimisticStageMap[d.id] } : d
              )
              .filter((d) => d.stageId === stage.id);
            const stageValue = stageDeals.reduce((acc, d) => acc + d.value, 0);
            const isLoading = loadingStages.has(stage.id);
            const hasMore = hasMoreByStage[stage.id] ?? false;

            return (
              <DroppableStage
                key={stage.id}
                stage={stage}
                stageValue={stageValue}
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
                      <SortableDealCard
                        key={deal.id}
                        deal={deal}
                        assignedUser={users.find((u) => u.id === deal.assignedUserId)}
                        onClick={onDealClick}
                        canDrag={canEdit}
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
            <DealCardContent
              deal={activeDeal}
              assignedUser={users.find((u) => u.id === activeDeal.assignedUserId)}
              isDragOverlay={true}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default PipelineKanbanBoard;

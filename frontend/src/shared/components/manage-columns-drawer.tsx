'use client';
import { panelThemeClass, panelHeaderClass, panelTitleClass, panelBodyClass, panelFooterClass, panelInputClass, panelCloseClass, panelPrimaryActionClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';

import { useState, useMemo, useCallback, useEffect, useRef, useId } from 'react';
import { GripVertical, Lock, X, Search } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Switch } from '@/shared/components/ui/switch';
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { cn } from '@/lib/utils';
import type { ColumnDefinition, ColumnConfigItem } from '@leadcrm/shared';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { OverlayOwnerContext, ThemedPortal } from '@/shared/components/theme-scope';

// ─────────────────────────────────────────────────────
// SHARED MANAGE COLUMNS DRAWER
// Reusable across all modules. Does NOT know about CRM-specific fields.
// Usage:
//   <ManageColumnsDrawer
//     isOpen={isOpen}
//     onClose={() => setIsOpen(false)}
//     module="accounts"
//     registry={ACCOUNTS_COLUMN_REGISTRY}
//     effectiveColumns={effectiveColumns}
//     onSave={saveColumns}
//     onReset={resetColumns}
//   />
// ─────────────────────────────────────────────────────

interface ManageColumnsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  module: string;
  registry: ColumnDefinition[];
  effectiveColumns: ColumnConfigItem[];
  onSave: (config: ColumnConfigItem[]) => Promise<void>;
  onReset: () => Promise<void>;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

interface DisplayColumn extends ColumnConfigItem {
  label: string;
  required: boolean;
  group: string;
}

interface SortableColumnItemProps {
  col: DisplayColumn;
  index: number;
  total: number;
  onToggle: (id: string) => void;
}

function SortableColumnItem({ col, index, total, onToggle }: SortableColumnItemProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={`Column ${col.label}, position ${index} of ${total}`}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors',
        'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800',
        isDragging && 'opacity-50 shadow-lg z-10'
      )}
      {...attributes}
    >
      <span
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 touch-none"
        aria-label={`Drag to reorder ${col.label}`}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">{col.label}</span>
      {col.required ? (
        <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400" aria-label={`${col.label} is required`}>
          <Lock className="h-3.5 w-3.5" />
          <Switch checked={true} disabled={true} aria-label={`${col.label} visibility (locked)`} />
        </span>
      ) : (
        <Switch
          checked={col.visible}
          onCheckedChange={() => onToggle(col.id)}
          aria-label={`Toggle ${col.label} visibility`}
        />
      )}
    </li>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function ManageColumnsDrawer({
  isOpen, onClose, module, registry, effectiveColumns, onSave, onReset, triggerRef,
}: ManageColumnsDrawerProps): React.ReactElement | null {
  const [localColumns, setLocalColumns] = useState<ColumnConfigItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [resetError, setResetError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const owner = useId();
  const wasOpen = useRef(false);

  // Sync local columns when drawer opens or effectiveColumns change
  useEffect(() => {
    if (isOpen) {
      // If effectiveColumns is empty (API not available / loading), build from registry defaults
      const columns = effectiveColumns.length > 0
        ? [...effectiveColumns]
        : registry.map((col) => ({ id: col.id, visible: col.defaultVisible, order: col.defaultOrder }));
      setLocalColumns(columns);
      setSearchQuery('');
      setSaveState('idle');
      setResetError(null);
      setShowResetConfirm(false);
      setShowCloseConfirm(false);
      setRetryCount(0);
    }
  }, [isOpen, effectiveColumns, registry]);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const hasChanges = useMemo(() => {
    if (localColumns.length !== effectiveColumns.length) return true;
    return localColumns.some((col, idx) => {
      const orig = effectiveColumns[idx];
      return col.id !== orig.id || col.visible !== orig.visible || col.order !== orig.order;
    });
  }, [localColumns, effectiveColumns]);

  const displayColumns: DisplayColumn[] = useMemo(() => {
    const sorted = [...localColumns].sort((a, b) => a.order - b.order);
    return sorted
      .map((col) => {
        const def = registry.find((r) => r.id === col.id);
        return { ...col, label: def?.label ?? col.id, required: def?.required ?? false, group: def?.group ?? 'General' };
      })
      .filter((col) => col.label.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [localColumns, registry, searchQuery]);

  /** Columns grouped by registry-defined group labels */
  const groupedColumns = useMemo(() => {
    const groups: { name: string; columns: DisplayColumn[] }[] = [];
    const seenGroups = new Set<string>();

    for (const col of displayColumns) {
      const groupName = col.group;
      if (!seenGroups.has(groupName)) {
        seenGroups.add(groupName);
        groups.push({ name: groupName, columns: [] });
      }
      groups.find((g) => g.name === groupName)!.columns.push(col);
    }

    return groups;
  }, [displayColumns]);

  const displayColumnIds = useMemo(() => displayColumns.map((col) => col.id), [displayColumns]);

  // DnD sensors: 5px drag threshold + keyboard with sortable coordinates
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /** Reassign sequential 0-based order values after each drop */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLocalColumns((prev) => {
      const allSorted = [...prev].sort((a, b) => a.order - b.order);

      if (searchQuery) {
        // When search is active, reorder only within matching items
        const matchingIds = new Set(displayColumns.map((c) => c.id));
        const matchingItems = allSorted.filter((c) => matchingIds.has(c.id));
        const oldIndex = matchingItems.findIndex((c) => c.id === active.id);
        const newIndex = matchingItems.findIndex((c) => c.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;

        const reorderedMatching = arrayMove(matchingItems, oldIndex, newIndex);

        let matchIdx = 0;
        const rebuilt = allSorted.map((c) => {
          if (matchingIds.has(c.id)) {
            return reorderedMatching[matchIdx++];
          }
          return c;
        });

        return rebuilt.map((col, idx) => ({ ...col, order: idx }));
      }

      const oldIndex = allSorted.findIndex((c) => c.id === active.id);
      const newIndex = allSorted.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const reordered = arrayMove(allSorted, oldIndex, newIndex);
      return reordered.map((col, idx) => ({ ...col, order: idx }));
    });
  }, [searchQuery, displayColumns]);

  const handleToggleVisibility = useCallback((columnId: string) => {
    setLocalColumns((prev) =>
      prev.map((col) => (col.id === columnId ? { ...col, visible: !col.visible } : col))
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!hasChanges || saveState === 'saving') return;
    setSaveState('saving');
    setResetError(null);
    try {
      await onSave(localColumns);
      setSaveState('saved');
      setRetryCount(0);
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setRetryCount((prev) => prev + 1);
    }
  }, [hasChanges, saveState, localColumns, onSave]);

  const handleRetry = useCallback(async () => {
    if (retryCount >= 3) return;
    await handleSave();
  }, [retryCount, handleSave]);

  /** Reset to Default: calls resetColumns() → DELETE /api/v1/preferences/columns/:module */
  const handleResetConfirm = useCallback(async () => {
    setResetError(null);
    setSaveState('saving');
    try {
      await onReset();
      setSaveState('idle');
      setRetryCount(0);
    } catch {
      setSaveState('idle');
      setResetError('Unable to reset columns. Please try again.');
      throw new Error('Unable to reset columns. Please try again.');
    }
  }, [onReset]);

  const handleClose = useCallback(() => {
    if (saveState === 'saving') return;
    if (hasChanges) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [hasChanges, onClose, saveState]);

  const handleConfirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onClose();
  }, [onClose]);

  useModalInteraction({ open: isOpen, panelRef: drawerRef, owner, onClose: handleClose });
  useEffect(() => {
    if (wasOpen.current && !isOpen) triggerRef?.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;

  return (
    <OverlayOwnerContext.Provider value={owner}><ThemedPortal><div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
        data-overlay-backdrop=""
        aria-hidden="true"
      />
      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Manage Columns - ${module}`}
        className={cn(
          'relative w-full max-w-md shadow-xl border-l', panelThemeClass,
          'flex flex-col h-dvh transition-transform duration-300',
          'sm:max-w-md max-sm:max-w-full',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className={panelHeaderClass + " flex items-center justify-between gap-3"}>
          <h2 className={panelTitleClass}>Manage Columns</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saveState === 'saving'}
            className={panelCloseClass + " grid place-items-center"}
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* Search */}
        <div className="shrink-0 border-b border-slate-100 px-4 py-4 sm:px-6 dark:border-white/5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search columns..."
              className={panelInputClass + " pl-10"}
              aria-label="Search columns"
            />
          </div>
        </div>
        {/* Column List */}
        <div className={panelBodyClass}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayColumnIds} strategy={verticalListSortingStrategy}>
              {groupedColumns.length > 0 ? (
                <div className="space-y-4" role="list" aria-label="Column list">
                  {groupedColumns.map((group) => (
                    <div key={group.name}>
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 px-1 pb-1.5 border-b border-gray-100 dark:border-gray-800 mb-1.5">
                        {group.name}
                      </h3>
                      <ul className="space-y-1">
                        {group.columns.map((col) => {
                          const positionIndex = displayColumns.indexOf(col) + 1;
                          return (
                            <SortableColumnItem
                              key={col.id}
                              col={col}
                              index={positionIndex}
                              total={displayColumns.length}
                              onToggle={handleToggleVisibility}
                            />
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No columns match your search.
                </div>
              )}
            </SortableContext>
          </DndContext>
        </div>
        {/* Reset Error State */}
        {resetError && (
          <div className="px-6 py-3 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
            <span className="text-sm text-red-700 dark:text-red-400">{resetError}</span>
          </div>
        )}
        {/* Save Error State */}
        {saveState === 'error' && retryCount < 3 && (
          <div className="px-6 py-3 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
            <div className="flex items-center justify-between">
              <span className="text-sm text-red-700 dark:text-red-400">Unable to save</span>
              <button
                type="button"
                onClick={handleRetry}
                className="px-3 py-1 text-sm font-medium rounded-md text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {saveState === 'error' && retryCount >= 3 && (
          <div className="px-6 py-3 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
            <span className="text-sm text-red-700 dark:text-red-400">Unable to save. Please close and try again.</span>
          </div>
        )}
        {/* Footer */}
        <div className={panelFooterClass + " flex-wrap justify-between"}>
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            disabled={saveState === 'saving'}
            className={panelSecondaryActionClass}
          >
            Reset to Default
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saveState === 'saving' || saveState === 'saved'}
            className={panelPrimaryActionClass}
          >
            {saveState === 'saving' && 'Saving...'}
            {saveState === 'saved' && 'Saved'}
            {(saveState === 'idle' || saveState === 'error') && 'Save'}
          </button>
        </div>
      </div>
      <ConfirmActionDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}
        title="Reset to Default?" description="This will remove your custom column configuration and revert to the default layout."
        confirmLabel="Reset" isLoading={saveState === 'saving'} onConfirm={handleResetConfirm} />
      <ConfirmActionDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}
        title="Discard changes?" description="You have unsaved changes. Are you sure you want to close without saving?"
        variant="warning" confirmLabel="Discard" cancelLabel="Keep editing" onConfirm={handleConfirmClose} />
    </div></ThemedPortal></OverlayOwnerContext.Provider>
  );
}

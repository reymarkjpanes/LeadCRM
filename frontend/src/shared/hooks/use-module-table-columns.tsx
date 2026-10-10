'use client';

import { useRef, useState } from 'react';
import type { ColumnDefinition } from '@leadcrm/shared';
import type { DataGridColumnDef } from '@/shared/components/data-grid';
import { ManageColumnsDrawer } from '@/shared/components/manage-columns-drawer';
import { useColumnPreferences } from './use-column-preferences';

export function useModuleTableColumns<T>(module: string, registry: ColumnDefinition[], columns: DataGridColumnDef<T>[]) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const { effectiveColumns, saveColumns, resetColumns } = useColumnPreferences(module);
  const config = effectiveColumns.length ? effectiveColumns : registry.map(col => ({ id: col.id, visible: col.defaultVisible, order: col.defaultOrder }));
  const visibleColumns = [...config].sort((a, b) => a.order - b.order)
    .filter(col => col.visible || registry.some(item => item.id === col.id && item.required))
    .flatMap(col => { const definition = columns.find(item => item.id === col.id); return definition ? [definition] : []; });
  return { columns: visibleColumns, openColumns: () => { triggerRef.current = document.activeElement as HTMLElement; setOpen(true); }, drawer: <ManageColumnsDrawer
    isOpen={open} onClose={() => setOpen(false)} module={module} registry={registry}
    effectiveColumns={effectiveColumns} onSave={saveColumns} onReset={resetColumns} triggerRef={triggerRef} /> };
}

'use client';

import React, { useId } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { FormFieldType, FormDesign } from '../types/form.types';
import { cn } from '@/lib/utils';

// ── Palette item descriptor ─────────────────────────────────────────────────
export interface PaletteField {
  type: FormFieldType;
  label: string;
  icon: string;
  color?: string;         // tailwind bg class — undefined = slate (layout)
  section: 'layout' | 'crm' | 'regular';
}

export const PALETTE_FIELDS: PaletteField[] = [
  // Layout
  { type: 'heading',        label: 'Heading',        icon: 'H1',  section: 'layout' },
  { type: 'paragraph',      label: 'Paragraph',      icon: 'P',   section: 'layout' },
  { type: 'divider',        label: 'Divider',        icon: '—',   section: 'layout' },
  // CRM mapped
  { type: 'contact-name',   label: 'Contact Name',   icon: '👤',  color: 'bg-emerald-700', section: 'crm' },
  { type: 'contact-phone',  label: 'Contact Phone',  icon: '📞',  color: 'bg-emerald-700', section: 'crm' },
  { type: 'contact-email',  label: 'Contact Email',  icon: '@',   color: 'bg-emerald-700', section: 'crm' },
  { type: 'company-website',label: 'Company Website',icon: '🌐',  color: 'bg-emerald-700', section: 'crm' },
  { type: 'company-name',   label: 'Company Name',   icon: '🏢',  color: 'bg-emerald-700', section: 'crm' },
  // Regular
  { type: 'single-line',    label: 'Single Line',    icon: 'T',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'multi-line',     label: 'Multi Line',     icon: '≡',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'email',          label: 'Email',          icon: '@',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'phone',          label: 'Phone',          icon: '☎',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'number',         label: 'Number',         icon: '#',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'date',           label: 'Date',           icon: '📅',  color: 'bg-amber-700',   section: 'regular' },
  { type: 'checkbox',       label: 'Checkbox',       icon: '☑',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'radio',          label: 'Radio',          icon: '◉',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'dropdown',       label: 'Dropdown',       icon: '⊙',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'url',            label: 'URL',            icon: '🌐',  color: 'bg-amber-700',   section: 'regular' },
  { type: 'rating',         label: 'Rating',         icon: '★',   color: 'bg-amber-700',   section: 'regular' },
  { type: 'file',           label: 'File Upload',    icon: '📎',  color: 'bg-amber-700',   section: 'regular' },
];

// Encode palette drag ids so the DndContext can distinguish palette vs canvas
export const PALETTE_DRAG_PREFIX = 'palette::';
export function isPaletteDrag(id: string): boolean {
  return String(id).startsWith(PALETTE_DRAG_PREFIX);
}
export function paletteTypeFromId(id: string): FormFieldType {
  return String(id).slice(PALETTE_DRAG_PREFIX.length) as FormFieldType;
}

// ── DraggablePaletteItem ────────────────────────────────────────────────────
interface DraggableItemProps {
  field: PaletteField;
  onAddField: (type: FormFieldType) => void;
}

function DraggableItem({ field, onAddField }: DraggableItemProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    disabled: field.type === 'file',
    id: `${PALETTE_DRAG_PREFIX}${field.type}`,
    data: { type: field.type, fromPalette: true },
  });

  const isLayout = field.section === 'layout';

  return (
    <button type="button" disabled={field.type === 'file'}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onAddField(field.type)}
      title={field.type === 'file' ? 'File Upload is not supported yet' : `Add ${field.label} — or drag onto canvas`}
      className={cn(
        'flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all cursor-grab active:cursor-grabbing select-none group disabled:opacity-40 disabled:cursor-not-allowed',
        'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-white/[0.07]',
        'hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10',
        isDragging && 'opacity-40 scale-95',
      )}
    >
      {isLayout ? (
        <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-700 dark:text-slate-300 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors text-sm">
          {field.icon}
        </div>
      ) : (
        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold', field.color)}>
          {field.icon}
        </div>
      )}
      <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
        {field.label}
      </span>
    </button>
  );
}

// ── FieldPalette ────────────────────────────────────────────────────────────
interface FieldPaletteProps {
  onAddField: (type: FormFieldType) => void;
  design?: FormDesign;
  onDesignChange?: (design: FormDesign) => void;
  mode?: 'fields' | 'design';
}

export function FieldPalette({ onAddField, design, onDesignChange, mode = 'fields' }: FieldPaletteProps): React.ReactElement {
  if (mode === 'design' && design && onDesignChange) {
    return <DesignPanel design={design} onChange={onDesignChange} />;
  }

  const layout  = PALETTE_FIELDS.filter((f) => f.section === 'layout');
  const crm     = PALETTE_FIELDS.filter((f) => f.section === 'crm');
  const regular = PALETTE_FIELDS.filter((f) => f.section === 'regular');

  return (
    <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar flex-1">

      {/* Layout */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">LAYOUT</p>
        <div className="grid grid-cols-2 gap-2">
          {layout.map((f) => <DraggableItem key={f.type} field={f} onAddField={onAddField} />)}
        </div>
      </div>

      {/* CRM template */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">CHOOSE FROM A TEMPLATE</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-2">Automatically maps to a CRM field.</p>
        <div className="grid grid-cols-2 gap-2">
          {crm.map((f) => <DraggableItem key={f.type} field={f} onAddField={onAddField} />)}
        </div>
      </div>

      {/* Regular */}
      <div>
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">REGULAR FIELDS</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-2">Start from scratch — optionally map to a CRM field later.</p>
        <div className="grid grid-cols-2 gap-2">
          {regular.map((f) => <DraggableItem key={f.type} field={f} onAddField={onAddField} />)}
        </div>
      </div>
    </div>
  );
}

// ── DesignPanel (unchanged) ─────────────────────────────────────────────────
interface DesignPanelProps { design: FormDesign; onChange: (d: FormDesign) => void; }

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): React.ReactElement {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input type="color" aria-label={`${label} color picker`} value={/^#[\da-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded cursor-pointer border-0 bg-transparent" />
        <input id={id} type="text" value={value} maxLength={9} onChange={(e) => onChange(e.target.value)} placeholder="e.g. #3B82F6"
          className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-[11px] focus:outline-none focus:border-blue-500 transition-colors" />
      </div>
    </div>
  );
}

function DesignPanel({ design, onChange }: DesignPanelProps): React.ReactElement {
  const update = (patch: Partial<FormDesign>) => onChange({ ...design, ...patch });
  return (
    <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar flex-1">
      <details open className="group">
        <summary className="flex items-center justify-between cursor-pointer py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 list-none">
          <span>🎨 General styles</span>
          <svg className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div className="mt-2 space-y-3">
          <ColorInput label="Background" value={design.generalBg} onChange={(v) => update({ generalBg: v })} />
          <ColorInput label="Border" value={design.generalBorder} onChange={(v) => update({ generalBorder: v })} />
          <ColorInput label="Text" value={design.generalText} onChange={(v) => update({ generalText: v })} />
        </div>
      </details>
      <details open className="group">
        <summary className="flex items-center justify-between cursor-pointer py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 list-none">
          <span>✏️ Field styles</span>
          <svg className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div className="mt-2 space-y-3">
          <ColorInput label="Background" value={design.fieldBg} onChange={(v) => update({ fieldBg: v })} />
          <ColorInput label="Border" value={design.fieldBorder} onChange={(v) => update({ fieldBorder: v })} />
          <ColorInput label="Text" value={design.fieldText} onChange={(v) => update({ fieldText: v })} />
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Radius</label>
            <select aria-label="Field radius" value={design.fieldRadius} onChange={(e) => update({ fieldRadius: e.target.value as FormDesign['fieldRadius'] })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500">
              {(['none','sm','md','lg','full'] as const).map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Size</label>
            <select aria-label="Field size" value={design.fieldSize} onChange={(e) => update({ fieldSize: e.target.value as FormDesign['fieldSize'] })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg text-xs focus:outline-none focus:border-blue-500">
              {(['sm','regular','lg'] as const).map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </details>
      <details open className="group">
        <summary className="flex items-center justify-between cursor-pointer py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 list-none">
          <span>👆 Button styles</span>
          <svg className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
        </summary>
        <div className="mt-2 space-y-3">
          <ColorInput label="Background" value={design.buttonBg} onChange={(v) => update({ buttonBg: v })} />
          <ColorInput label="Border" value={design.buttonBorder} onChange={(v) => update({ buttonBorder: v })} />
          <ColorInput label="Text" value={design.buttonText} onChange={(v) => update({ buttonText: v })} />
        </div>
      </details>
    </div>
  );
}

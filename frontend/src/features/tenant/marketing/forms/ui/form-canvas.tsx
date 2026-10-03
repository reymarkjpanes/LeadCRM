'use client';
import { useState } from 'react';
import { ArrowUp, ArrowDown, GripVertical, Settings2, Trash2 } from 'lucide-react';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FORM_MAPPINGS, type FormField, type FormDesign } from '@leadcrm/shared';
import { FormInput } from './form-input';
export const CANVAS_DROPPABLE_ID = 'form-canvas';
function FieldRow({ field, design, index, total, onUpdate, onRemove, onMove }: { field: FormField; design: FormDesign; index: number; total: number; onUpdate: (patch: Partial<FormField>) => void; onRemove: () => void; onMove: (to: number) => void }) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const layout = ['heading', 'paragraph', 'divider'].includes(field.type);
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .4 : 1 }} className={'min-w-0 p-1 ' + (field.width === 'half' ? '' : 'sm:col-span-2')}>
    <div className="flex flex-wrap items-center gap-1 mb-2 text-slate-500">
      <button type="button" {...attributes} {...listeners} aria-label={'Drag ' + field.label} className="hidden lg:block p-2 touch-none"><GripVertical size={14} /></button>
      <button type="button" aria-label={'Move ' + field.label + ' up'} disabled={index === 0} onClick={() => onMove(index - 1)} className="p-2 disabled:opacity-20"><ArrowUp size={14} /></button>
      <button type="button" aria-label={'Move ' + field.label + ' down'} disabled={index === total - 1} onClick={() => onMove(index + 1)} className="p-2 disabled:opacity-20"><ArrowDown size={14} /></button>
      <button type="button" aria-label={'Edit ' + field.label} aria-expanded={editing} onClick={() => setEditing(v => !v)} className="p-2"><Settings2 size={14} /></button>
      <button type="button" aria-label={'Remove ' + field.label} onClick={onRemove} className="p-2 text-red-600"><Trash2 size={14} /></button>
    </div>
    <FormInput field={field} design={design} onChange={() => {}} />
    {editing && <div className="mt-3 p-3 bg-slate-50 border rounded-md text-slate-800 text-xs space-y-3">
      <label className="block">Label<input className="w-full p-2 border rounded mt-1" value={field.label} maxLength={500} onChange={e => onUpdate({ label: e.target.value })} /></label>
      {!layout && <>
        <label className="block">Placeholder<input className="w-full p-2 border rounded mt-1" value={field.placeholder ?? ''} maxLength={500} onChange={e => onUpdate({ placeholder: e.target.value })} /></label>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={!!field.required} onChange={e => onUpdate({ required: e.target.checked })} />Required</label>
        <label className="block">CRM mapping<select className="w-full p-2 border rounded mt-1" value={field.mapToField ?? ''} onChange={e => onUpdate({ mapToField: e.target.value as FormField['mapToField'] })}><option value="">No mapping</option>{FORM_MAPPINGS.map(m => <option key={m}>{m}</option>)}</select></label>
        {field.mapToField === 'productInterest' && <p>Options are managed in Settings → Products.</p>}
        {field.mapToField !== 'productInterest' && ['dropdown', 'radio'].includes(field.type) && <label className="block">Options (one per line)<textarea rows={5} className="w-full p-2 border rounded mt-1" value={field.options?.join('\n') ?? ''} onChange={e => onUpdate({ options: e.target.value.split('\n') })} /></label>}
      </>}
      <label className="block">Width<select className="w-full p-2 border rounded mt-1" value={field.width ?? 'full'} onChange={e => onUpdate({ width: e.target.value as 'half' | 'full' })}><option value="full">Full width</option><option value="half">Half width on larger screens</option></select></label>
    </div>}
  </div>;
}
export function FormCanvas({ fields, design, onChange }: { fields: FormField[]; design: FormDesign; onChange: (fields: FormField[]) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_DROPPABLE_ID });
  return <div className="max-w-2xl mx-auto min-w-0">
    <div ref={setNodeRef} className={'border rounded-t-lg p-3 sm:p-6 ' + (isOver ? 'ring-2 ring-blue-400' : '')} style={{ backgroundColor: design.generalBg || '#fff', borderColor: design.generalBorder || '#e2e8f0', color: design.generalText || '#0f172a' }}>
      {!fields.length && <p className="py-12 text-center text-sm text-slate-500">Open Fields below to add your first field.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><SortableContext items={fields.map(f => f.id)} strategy={rectSortingStrategy}>{fields.map((f, index) => <FieldRow key={f.id} field={f} design={design} index={index} total={fields.length} onUpdate={patch => onChange(fields.map(old => old.id === f.id ? { ...old, ...patch } : old))} onRemove={() => onChange(fields.filter(old => old.id !== f.id))} onMove={to => onChange(arrayMove(fields, index, to))} />)}</SortableContext></div>
      <button type="button" className="w-full border rounded-md mt-6 p-3 text-sm font-semibold" style={{ backgroundColor: design.buttonBg || '#2563eb', borderColor: design.buttonBorder || '#2563eb', color: design.buttonText || '#fff' }}>Submit</button>
    </div>
    <div className="bg-slate-50 text-slate-700 border border-t-0 rounded-b-lg p-6 text-center space-y-2"><h2 className="text-xl font-bold">Thank you!</h2><p className="text-sm font-semibold">Thank you for submitting the form.</p><p className="text-xs">Your submission has been received.<br />We will get back to you shortly.</p></div>
  </div>;
}

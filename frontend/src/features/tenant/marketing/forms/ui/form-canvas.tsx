'use client';
import { useState, type CSSProperties } from 'react';
import { panelThemeClass } from '@/shared/components/side-panel-styles';
import { GripVertical, Settings2, Trash2 } from 'lucide-react';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { type CrmFieldCatalogEntry, type FormField, type FormDesign, type FormProductCatalog } from '@leadcrm/shared';
import { FormInput } from './form-input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Input } from '@/shared/components/ui/input';
export const CANVAS_DROPPABLE_ID = 'form-canvas';
function FieldRow({ field, design, configured, onUpdate, onRemove, productCatalog }: { field: FormField; design: FormDesign; configured?: CrmFieldCatalogEntry; onUpdate: (patch: Partial<FormField>) => void; onRemove: () => void; productCatalog?: FormProductCatalog }) {
  const [editing, setEditing] = useState(false);
  const [previewProducts, setPreviewProducts] = useState<string[]>([]);
  const [previewName, setPreviewName] = useState('');
  const isNameField = field.mapToField === 'firstName' || field.mapToField === 'lastName';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const layout = ['header', 'heading', 'paragraph', 'divider'].includes(field.type);
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .4 : 1 }} className={'min-w-0 p-1 ' + (field.width === 'half' ? '' : 'sm:col-span-2')}>
    <div className="flex flex-wrap items-center gap-1 mb-2 text-slate-500">
      <button type="button" {...attributes} {...listeners} aria-label={'Drag ' + field.label} className="p-2 touch-none cursor-grab active:cursor-grabbing"><GripVertical size={14} /></button>
      <button type="button" aria-label={'Edit ' + field.label} aria-expanded={editing} onClick={() => setEditing(v => !v)} className="p-2"><Settings2 size={14} /></button>
      <button type="button" aria-label={'Remove ' + field.label} onClick={onRemove} className="p-2 text-red-600"><Trash2 size={14} /></button>
    </div>
    <div style={{ '--surface': design.fieldBg || '#ffffff', '--background': design.fieldBg || '#ffffff', '--text-primary': design.fieldText || '#0f172a', '--border': design.fieldBorder || '#cbd5e1', '--input': design.fieldBorder || '#cbd5e1', '--muted-foreground': `color-mix(in srgb, ${design.fieldText || '#0f172a'} 70%, ${design.fieldBg || '#ffffff'})` } as CSSProperties}>
      <FormInput field={field} design={design} productCatalog={productCatalog} value={field.mapToField === 'productInterest' ? previewProducts : isNameField ? previewName : undefined} onChange={value => {
        if (field.mapToField === 'productInterest' && Array.isArray(value)) setPreviewProducts(value);
        if (isNameField && typeof value === 'string') setPreviewName(value);
      }} />
    </div>
    {editing && <div className={panelThemeClass + " mt-3 p-3 border rounded-md text-xs space-y-3"}>
      <label className="block">Label<Input placeholder="Enter field label..." className="w-full p-2 border rounded mt-1" value={field.label} maxLength={500} onChange={e => onUpdate({ label: e.target.value })} /></label>
      {!layout && <>
        <label className="block">Placeholder<Input placeholder="e.g. Enter your name..." className="w-full p-2 border rounded mt-1" value={field.placeholder ?? ''} maxLength={500} onChange={e => onUpdate({ placeholder: e.target.value })} /></label>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={!!field.required} disabled={!!field.customFieldId && !!configured?.required && !!field.required} onChange={e => onUpdate({ required: e.target.checked })} />Required</label>
        {(field.mapToField || field.customFieldId) && <p>Lead {field.customFieldId ? 'Custom' : 'System'} field: {configured?.label ?? field.label}</p>}
        {(field.type === 'company-website' || field.mapToField === 'website') && <p>Website answers are saved in submission history. They do not update the CRM record.</p>}
        {field.mapToField === 'productInterest' && <p>Options are managed in Settings → Products.</p>}
        {(field.customFieldId || field.mapToField === 'source') && field.type === 'dropdown' && <p>Options are managed in Settings → Customize Fields → Leads.</p>}
        {!field.customFieldId && !field.mapToField && ['dropdown', 'radio'].includes(field.type) && <label className="block">Options (one per line)<Textarea placeholder="Enter one option per line..." rows={5} className="w-full p-2 border rounded mt-1" value={field.options?.join('\n') ?? ''} onChange={e => onUpdate({ options: e.target.value.split('\n') })} /></label>}
      </>}
      <label className="block">Width<select className="w-full p-2 border border-border rounded mt-1 bg-card text-foreground focus-visible:ring-2 focus-visible:ring-ring" value={field.width ?? 'full'} onChange={e => onUpdate({ width: e.target.value as 'half' | 'full' })}><option value="full">Full width</option><option value="half">Half width on larger screens</option></select></label>
    </div>}
  </div>;
}
export function FormCanvas({ fields, catalog = [], design, onChange, productCatalog }: { fields: FormField[]; catalog?: CrmFieldCatalogEntry[]; design: FormDesign; onChange: (fields: FormField[]) => void; productCatalog?: FormProductCatalog }) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_DROPPABLE_ID });
  return <div className="max-w-2xl mx-auto min-w-0">
    <div ref={setNodeRef} className={'border rounded-t-lg p-3 sm:p-6 ' + (isOver ? 'ring-2 ring-ring' : '')} style={{ backgroundColor: design.generalBg || '#fff', borderColor: design.generalBorder || '#e2e8f0', color: design.generalText || '#0f172a' }}>
      {!fields.length && <p className="py-12 text-center text-sm text-slate-500">Open Fields below to add your first field.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><SortableContext items={fields.map(f => f.id)} strategy={rectSortingStrategy}>{fields.map(f => <FieldRow key={f.id} field={f} design={design} productCatalog={productCatalog} configured={catalog.find(item => f.customFieldId ? item.customFieldId === f.customFieldId : item.technicalKey === f.mapToField)} onUpdate={patch => onChange(fields.map(old => old.id === f.id ? { ...old, ...patch } : old))} onRemove={() => onChange(fields.filter(old => old.id !== f.id))} />)}</SortableContext></div>
      <button type="button" className="w-full border rounded-md mt-6 p-3 text-sm font-semibold" style={{ backgroundColor: design.buttonBg || '#2563eb', borderColor: design.buttonBorder || '#2563eb', color: design.buttonText || '#fff' }}>Submit</button>
    </div>
    <div className="bg-slate-50 text-slate-700 border border-t-0 rounded-b-lg p-6 text-center space-y-2"><h2 className="text-xl font-bold">Thank you!</h2><p className="text-sm font-semibold">Thank you for submitting the form.</p><p className="text-xs">Your submission has been received.<br />We will get back to you shortly.</p></div>
  </div>;
}

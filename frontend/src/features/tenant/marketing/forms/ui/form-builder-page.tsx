'use client';

import React, { useState, useCallback, useRef } from 'react';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { FormRecord, FormField, FormFieldType } from '../types/form.types';
import { updateForm, publishForm, getShareLink, getEmbedCode } from '../services/forms.service';
import { FormCanvas, CANVAS_DROPPABLE_ID, SortableFieldRow } from './form-canvas';
import { FieldPalette, PALETTE_FIELDS, isPaletteDrag, paletteTypeFromId } from './field-palette';
import { FormSettingsPanel } from './form-settings-panel';
import { FormSharePanel } from './form-share-panel';
import { FormPublishedModal } from './form-published-modal';

// ── Default label / placeholder by type ──────────────────────────────────────
const FIELD_DEFAULTS: Record<FormFieldType, { label: string; placeholder?: string; options?: string[] }> = {
  'heading':         { label: 'Heading' },
  'paragraph':       { label: 'Your paragraph text here…' },
  'divider':         { label: '' },
  'single-line':     { label: 'Short answer', placeholder: 'Enter text…' },
  'multi-line':      { label: 'Long answer', placeholder: 'Enter text…' },
  'email':           { label: 'Email address', placeholder: 'e.g. john@example.com' },
  'phone':           { label: 'Phone number', placeholder: 'e.g. +1 555 000 0000' },
  'number':          { label: 'Number', placeholder: 'e.g. 42' },
  'date':            { label: 'Date' },
  'checkbox':        { label: 'I agree to the terms' },
  'radio':           { label: 'Choose one', options: ['Option 1', 'Option 2', 'Option 3'] },
  'dropdown':        { label: 'Select an option', placeholder: 'Choose…', options: ['Option 1', 'Option 2'] },
  'url':             { label: 'Website URL', placeholder: 'https://example.com' },
  'rating':          { label: 'How would you rate us?' },
  'file':            { label: 'File upload', placeholder: 'Click to upload or drag a file here' },
  'contact-name':    { label: 'Full name', placeholder: 'e.g. Jane Doe' },
  'contact-email':   { label: 'Email address', placeholder: 'e.g. jane@company.com' },
  'contact-phone':   { label: 'Phone number', placeholder: 'e.g. +1 555 000 0000' },
  'company-name':    { label: 'Company name', placeholder: 'e.g. Acme Corp' },
  'company-website': { label: 'Company website', placeholder: 'https://company.com' },
};

function makeField(type: FormFieldType): FormField {
  const defaults = FIELD_DEFAULTS[type] ?? { label: type };
  return {
    id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    label: defaults.label,
    placeholder: defaults.placeholder,
    required: false,
    ...(defaults.options ? { options: defaults.options } : {}),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────
type BuilderTab = 'Builder' | 'Settings' | 'Share';

interface FormBuilderPageProps {
  form: FormRecord;
  onBack: () => void;
  onFormUpdate: (updated: FormRecord) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function FormBuilderPage({ form, onBack, onFormUpdate }: FormBuilderPageProps): React.ReactElement {
  const [activeTab, setActiveTab]           = useState<BuilderTab>('Builder');
  const [localForm, setLocalForm]           = useState<FormRecord>(form);
  const [isDirty, setIsDirty]               = useState(false);
  const [isSaving, setIsSaving]             = useState(false);
  const [isPublishedModalOpen, setIsPublishedModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab]   = useState<'Fields' | 'Design'>('Fields');

  // Track the active drag item so DragOverlay can render a ghost
  const [activeDragId, setActiveDragId]     = useState<string | null>(null);

  // Stable ref so callbacks never close over stale localForm
  const localFormRef = useRef(localForm);
  localFormRef.current = localForm;

  // ── DnD sensors ────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── Field mutation helpers ─────────────────────────────────────────────────
  const handleFieldsChange = useCallback((fields: FormField[]) => {
    const updated = { ...localFormRef.current, fields };
    setLocalForm(updated);
    setIsDirty(true);
    // Fire-and-forget auto-save — UI optimistically reflects the change immediately.
    // If the save fails, the next explicit save attempt will catch it.
    void updateForm(localFormRef.current.id, { fields }).catch(() => {
      // Non-blocking — user is not interrupted but will see stale data on reload
    });
  }, []);

  const handleDesignChange = useCallback((design: FormRecord['design']) => {
    const updated = { ...localFormRef.current, design };
    setLocalForm(updated);
    setIsDirty(true);
    void updateForm(localFormRef.current.id, { design }).catch(() => {});
  }, []);

  const handleSettingsChange = useCallback((settings: FormRecord['settings']) => {
    const updated = { ...localFormRef.current, settings };
    setLocalForm(updated);
    setIsDirty(true);
    void updateForm(localFormRef.current.id, { settings }).catch(() => {});
  }, []);

  // Click-to-add from palette (still works alongside drag)
  const handleAddField = useCallback((type: FormFieldType) => {
    handleFieldsChange([...localFormRef.current.fields, makeField(type)]);
  }, [handleFieldsChange]);

  // ── DnD handlers ──────────────────────────────────────────────────────────
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId   = String(over.id);

    // ── Case 1: palette item dropped onto the canvas (or any canvas field) ──
    if (isPaletteDrag(activeId)) {
      const type = paletteTypeFromId(activeId);
      const currentFields = localFormRef.current.fields;

      // Find insert index: if dropped on a field, insert before it; else append
      const overFieldIdx = currentFields.findIndex((f) => f.id === overId);
      const newField = makeField(type);
      if (overFieldIdx !== -1) {
        const next = [...currentFields];
        next.splice(overFieldIdx, 0, newField);
        handleFieldsChange(next);
      } else {
        // Dropped on canvas droppable area or anywhere else — append
        handleFieldsChange([...currentFields, newField]);
      }
      return;
    }

    // ── Case 2: canvas field reorder ─────────────────────────────────────────
    if (overId === CANVAS_DROPPABLE_ID) return; // dragged back to canvas background — no reorder
    const currentFields = localFormRef.current.fields;
    const oldIdx = currentFields.findIndex((f) => f.id === activeId);
    const newIdx = currentFields.findIndex((f) => f.id === overId);
    if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
      handleFieldsChange(arrayMove(currentFields, oldIdx, newIdx));
    }
  };

  // ── Publish / cancel ───────────────────────────────────────────────────────
  const handlePublish = async (): Promise<void> => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const published = await publishForm(localForm.id);
      setLocalForm(published);
      setIsDirty(false);
      onFormUpdate(published);
      setIsPublishedModalOpen(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish form');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = (): void => {
    setLocalForm(form);
    setIsDirty(false);
  };

  // ── Overlay ghost ──────────────────────────────────────────────────────────
  // Determine what to render in the DragOverlay
  const overlayField: FormField | null = (() => {
    if (!activeDragId) return null;
    if (isPaletteDrag(activeDragId)) {
      // Palette ghost — build a preview field
      const type = paletteTypeFromId(activeDragId);
      return makeField(type);
    }
    // Canvas reorder ghost
    return localForm.fields.find((f) => f.id === activeDragId) ?? null;
  })();

  const overlayPaletteField = activeDragId && isPaletteDrag(activeDragId)
    ? PALETTE_FIELDS.find((p) => p.type === paletteTypeFromId(activeDragId)) ?? null
    : null;

  const shareLink = getShareLink(localForm.id);
  const embedCode = getEmbedCode(localForm.id);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full -m-4 lg:-m-8 min-h-[calc(100vh-4rem)]">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-white/[0.07] bg-white dark:bg-slate-950 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack}
              className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0">
              <ArrowLeft size={14} /> <span>Forms</span>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-bold text-slate-900 dark:text-white truncate">{localForm.name}</h1>
              {isDirty ? (
                <span className="shrink-0 px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded border border-amber-500/20 uppercase">Unsaved</span>
              ) : localForm.status === 'draft' ? (
                <span className="shrink-0 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold rounded uppercase">Draft</span>
              ) : (
                <span className="shrink-0 px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold rounded border border-emerald-500/20 uppercase">Published</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isDirty && (
              <button onClick={handleCancel}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer">
                Discard
              </button>
            )}
            <button onClick={() => { void handlePublish(); }}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors shadow-md shadow-blue-500/20 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
              Publish
            </button>
            <div className="relative">
              <button onClick={() => setIsMoreMenuOpen((v) => !v)}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer">
                <MoreHorizontal size={16} />
              </button>
              <AnimatePresence>
                {isMoreMenuOpen && (
                  <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-lg z-50 py-1 overflow-hidden"
                    onMouseLeave={() => setIsMoreMenuOpen(false)}>
                    <button onClick={() => { handleCancel(); setIsMoreMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer">
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.61"/></svg>
                      Discard changes
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ── Tab strip ───────────────────────────────────────────────────── */}
        <div className="flex gap-0 px-5 border-b border-gray-200 dark:border-white/[0.07] bg-white dark:bg-slate-950 shrink-0">
          {(['Builder', 'Settings', 'Share'] as BuilderTab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === tab ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}>
              {tab}
              {activeTab === tab && (
                <motion.div layoutId="form-builder-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex min-h-0">

          {activeTab === 'Builder' && (
            <>
              {/* Canvas */}
              <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-900/60 p-6">
                <FormCanvas
                  fields={localForm.fields}
                  design={localForm.design}
                  onChange={handleFieldsChange}
                  activeFieldId={activeDragId}
                />
              </div>

              {/* Right panel */}
              <div className="w-64 shrink-0 border-l border-gray-200 dark:border-white/[0.07] bg-white dark:bg-slate-950 overflow-y-auto custom-scrollbar flex flex-col">
                <div className="flex gap-0 border-b border-gray-200 dark:border-white/[0.07] shrink-0">
                  {(['Fields', 'Design'] as const).map((t) => (
                    <button key={t} onClick={() => setRightPanelTab(t)}
                      className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                        rightPanelTab === t
                          ? 'text-slate-900 dark:text-white border-b-2 border-blue-500'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>

                {rightPanelTab === 'Fields' ? (
                  <FieldPalette onAddField={handleAddField} />
                ) : (
                  <FieldPalette
                    onAddField={() => {}}
                    design={localForm.design}
                    onDesignChange={handleDesignChange}
                    mode="design"
                  />
                )}
              </div>
            </>
          )}

          {activeTab === 'Settings' && (
            <div className="flex-1 overflow-y-auto p-6">
              <FormSettingsPanel settings={localForm.settings} onChange={handleSettingsChange} />
            </div>
          )}

          {activeTab === 'Share' && (
            <div className="flex-1 overflow-y-auto p-6">
              <FormSharePanel form={localForm} shareLink={shareLink} embedCode={embedCode} />
            </div>
          )}
        </div>
      </div>

      {/* ── DragOverlay — renders ghost while dragging ───────────────────── */}
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease' }}>
        {overlayField && !overlayPaletteField && (
          /* Canvas reorder ghost */
          <SortableFieldRow
            field={overlayField}
            isSelected={false}
            radiusCls="rounded-md"
            sizeCls="py-2 text-sm"
            isDragOverlay
            onSelect={() => {}}
            onRemove={() => {}}
            onUpdate={() => {}}
          />
        )}
        {overlayPaletteField && (
          /* Palette drag ghost — compact pill */
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white dark:bg-slate-900 border border-blue-400 rounded-xl shadow-2xl ring-2 ring-blue-400/30 min-w-[140px]">
            {overlayPaletteField.color ? (
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${overlayPaletteField.color}`}>
                {overlayPaletteField.icon}
              </div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-slate-700 dark:text-slate-300 text-xs">
                {overlayPaletteField.icon}
              </div>
            )}
            <span className="text-xs font-semibold text-slate-800 dark:text-white">{overlayPaletteField.label}</span>
          </div>
        )}
      </DragOverlay>

      {/* ── Publish success modal ────────────────────────────────────────── */}
      <FormPublishedModal
        isOpen={isPublishedModalOpen}
        onClose={() => setIsPublishedModalOpen(false)}
        shareLink={shareLink}
        embedCode={embedCode}
      />
    </DndContext>
  );
}

'use client';
import { feedbackError } from '@/shared/utils/feedback-error';
import { showCrmMutationError } from '@/shared/utils/crm-mutation-error';
import React, { useCallback, useEffect, useId, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { CrmEmailSchema, INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR } from '@leadcrm/shared';
import { cn } from '@/lib/utils';
import { CatalogProductInterestSelect } from './product-interest-select';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import type { ProductInterestRecord } from '@leadcrm/shared';
import { productCategoriesForSelection } from './product-category-value';
import { normalizePhInput, toE164 } from '@/shared/utils/ph-phone';
import { getNameDigitError } from '@/shared/utils/name-digit-error';
const displayText = (value: unknown): string => Array.isArray(value) ? value.join(', ') || '—' : String(value ?? '') || '—';
const present = (value: unknown) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);

// ── InlineEditRows — click-to-edit About section ─────────────────────────────
export interface InlineRowDef {
  customEditorActions?: boolean;
  productRecords?: ProductInterestRecord[];
  alwaysVisible?: boolean;
  validate?: (value: string) => string | undefined;
  preserveWhitespace?: boolean;
  editorDisabled?: boolean;
  editorError?: string;
  editorFullWidth?: boolean;
  renderValue?: () => React.ReactNode;
  valueHref?: string;
  renderEditor?: (props: { values: string[]; onValuesChange: (values: string[]) => void; value: string; onChange: (value: string) => void; disabled: boolean; error: string; onSave: () => void; onCancel: () => void }) => React.ReactNode;
  technicalKey?: string;
  label: string;
  value: unknown;
  apiField?: string;
  required?: boolean;
  maxLength?: number;
  type?: 'text' | 'email' | 'tel' | 'url' | 'select' | 'textarea' | 'date' | 'products' | 'users' | 'accounts' | 'contacts' | 'leads';
  valueMode?: 'id' | 'name';
  displayValue?: unknown;
  productLabels?: Record<string, string>;
  showUncategorized?: boolean;
  options?: string[];
}

export interface InlineEditState { field: string | null; dirty: boolean; busy: boolean }

export function InlineEditRows({ rows, canEdit, onSave, disabled = false, onEditStateChange, lockWhileEditing = false, onEscape }: {
  rows: InlineRowDef[];
  canEdit: boolean;
  disabled?: boolean;
  lockWhileEditing?: boolean;
  onEditStateChange?: (state: InlineEditState) => void;
  onEscape?: () => void;
  onSave: (field: string, value: string | string[]) => Promise<void>;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string | string[]>('');
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [initialValue, setInitialValue] = useState<string | string[]>('');
  const [productCatalog, setProductCatalog] = useState<ProductInterestRecord[]>([]);
  const receiveProductCatalog = useCallback((products: ProductInterestRecord[]) => {
    setProductCatalog(previous => JSON.stringify(previous) === JSON.stringify(products) ? previous : products);
  }, []);
  const editingField = rows.find(row => (row.technicalKey ?? row.label) === editingKey)?.apiField ?? null;
  const errorId = useId();
  const dirty = editingKey !== null && JSON.stringify(initialValue) !== JSON.stringify(editValue);
  const nameDigitError = dirty ? getNameDigitError(editingField ?? undefined, editValue) : undefined;
  const inputError = nameDigitError ?? fieldError;
  useEffect(() => { onEditStateChange?.({ field: editingField, dirty, busy: isSaving }); }, [editingField, dirty, isSaving, onEditStateChange]);
  const blocked = isSaving || disabled;
  useEffect(() => { if (!canEdit) { setEditingKey(null); setEditValue(''); setFieldError(''); } }, [canEdit]);

  const startEdit = (label: string, value: unknown) => {
    if (blocked || lockWhileEditing && editingKey) return;
    const row = rows.find(row => (row.technicalKey ?? row.label) === label);
    if (row?.type === 'tel' && row.customEditorActions && value) value = toE164(normalizePhInput(String(value)));
    setFieldError('');
    setInitialValue(Array.isArray(value) ? value : String(value ?? ''));
    setEditingKey(label);
    setEditValue(Array.isArray(value) ? value : String(value ?? ''));
  };
  const cancelEdit = () => { if (blocked) return; setEditingKey(null); setEditValue(''); };
  const escapeEdit = (event: React.KeyboardEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (onEscape) onEscape();
    else cancelEdit();
  };
  const commitEdit = async (apiField: string) => {
    if (blocked || !canEdit || nameDigitError) return;
    if (!dirty && (apiField === 'firstName' || apiField === 'lastName')) { setEditingKey(null); return; }
    setFieldError('');
    const row = rows.find(row => row.apiField === apiField);
    if (row?.editorDisabled) return;
    if (row?.validate) {
      const error = row.validate(String(editValue));
      if (error) { setFieldError(error); return; }
    } else {
      if (row?.required && (typeof editValue !== 'string' || !editValue.trim())) { setFieldError(`${row.label} is required`); return; }
      if (row?.required && typeof editValue === 'string' && editValue.trim().length > (row.maxLength ?? 100)) { setFieldError(`Max ${row.maxLength ?? 100} characters`); return; }
    }
    if (rows.find(row => row.apiField === apiField)?.type === 'email') {
      const result = CrmEmailSchema.safeParse(editValue);
      if (!result.success) { setFieldError(result.error.issues[0].message); return; }
    }
    setIsSaving(true);
    try { await onSave(apiField, typeof editValue === 'string' && !row?.preserveWhitespace ? editValue.trim() : editValue); setEditingKey(null); }
    catch (error) {
      setFieldError(feedbackError(error, 'Unable to save this field. Please try again.'));
      if (error instanceof Error && error.message === INTERNAL_EMPLOYEE_CUSTOMER_EMAIL_ERROR) showCrmMutationError(error, 'Unable to save this field. Please try again.');
    }
    finally { setIsSaving(false); }
  };

  return (
    <dl className="divide-y divide-border/60">
      {rows.filter(({ value, displayValue, apiField, label, technicalKey, required, alwaysVisible, productRecords }) => productRecords || alwaysVisible || required || present(displayValue ?? value) || (canEdit && !!apiField) || editingKey === (technicalKey ?? label)).map(({ technicalKey, label, value, apiField, type, options, valueMode, displayValue, productLabels, showUncategorized, required, maxLength, renderEditor, renderValue, editorDisabled, editorError, editorFullWidth, valueHref, customEditorActions, productRecords }) => {
        const isEditing = canEdit && editingKey === (technicalKey ?? label);
        const editable = canEdit && !!apiField;
        return (
          <React.Fragment key={technicalKey ?? label}>
          {productRecords && <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2.5 text-xs">
            <dt className="text-muted-foreground">Product Category</dt><dd className="text-right [overflow-wrap:anywhere]" aria-live="polite">{productCategoriesForSelection(
              (isEditing ? editValue : value) as string[] ?? [],
              [...productRecords.map(retained => productCatalog.find(product => product.id === retained.id) ?? retained), ...productCatalog.filter(product => !productRecords.some(retained => valueMode === 'name' ? retained.name === product.name : retained.id === product.id))], valueMode)}</dd>
          </div>}
          <div className={cn('grid min-w-0 gap-3 px-3 py-2.5 text-xs', isEditing && editorFullWidth ? 'grid-cols-1' : required && !renderEditor ? 'grid-cols-[minmax(max-content,2fr)_minmax(0,3fr)]' : 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
            <dt className="text-muted-foreground self-start pt-0.5">{label}{(required || type === 'email' && editable) && <span className="text-red-500"> *</span>}</dt>
            <dd className="min-w-0">
              {isEditing && apiField ? (
                <div className="flex flex-col gap-1.5">
                  {renderEditor ? renderEditor({ values: Array.isArray(editValue) ? editValue : [], onValuesChange: next => { setEditValue(next); setFieldError(''); }, value: String(editValue), onChange: next => { setEditValue(next); setFieldError(''); }, disabled: blocked, error: fieldError, onSave: () => void commitEdit(apiField), onCancel: cancelEdit }) : type === 'products' ? <CatalogProductInterestSelect onCatalog={receiveProductCatalog} showUncategorized={showUncategorized} values={Array.isArray(editValue) ? editValue : []} onChange={setEditValue} valueMode={valueMode} labels={productLabels} disabled={blocked} /> : type === 'users' || type === 'accounts' ? <EntityCombobox entityType={type} multiple={false} disabled={blocked} value={String(editValue) || null} onChange={value => setEditValue(value || '')} /> : type === 'contacts' || type === 'leads' ? <EntityCombobox entityType={type} multiple disabled={blocked} values={Array.isArray(editValue) ? editValue : []} onMultiChange={setEditValue} /> : type === 'select' ? (
                    <select aria-label={label} disabled={blocked} value={Array.isArray(editValue) ? editValue.join(', ') : editValue} onChange={e => setEditValue(e.target.value)} autoFocus className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                      {options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : type === 'textarea' ? (
                    <Textarea placeholder={`Enter ${label.toLowerCase()}...`} aria-label={label} disabled={blocked} value={Array.isArray(editValue) ? editValue.join(', ') : editValue} onChange={e => setEditValue(e.target.value)} rows={3} autoFocus onKeyDown={e => { if (e.key === 'Escape') escapeEdit(e); }} className="w-full rounded-md border px-2 py-1 text-xs resize-none" />
                  ) : (
                    <Input placeholder={!type || type === 'text' || type === 'email' ? type === 'email' ? 'email@example.com' : `Enter ${label.toLowerCase()}...` : undefined} aria-label={label} disabled={blocked} type={type ?? 'text'} required={required || type === 'email'} aria-required={required || type === 'email'} aria-invalid={!!inputError} aria-describedby={!customEditorActions && inputError ? errorId : undefined} maxLength={type === 'email' ? 254 : required ? maxLength ?? 100 : undefined} value={Array.isArray(editValue) ? editValue.join(', ') : editValue} onChange={e => { setEditValue(e.target.value); if (apiField === 'firstName' || apiField === 'lastName') setFieldError(''); }} autoFocus onKeyDown={e => { if (e.key === 'Enter') void commitEdit(apiField); if (e.key === 'Escape') escapeEdit(e); }} className={cn("w-full rounded-md border px-2 py-1 text-xs", inputError ? "border-red-500" : "")} />
                  )}
                  {!customEditorActions && (inputError || editorError) && <p id={errorId} role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">{inputError || editorError}</p>}
                  {!customEditorActions && <div className="flex flex-wrap justify-end gap-1">
                    <button type="button" onClick={() => void commitEdit(apiField)} disabled={blocked || editorDisabled} className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors">{isSaving ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Saving…</> : 'Save'}</button>
                    <button type="button" onClick={cancelEdit} disabled={blocked} className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors">Cancel</button>
                  </div>}
                </div>
              ) : (
                <div className="min-w-0"><button type="button" disabled={!editable || blocked || lockWhileEditing && !!editingKey} aria-label={editable ? `Edit ${label}` : undefined}
                  className={cn('group flex w-full items-start justify-end gap-1.5 text-right [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default', editable && 'hover:text-primary hover:underline')}
                  onClick={() => startEdit(technicalKey ?? label, value)}>
                  <span className="min-w-0">{renderValue ? renderValue() : displayText(displayValue ?? value)}</span>{editable && <Pencil aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
                </button>{valueHref && <a className="mt-1 block text-right text-primary underline" href={valueHref}>Open file</a>}</div>
              )}
            </dd>
          </div>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

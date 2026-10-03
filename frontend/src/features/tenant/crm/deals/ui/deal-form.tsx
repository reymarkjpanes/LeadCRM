'use client';
import { ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { useProductInterests } from '@/shared/hooks/use-product-interests';


import React, { useEffect, useRef, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { useData } from '@/store/DataContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { DealAccountField } from './deal-account-field';
import { DealContactsField } from './deal-contacts-field';
import { DealLeadsField } from './deal-leads-field';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { AlertCircle, ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';
import type { Deal } from '@/store/types';

// ── Zod schemas mirroring backend CreateDealSchema / UpdateDealSchema ──────
// Backend: CreateDealSchema requires pipelineId, stageId, title
// Backend: UpdateDealSchema = CreateDealSchema.omit({ stageId, pipelineId }).partial()

const CreateDealFormSchema = z.object({
  pipelineId: z.string().min(1, 'Pipeline is required'),
  stageId: z.string().min(1, 'Stage is required'),
  title: z.string().min(1, 'Title is required').max(255, 'Max 255 characters'),
  value: z.number().finite().nonnegative('Must be zero or greater').max(999_999_999_999, 'Value exceeds maximum').optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  expectedCloseDate: z.string().optional(),
  leadSource: z.string().optional(),
  organizationId: z.string().optional(),
  assignedUserId: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
  leadIds: z.array(z.string()).optional(),
  industry: z.string().optional(),
  address: z.string().optional(),
  productInterests: z.array(z.string().uuid()).min(1, 'Select at least one Product Interest.').max(100),
});

const UpdateDealFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Max 255 characters'),
  value: z.number().finite().nonnegative('Must be zero or greater').max(999_999_999_999, 'Value exceeds maximum').optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  expectedCloseDate: z.string().optional(),
  leadSource: z.string().optional(),
  organizationId: z.string().optional(),
  assignedUserId: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
  leadIds: z.array(z.string()).optional(),
  industry: z.string().optional(),
  address: z.string().optional(),
  productInterests: z.array(z.string()).min(1, 'Select at least one Product Interest.').optional(),
});

export type CreateDealFormData = z.infer<typeof CreateDealFormSchema>;
export type UpdateDealFormData = z.infer<typeof UpdateDealFormSchema>;
type DealFormData = CreateDealFormData | UpdateDealFormData;

// ── Constants ──────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS: { value: 'LOW' | 'MEDIUM' | 'HIGH'; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];



const SOURCE_OPTIONS = [
  'Google Ads', 'Referral', 'Email Campaign', 'Website',
  'Social Media Advertisement', 'Direct Mail',
  'Content Marketing', 'Others',
];

// ── Props ──────────────────────────────────────────────────────────────────

export interface DealFormProps {
  mode: 'create' | 'edit';
  initialData?: Partial<Deal>;
  /** Pre-fill pipeline/stage when creating from a Kanban column */
  preselect?: { pipelineId?: string; stageId?: string };
  onSubmit: (data: DealFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export interface DealFormSheetProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  initialData?: Partial<Deal>;
  preselect?: { pipelineId?: string; stageId?: string };
  onSubmit: (data: DealFormData) => Promise<void>;
  isLoading?: boolean;
}

// ── Main Form Component ────────────────────────────────────────────────────

export function DealForm({
  mode,
  initialData,
  preselect,
  onSubmit,
  onCancel,
  isLoading = false,
}: DealFormProps): React.ReactElement {
  const { products, loading: productsLoading, error: productsError, refresh: refreshProducts } = useProductInterests();
  const { pipelines: allPipelines } = useData();
  const pipelines = useMemo(() => allPipelines.filter(p => p.name.trim().toLowerCase() === 'sales pipeline'), [allPipelines]);
  const canCreate = useHasPermission('deals.create');
  const canEdit = useHasPermission('deals.edit');
  const isCreateMode = mode === 'create';
  const hasPermission = isCreateMode ? canCreate : canEdit;

  // Build default values from initialData (edit) or preselect (create)
  const defaultValues = useMemo(() => {
    if (isCreateMode) {
      return {
        pipelineId: preselect?.pipelineId || pipelines[0]?.id || '',
        stageId: preselect?.stageId || (pipelines[0]?.stages.find(s => s.isDefault) ?? pipelines[0]?.stages.find(s => s.name.toLowerCase() === 'lead'))?.id || '',
        title: '',
        value: undefined,
        priority: 'MEDIUM' as const,
        expectedCloseDate: '',
        leadSource: '',
        organizationId: '',
        assignedUserId: '',
        contactIds: [] as string[],
        leadIds: [] as string[],
        industry: '',
        address: '',
        productInterests: [] as string[],
      };
    }
    // Edit mode — pre-fill from initialData
    return {
      title: initialData?.title || '',
      value: initialData?.value || undefined,
      priority: (normalizedPriority(initialData?.priority) || 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
      expectedCloseDate: initialData?.expectedCloseDate
        ? initialData.expectedCloseDate.split('T')[0]
        : '',
      leadSource: initialData?.leadSource || '',
      organizationId: initialData?.organizationId || '',
      assignedUserId: initialData?.assignedUserId || '',
      contactIds: initialData?.contactIds || [],
      leadIds: (initialData as any)?.leadIds || [],
      industry: initialData?.industry || '',
      address: initialData?.address || '',
      productInterests: initialData?.productInterestIds?.length ? initialData.productInterestIds : initialData?.productInterestId ? [initialData.productInterestId] : undefined,
    };
  }, [isCreateMode, initialData, preselect]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isValid, isSubmitting },
    setFocus,
  } = useForm<CreateDealFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RHF v7.82 + resolvers v5.4 type mismatch with optional number
    resolver: zodResolver(isCreateMode ? CreateDealFormSchema : UpdateDealFormSchema) as never,
    defaultValues: defaultValues as never,
    mode: 'onChange',
  });

  const fieldId = React.useId();
  const formRef = useRef<HTMLFormElement>(null);
  const selectedPipelineId = watch('pipelineId');
  const selectedProductIds = watch('productInterests') ?? [];
  const originalProductIds = initialData?.productInterestIds ?? (initialData?.productInterestId ? [initialData.productInterestId] : []);
  const productsUnchanged = selectedProductIds.length === originalProductIds.length && selectedProductIds.every(id => originalProductIds.includes(id));
  const selectedProducts = products.filter(product => selectedProductIds.includes(product.id));
  const productValue = selectedProducts.reduce((sum, p) => sum + Math.round(p.dealValue * 100), 0) / 100;

  // Get stages for selected pipeline (only relevant in create mode)
  const stagesForPipeline = useMemo(() => {
    const pipelineId = isCreateMode ? selectedPipelineId : initialData?.pipelineId;
    if (!pipelineId) return [];
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    return pipeline?.stages || [];
  }, [isCreateMode, selectedPipelineId, initialData?.pipelineId, pipelines]);

  // Reset stageId when pipeline changes (create mode only)
  useEffect(() => {
    if (isCreateMode && selectedPipelineId && !preselect?.stageId) {
      setValue('stageId', '');
    }
    // Only run when pipeline changes in create mode, not on initial mount with preselect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId]);

  // Scroll to first error on submit attempt
  useEffect(() => {
    const firstErrorKey = Object.keys(errors)[0];
    if (firstErrorKey && formRef.current) {
      const field = formRef.current.querySelector(`[name="${firstErrorKey}"]`);
      if (field) {
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try {
          setFocus(firstErrorKey as keyof CreateDealFormData);
        } catch { /* noop */ }
      }
    }
  }, [errors, setFocus]);

  const onFormSubmit = async (data: CreateDealFormData): Promise<void> => {
    // Clean optional empty strings before submission.
    // currency is always PHP — not user-editable, injected here for backend compatibility.
    const cleaned = {
      ...data,
      currency: 'PHP',
      value: undefined,
      productInterestIds: data.productInterests?.length ? data.productInterests : undefined,
      expectedCloseDate: data.expectedCloseDate
        ? data.expectedCloseDate.includes('T')
          ? data.expectedCloseDate
          : `${data.expectedCloseDate}T00:00:00.000Z`
        : undefined,
      leadSource: data.leadSource || undefined,
      organizationId: data.organizationId || undefined,
      assignedUserId: data.assignedUserId || undefined,
      contactIds: data.contactIds?.length ? data.contactIds : undefined,
      leadIds: (data as any).leadIds?.length ? (data as any).leadIds : undefined,
      industry: data.industry || undefined,
      address: data.address || undefined,
      productInterests: undefined,
    };
    await onSubmit(cleaned as DealFormData);
  };

  // ── Shared styling ────────────────────────────────────────────────────
  const inputCls =
    'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
  const selectCls =
    'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl pl-3.5 pr-8 py-2.5 text-sm text-slate-900 dark:text-white outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all [&>option]:bg-white dark:[&>option]:bg-slate-900';
  const errorInputCls = '!border-red-500 focus:!ring-red-500/20';

  const isSubmitDisabled = !isValid || isSubmitting || isLoading || !hasPermission || (isCreateMode && (productsLoading || !!productsError || !selectedProductIds.length));

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit(onFormSubmit)}
      className="flex flex-col h-full"
      noValidate
    >
      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Section 1: Pipeline & Stage (Create mode only — edit does not change pipeline/stage here) */}
        {isCreateMode && (
          <div className="space-y-4">
            <SectionHeader num={1} title="Pipeline & Stage" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><span className="block text-xs text-muted-foreground">Pipeline</span><p className="py-2 text-sm">Sales Pipeline</p><input type="hidden" {...register('pipelineId')} /></div>
              <FieldWrap label="Stage *" htmlFor={`${fieldId}-stageId`} error={errors.stageId?.message}>
                <div className="relative">
                  <select
                    {...register('stageId')}
                    id={`${fieldId}-stageId`}
                    aria-invalid={!!errors.stageId}
                    aria-describedby={errors.stageId ? `${fieldId}-stageId-error` : undefined}
                    className={cn(selectCls, errors.stageId && errorInputCls)}
                    disabled={!selectedPipelineId}
                  >
                    <option value="">{selectedPipelineId ? 'Select stage...' : 'Select pipeline first'}</option>
                    {stagesForPipeline.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
                </div>
              </FieldWrap>
            </div>
          </div>
        )}

        {/* Section 2: Deal Information */}
        <div className="space-y-4">
          <SectionHeader num={isCreateMode ? 2 : 1} title="Deal Information" />
          <FieldWrap label="Title *" htmlFor={`${fieldId}-title`} error={errors.title?.message}>
            <input
              {...register('title')}
              id={`${fieldId}-title`}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? `${fieldId}-title-error` : undefined}
              className={cn(inputCls, errors.title && errorInputCls)}
              placeholder="Enter deal title"
            />
          </FieldWrap>
          <FieldWrap error={errors.productInterests?.message || productsError} label="Product Interests" htmlFor={`${fieldId}-product-interest`}>
            <Controller
              name="productInterests"
              control={control}
              render={({ field }) => (
                <ProductInterestSelect products={products} disabled={productsLoading || isSubmitting || isLoading} id={`${fieldId}-product-interest`} values={field.value || []} onChange={field.onChange} />
              )}
            />
          </FieldWrap>
          {productsError && <Button type="button" variant="ghost" onClick={refreshProducts}>Retry products</Button>}
          <FieldWrap label="Value" htmlFor={`${fieldId}-value`} error={errors.value?.message}>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium select-none pointer-events-none">₱</span>
                <input id={`${fieldId}-value`} readOnly value={new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(!isCreateMode && productsUnchanged ? initialData?.value ?? 0 : productValue)} className={cn(inputCls, 'pl-9 bg-slate-50')} aria-describedby={`${fieldId}-value-help`} />
              </div>
              {isCreateMode && <p id={`${fieldId}-value-help`} className="text-xs text-muted-foreground">Uses the combined configured value of the selected products.</p>}
            </FieldWrap>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap label="Priority" htmlFor={`${fieldId}-priority`} error={errors.priority?.message}>
              <div className="relative">
                <select {...register('priority')}
                id={`${fieldId}-priority`}
                aria-invalid={!!errors.priority}
                aria-describedby={errors.priority ? `${fieldId}-priority-error` : undefined} className={selectCls}>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </FieldWrap>
            <FieldWrap htmlFor={`${fieldId}-expectedCloseDate`} error={errors.expectedCloseDate?.message} label="Expected Close Date">
              <input type="date" {...register('expectedCloseDate')}
                id={`${fieldId}-expectedCloseDate`}
                aria-invalid={!!errors.expectedCloseDate}
                aria-describedby={errors.expectedCloseDate ? `${fieldId}-expectedCloseDate-error` : undefined} className={inputCls} />
            </FieldWrap>
          </div>
        </div>

        {/* Section 3: Relationships */}
        <div className="space-y-4">
          <SectionHeader num={isCreateMode ? 3 : 2} title="Relationships" />
          <Controller
            name="organizationId"
            control={control}
            render={({ field }) => (
              <DealAccountField
                value={field.value || null}
                onChange={(id) => field.onChange(id || '')}
                error={errors.organizationId?.message}
              />
            )}
          />
          <Controller
            name="contactIds"
            control={control}
            render={({ field }) => (
              <DealContactsField
                values={field.value || []}
                onChange={(ids) => field.onChange(ids)}
                error={errors.contactIds?.message}
              />
            )}
          />
          <Controller
            name="leadIds"
            control={control}
            render={({ field }) => (
              <DealLeadsField
                values={field.value || []}
                onChange={(ids) => field.onChange(ids)}
              />
            )}
          />
          <FieldWrap label="Assigned User">
            <Controller
              name="assignedUserId"
              control={control}
              render={({ field }) => (
                <EntityCombobox
                  entityType="users"
                  multiple={false}
                  value={field.value || null}
                  onChange={(id) => field.onChange(id || '')}
                  placeholder="Search users..."
                  error={errors.assignedUserId?.message}
                />
              )}
            />
          </FieldWrap>
        </div>

        {/* Section 4: Additional Details */}
        <div className="space-y-4">
          <SectionHeader num={isCreateMode ? 4 : 3} title="Additional Details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap htmlFor={`${fieldId}-leadSource`} error={errors.leadSource?.message} label="Lead Source">
              <div className="relative">
                <select {...register('leadSource')}
                id={`${fieldId}-leadSource`}
                aria-invalid={!!errors.leadSource}
                aria-describedby={errors.leadSource ? `${fieldId}-leadSource-error` : undefined} className={selectCls}>
                  <option value="">Select source...</option>
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </FieldWrap>
            <FieldWrap htmlFor={`${fieldId}-industry`} error={errors.industry?.message} label="Industry">
              <input {...register('industry')}
                id={`${fieldId}-industry`}
                aria-invalid={!!errors.industry}
                aria-describedby={errors.industry ? `${fieldId}-industry-error` : undefined} className={inputCls} placeholder="e.g. Technology, Healthcare" />
            </FieldWrap>
          </div>
          <FieldWrap htmlFor={`${fieldId}-address`} error={errors.address?.message} label="Address">
            <textarea
              {...register('address')}
              id={`${fieldId}-address`}
              aria-invalid={!!errors.address}
              aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
              rows={2}
              className={cn(inputCls, 'resize-none')}
              placeholder="Enter address..."
            />
          </FieldWrap>

        </div>
      </div>

      {/* Sticky Footer */}
      <div className="shrink-0 px-6 py-4 border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-slate-900 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.08] border border-gray-200 dark:border-white/[0.08] rounded-xl transition-colors"
        >
          Cancel
        </button>
        {hasPermission && (
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className={cn(
              'px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-all shadow-lg shadow-blue-500/25',
              isSubmitDisabled
                ? 'bg-blue-400 cursor-not-allowed opacity-60'
                : 'bg-blue-600 hover:bg-blue-700 active:scale-95',
            )}
          >
            {isLoading || isSubmitting ? 'Saving...' : isCreateMode ? 'Create Deal' : 'Update Deal'}
          </button>
        )}
      </div>
    </form>
  );
}

// ── Backward-compat exports ────────────────────────────────────────────────
// Legacy callers that still use the old DealCreateForm interface.

interface LegacyDealCreateFormProps {
  onSave: (data: CreateDealFormData) => void;
  onCancel: () => void;
}

export function DealCreateForm({ onSave, onCancel }: LegacyDealCreateFormProps): React.ReactElement {
  const handleSubmit = async (data: DealFormData): Promise<void> => {
    onSave(data as CreateDealFormData);
  };
  return <DealForm mode="create" onSubmit={handleSubmit} onCancel={onCancel} />;
}

// ── Reusable Helpers ───────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: number; title: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-bold shrink-0">
        {num}
      </div>
      <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">{title}</h3>
      <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.06]" />
    </div>
  );
}

function FieldWrap({ label, error, htmlFor, children }: { label: string; error?: string; htmlFor?: string; children: React.ReactNode }): React.ReactElement {
  const isRequired = label.endsWith(' *');
  const displayText = isRequired ? label.slice(0, -2) : label;

  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
        <span>{displayText}{isRequired && <span className="text-red-500"> *</span>}</span>
      </label>
      {children}
      {error && (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-[11px] text-red-500 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

/** Normalize priority casing from the frontend Deal type (which allows display casing) */
function normalizedPriority(priority: string | undefined): 'LOW' | 'MEDIUM' | 'HIGH' | undefined {
  if (!priority) return undefined;
  const upper = priority.toUpperCase();
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH') return upper;
  return undefined;
}

// ── Sheet Wrapper ──────────────────────────────────────────────────────────

export function DealFormSheet({
  isOpen,
  onClose,
  mode,
  initialData,
  preselect,
  onSubmit,
  isLoading,
}: DealFormSheetProps): React.ReactElement {
  const title = mode === 'create' ? 'New Deal' : 'Edit Deal';
  const subtitle = mode === 'create'
    ? 'Complete the deal details below.'
    : 'Update the deal information.';

  return (
    <SlidingDrawer isOpen={isOpen} onClose={onClose} title={title} subtitle={subtitle}>
      <DealForm
        mode={mode}
        initialData={initialData}
        preselect={preselect}
        onSubmit={onSubmit}
        onCancel={onClose}
        isLoading={isLoading}
      />
    </SlidingDrawer>
  );
}

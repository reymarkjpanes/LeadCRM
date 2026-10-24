'use client';
import { DealAddressSourceSchema, dealAddressKey, resolveDealAddress, dealAddressMessage, dealCustomerAddressMessage } from '@leadcrm/shared';
import { useDealAddressOptions } from '@/shared/hooks/use-deal-address-options';
import { showCrmMutationError } from '@/shared/utils/crm-mutation-error';
import { LEAD_SOURCES, defaultFieldGroupId, type DealAssociationChange } from '@leadcrm/shared';
import { ConfiguredFormLayout } from '@/shared/components/crm/configured-form-layout';
import { useRecordCustomFields, CustomFieldGroup, CustomFieldExtraGroups } from '@/shared/components/crm/record-custom-fields';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelInputClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';
import { ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';


import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { useData } from '@/store/DataContext';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';
import { Label } from '@/shared/components/ui/label';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';
import type { Deal } from '@/store/types';

const associationFields = {
  associationType: z.enum(['', 'lead', 'contact']).optional(),
  associationId: z.string().optional(),
  associationChanged: z.boolean().optional(),
};
function validateAssociation(data: { associationType?: string; associationId?: string }, ctx: z.RefinementCtx) {
  if (!data.associationType) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['associationType'], message: 'Choose Lead or Contact.' });
  if (data.associationType && !data.associationId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['associationId'], message: `Select a ${data.associationType === 'lead' ? 'Lead' : 'Contact'}.` });
}

// ── Zod schemas mirroring backend CreateDealSchema / UpdateDealSchema ──────
// Backend: CreateDealSchema requires pipelineId, stageId, title
// Backend: UpdateDealSchema = CreateDealSchema.omit({ stageId, pipelineId }).partial()

const CreateDealFormSchema = z.object({
  ...associationFields,
  addressSource: DealAddressSourceSchema.nullable().optional(),
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
  address: z.string().max(2000, 'Max 2000 characters').optional(),
  productInterests: z.array(z.string().uuid()).min(1, 'Select at least one Product Interest.').max(100),
}).superRefine(validateAssociation);

const UpdateDealFormSchema = z.object({
  ...associationFields,
  addressSource: DealAddressSourceSchema.nullable().optional(),
  title: z.string().min(1, 'Title is required').max(255, 'Max 255 characters'),
  value: z.number().finite().nonnegative('Must be zero or greater').max(999_999_999_999, 'Value exceeds maximum').optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  expectedCloseDate: z.string().optional(),
  leadSource: z.string().optional(),
  organizationId: z.string().optional(),
  assignedUserId: z.string().optional(),
  contactIds: z.array(z.string()).optional(),
  leadIds: z.array(z.string()).optional(),
  address: z.string().max(2000, 'Max 2000 characters').optional(),
  productInterests: z.array(z.string()).min(1, 'Select at least one Product Interest.').optional(),
}).superRefine((data, ctx) => { if (data.associationChanged) validateAssociation(data, ctx); });

export type CreateDealFormData = z.infer<typeof CreateDealFormSchema> & { customFieldValues?: import('@leadcrm/shared').ClosingValues; primaryAssociation?: DealAssociationChange }
export type UpdateDealFormData = z.infer<typeof UpdateDealFormSchema> & { customFieldValues?: import('@leadcrm/shared').ClosingValues; primaryAssociation?: DealAssociationChange }
type DealFormData = CreateDealFormData | UpdateDealFormData;

// ── Constants ──────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS: { value: 'LOW' | 'MEDIUM' | 'HIGH'; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];



const SOURCE_OPTIONS = LEAD_SOURCES;

// ── Props ──────────────────────────────────────────────────────────────────

export interface DealFormProps {
  mode: 'create' | 'edit';
  initialData?: Partial<Deal>;
  /** Pre-fill pipeline/stage when creating from a Kanban column */
  preselect?: { pipelineId?: string; stageId?: string; leadId?: string; contactId?: string };
  onSubmit: (data: DealFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export interface DealFormSheetProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  initialData?: Partial<Deal>;
  preselect?: { pipelineId?: string; stageId?: string; leadId?: string; contactId?: string };
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
  const customFields = useRecordCustomFields('deals', initialData?.id);
  const { products, categories, loading: productsLoading, error: productsError, refresh: refreshProducts } = useProductInterests();
  const { pipelines: allPipelines } = useData();
  const pipelines = useMemo(() => allPipelines.filter(p => !p.isArchived), [allPipelines]);
  const canCreate = useHasPermission('deals.create');
  const canEdit = useHasPermission('deals.edit');
  const isCreateMode = mode === 'create';
  const [isSaving, setIsSaving] = useState(false);
  const recordAccess = useCrmRecordAccess('deals');
  const hasPermission = isCreateMode ? canCreate : canEdit && recordAccess.canMutate(initialData);

  const initialAssociation = useMemo(() => {
    const leadIds = initialData?.leadIds ?? (initialData?.leadId ? [initialData.leadId] : preselect?.leadId ? [preselect.leadId] : []);
    const contactIds = initialData?.contactIds ?? (initialData?.contactId ? [initialData.contactId] : preselect?.contactId ? [preselect.contactId] : []);
    if (leadIds.length + contactIds.length !== 1) return undefined;
    return leadIds.length ? { type: 'lead' as const, id: leadIds[0] } : { type: 'contact' as const, id: contactIds[0] };
  }, [initialData, preselect?.leadId, preselect?.contactId]);

  // Build default values from initialData (edit) or preselect (create)
  const defaultValues = useMemo(() => {
    if (isCreateMode) {
      const initialPipeline = pipelines.find(p => p.id === preselect?.pipelineId) ?? pipelines.find(p => p.name.trim().toLowerCase() === 'sales pipeline') ?? pipelines[0];
      return {
        associationType: initialAssociation?.type ?? '',
        associationId: initialAssociation?.id ?? '',
        associationChanged: false,
        pipelineId: initialPipeline?.id || '',
        stageId: initialPipeline?.stages.find(s => s.name.toLowerCase() === 'lead' && !s.isWon && !s.isLost)?.id || '',
        title: '',
        value: undefined,
        priority: 'MEDIUM' as const,
        expectedCloseDate: '',
        leadSource: '',
        organizationId: '',
        assignedUserId: '',
        contactIds: [] as string[],
        leadIds: [] as string[],
        address: '',
        addressSource: null,
        productInterests: [] as string[],
      };
    }
    // Edit mode — only a single relationship proves an unambiguous primary.
    return {
      associationType: initialAssociation?.type ?? '',
      associationId: initialAssociation?.id ?? '',
      associationChanged: false,
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
      address: initialData?.address || '',
      addressSource: initialData?.addressSource ?? null,
      productInterests: initialData?.productInterestIds?.length ? initialData.productInterestIds : initialData?.productInterestId ? [initialData.productInterestId] : undefined,
    };
  }, [isCreateMode, initialData, preselect, pipelines, initialAssociation]);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isValid, isSubmitting: isValidatingSubmission, isDirty, touchedFields },
    setFocus,
    setError,
  } = useForm<CreateDealFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RHF v7.82 + resolvers v5.4 type mismatch with optional number
    resolver: zodResolver(isCreateMode ? CreateDealFormSchema : UpdateDealFormSchema) as never,
    defaultValues: defaultValues as never,
    mode: 'onChange',
  });
  const isSubmitting = isValidatingSubmission || isSaving;
  const requestClose = usePanelDraft({ dirty: isDirty || customFields.dirty || !!touchedFields.addressSource, busy: isSubmitting || isLoading || customFields.uploadCount > 0 });

  const [submitError, setSubmitError] = useState('');
  const submitting = useRef(false);
  const fieldId = React.useId();
  const formRef = useRef<HTMLFormElement>(null);
  const associationType = watch('associationType');
  const associationId = watch('associationId');
  const addressSource = watch('addressSource');
  const addressOptions = useDealAddressOptions({ dealId: initialData?.id, accountId: initialData?.accountId ?? initialData?.organizationId, association: associationType && associationId ? { type: associationType, id: associationId } : undefined, previous: initialAssociation, changed: watch('associationChanged') });
  const unavailableSavedSource = !isCreateMode && !touchedFields.addressSource && initialData?.addressContext?.customerStatus === 'unavailable';
  const addressContext = resolveDealAddress(watch('address'), addressSource, addressOptions.data ?? initialData?.addressContext?.options ?? []);
  const selectedPipelineId = watch('pipelineId');
  const selectedProductIds = watch('productInterests') ?? [];
  const selectedProducts = products.filter(product => selectedProductIds.includes(product.id));

  useEffect(() => {
    if (isCreateMode && !selectedPipelineId && pipelines[0]) setValue('pipelineId', pipelines[0].id, { shouldValidate: true });
  }, [isCreateMode, selectedPipelineId, pipelines, setValue]);

  // Reset stageId when pipeline changes (create mode only)
  useEffect(() => {
    if (isCreateMode && selectedPipelineId) {
      setValue('stageId', pipelines.find(p => p.id === selectedPipelineId)?.stages.find(s => s.name.toLowerCase() === 'lead' && !s.isWon && !s.isLost)?.id || '', { shouldValidate: true });
    }
  }, [isCreateMode, selectedPipelineId, pipelines, setValue]);

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
    if (!hasPermission) return;
    if (!customFields.validate()) return;
    if (data.addressSource && (isCreateMode || touchedFields.addressSource) && !addressContext.options.some(option => dealAddressKey(option) === dealAddressKey(data.addressSource!))) {
      setError('addressSource', { message: 'Choose an available linked customer address or return to Automatic.' }); return;
    }
    // Clean optional empty strings before submission.
    // currency is always PHP — not user-editable, injected here for backend compatibility.
    const { associationType, associationId, associationChanged, organizationId: _account, assignedUserId: _agent, leadIds: _leads, contactIds: _contacts, ...values } = data;
    const cleaned = {
      customFieldValues: customFields.payload(),
      ...values,
      addressSource: isCreateMode || touchedFields.addressSource ? data.addressSource : undefined,
      currency: 'PHP',
      value: undefined,
      productInterestIds: data.productInterests?.length ? data.productInterests : undefined,
      expectedCloseDate: data.expectedCloseDate
        ? data.expectedCloseDate.includes('T')
          ? data.expectedCloseDate
          : `${data.expectedCloseDate}T00:00:00.000Z`
        : isCreateMode ? undefined : '',
      leadSource: isCreateMode ? data.leadSource || undefined : data.leadSource,
      ...(isCreateMode ? {
        leadIds: associationType === 'lead' ? [associationId!] : undefined,
        contactIds: associationType === 'contact' ? [associationId!] : undefined,
      } : associationChanged ? { primaryAssociation: { type: associationType as 'lead' | 'contact', id: associationId!, previous: initialAssociation } } : {}),
      address: isCreateMode ? data.address || undefined : data.address,
      productInterests: undefined,
    };
    if (submitting.current) return;
    submitting.current = true; setSubmitError('');
    setIsSaving(true);
    try { await onSubmit(cleaned as DealFormData); }
    catch (error) { if (error instanceof Error && error.message.startsWith('Customer Address:')) setError('addressSource', { type: 'server', message: error.message }); showCrmMutationError(error, 'Unable to save Deal.'); setSubmitError(error instanceof Error ? error.message : 'Unable to save. Retry this submission.'); }
    finally { submitting.current = false; setIsSaving(false); }
  };

  // ── Shared styling ────────────────────────────────────────────────────
  const inputCls = panelInputClass;
  const selectCls = panelInputClass + ' appearance-none pr-8 cursor-pointer';
  const errorInputCls = '!border-red-500 focus:!ring-red-500/20';

  const isSubmitDisabled = !isValid || isSubmitting || isLoading || !hasPermission || (isCreateMode && (productsLoading || !!productsError || !selectedProductIds.length));

  const relationshipFields = <div className="min-w-0 space-y-4">
    <FieldWrap label="Associate Deal To *" htmlFor={`${fieldId}-association-type`} error={errors.associationType?.message}>
      <Controller name="associationType" control={control} render={({ field }) => <div className="relative">
        <select {...field} value={field.value ?? ''} id={`${fieldId}-association-type`} aria-required aria-invalid={!!errors.associationType} aria-describedby={errors.associationType ? `${fieldId}-association-type-error` : undefined} disabled={isSubmitting || isLoading} className={cn(selectCls, errors.associationType && errorInputCls)} onChange={event => {
          field.onChange(event.target.value);
          setValue('associationId', '', { shouldDirty: true, shouldValidate: true });
          setValue('associationChanged', true, { shouldDirty: true, shouldValidate: true });
        }}>
          <option value="">Select Lead or Contact...</option><option value="lead">Lead</option><option value="contact">Contact</option>
        </select>
        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
      </div>} />
    </FieldWrap>
    {associationType && <FieldWrap label={`${associationType === 'lead' ? 'Lead' : 'Contact'} *`} htmlFor={`${fieldId}-association`} >
      <Controller name="associationId" control={control} render={({ field }) => <EntityCombobox key={associationType} id={`${fieldId}-association`} aria-required="true" entityType={associationType === 'lead' ? 'leads' : 'contacts'} multiple={false} value={field.value || null} onChange={id => {
        field.onChange(id || '');
        setValue('associationChanged', true, { shouldDirty: true, shouldValidate: true });
      }} placeholder={`Search ${associationType === 'lead' ? 'leads' : 'contacts'}...`} error={errors.associationId?.message} disabled={isSubmitting || isLoading} />} />
    </FieldWrap>}
    {!isCreateMode && !initialAssociation && <p className="text-xs text-muted-foreground">This Deal has no single Lead or Contact association. You can save unrelated edits without choosing one. Selecting a record here preserves existing relationships; manage additional links in Deal Details.</p>}
  </div>;

  return (
    <form
      ref={formRef}
      onSubmit={event => { if (submitting.current) event.preventDefault(); else void handleSubmit(onFormSubmit)(event); }}
      className="flex h-full min-h-0 flex-col"
      noValidate
    >
      {/* Scrollable Body */}
      <div className={panelBodyClass + " space-y-6"}>
        <ConfiguredFormLayout form={customFields} module="deals" groupContent={{ [defaultFieldGroupId('deals', 'Relationships')]: relationshipFields }}>
        {/* Section 1: Pipeline & Stage (Create mode only — edit does not change pipeline/stage here) */}
        {isCreateMode && (
          <div className="space-y-4">
            <SectionHeader num={1} title="Pipeline & Stage" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div data-crm-field-key="pipelineId"><span className="block text-xs text-muted-foreground">Pipeline</span><p className="py-2 text-sm">{pipelines.find(p => p.id === selectedPipelineId)?.name || 'Selected pipeline'}</p><input type="hidden" {...register('pipelineId')} /></div>
              <div data-crm-field-key="stageId"><span className="block text-xs text-muted-foreground">Starting Stage</span><p className="py-2 text-sm">Lead</p><input type="hidden" {...register('stageId')} />{errors.stageId && <p role="alert">{errors.stageId.message}</p>}</div>
            </div>
          </div>
        )}

        {/* Section 2: Deal Information */}
        <div className="space-y-4">
          <SectionHeader num={isCreateMode ? 2 : 1} title="Deal Information" />
          <FieldWrap fieldKey="title" label="Title *" htmlFor={`${fieldId}-title`} error={errors.title?.message}>
            <input
              {...register('title')}
              id={`${fieldId}-title`}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? `${fieldId}-title-error` : undefined}
              className={cn(inputCls, errors.title && errorInputCls)}
              placeholder="Enter deal title"
            />
          </FieldWrap>
          <FieldWrap fieldKey="productInterestIds" error={errors.productInterests?.message || productsError} label="Product Interests" htmlFor={`${fieldId}-product-interest`}>
            <Controller
              name="productInterests"
              control={control}
              render={({ field }) => (
                <ProductInterestSelect products={products} categories={categories} showUncategorized={false} disabled={!isCreateMode || productsLoading || isSubmitting || isLoading} id={`${fieldId}-product-interest`} values={field.value || []} onChange={field.onChange} />
              )}
            />
          {productsError && <Button type="button" variant="ghost" onClick={refreshProducts}>Retry products</Button>}
          {isCreateMode ? <div aria-live="polite" className="min-w-0 rounded-xl border border-border p-3 text-sm">
            <p className="font-semibold">{selectedProducts.length} {selectedProducts.length === 1 ? 'Deal' : 'Deals'} will be created</p>
            <ul className="mt-2 space-y-2">{selectedProducts.map(product => <li key={product.id} className="flex min-w-0 flex-wrap justify-between gap-2"><span className="min-w-0 [overflow-wrap:anywhere]">{product.name}</span><span>{new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(product.dealValue)}</span></li>)}</ul>
            <p className="mt-2 text-xs text-muted-foreground">Each Deal keeps its own Product value. Multiple Deal titles include the Product name.</p>
          </div> : <FieldWrap fieldKey="value" label="Value" htmlFor={`${fieldId}-value`}><input id={`${fieldId}-value`} readOnly value={new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(initialData?.value ?? 0)} className={inputCls} /></FieldWrap>}
          </FieldWrap>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="priority" label="Priority" htmlFor={`${fieldId}-priority`} error={errors.priority?.message}>
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
            <FieldWrap fieldKey="expectedCloseDate" htmlFor={`${fieldId}-expectedCloseDate`} error={errors.expectedCloseDate?.message} label="Expected Close Date">
              <input type="date" {...register('expectedCloseDate')}
                id={`${fieldId}-expectedCloseDate`}
                aria-invalid={!!errors.expectedCloseDate}
                aria-describedby={errors.expectedCloseDate ? `${fieldId}-expectedCloseDate-error` : undefined} className={inputCls} />
            </FieldWrap>
          </div>
          <CustomFieldGroup form={customFields} group="Deal Information" />
        </div>

        {/* Section 3: Relationships */}
        <div className="space-y-4">
          <SectionHeader num={isCreateMode ? 3 : 2} title="Relationships" />
          <CustomFieldGroup form={customFields} group="Relationships" />
        </div>

        {/* Section 4: Additional Details */}
        <div className="space-y-4">
          <SectionHeader num={isCreateMode ? 4 : 3} title="Additional Details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="leadSource" htmlFor={`${fieldId}-leadSource`} error={errors.leadSource?.message} label="Lead Source">
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
          </div>
          <FieldWrap fieldKey="address" htmlFor={`${fieldId}-address`} error={errors.address?.message} label="Deal Address (override)" beforeLabel={
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-address-source`}>Customer Address</Label>
              <select id={`${fieldId}-address-source`} aria-invalid={!!errors.addressSource} aria-describedby={errors.addressSource ? `${fieldId}-address-source-error` : undefined} className={selectCls} disabled={isSubmitting || isLoading || addressOptions.isInitialLoad} value={addressSource ? dealAddressKey(addressSource) : unavailableSavedSource ? '__unavailable__' : ''} onChange={event => {
                const option = addressContext.options.find(option => dealAddressKey(option) === event.target.value);
                setValue('addressSource', option ? { type: option.type, id: option.id } : null, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
              }}>
                <option value="">{!addressSource && !unavailableSavedSource && addressContext.options.length === 1 ? `Automatic: ${addressContext.options[0].label}` : 'Automatic / choose later'}</option>
                {unavailableSavedSource && !addressSource && <option value="__unavailable__" disabled>Selected address unavailable</option>}
                {addressSource && !addressContext.options.some(option => dealAddressKey(option) === dealAddressKey(addressSource)) && <option value={dealAddressKey(addressSource)}>Selected address unavailable</option>}
                {addressContext.options.map(option => <option key={dealAddressKey(option)} value={dealAddressKey(option)}>{option.label}</option>)}
              </select>
              {errors.addressSource?.message && <p id={`${fieldId}-address-source-error`} role="alert" className="text-xs text-destructive">{errors.addressSource.message}</p>}
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground" role="status">{addressOptions.isInitialLoad ? 'Loading customer addresses…' : addressOptions.error || dealCustomerAddressMessage(!touchedFields.addressSource && initialData?.addressContext?.customerStatus === 'unavailable' ? initialData.addressContext : addressContext)}</p>
              {addressOptions.error && <Button type="button" variant="ghost" size="sm" onClick={() => void addressOptions.refetch()}>Retry addresses</Button>}
              <p className="text-xs text-muted-foreground">Leave the override blank to use the linked customer address. Changes here affect only this Deal.</p>
            </div>
          }>

            <textarea
              {...register('address')}
              id={`${fieldId}-address`}
              aria-invalid={!!errors.address}
              aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
              rows={2}
              className={cn(inputCls, 'resize-none')}
              placeholder="Optional project or service location..."
            />
          </FieldWrap>

          <CustomFieldGroup form={customFields} group="Additional Details" />
        </div>
        <CustomFieldExtraGroups form={customFields} startNumber={isCreateMode ? 5 : 4} />
        </ConfiguredFormLayout>
      </div>

      {submitError && <p role="alert" className="px-4 py-2 text-sm text-destructive [overflow-wrap:anywhere]">{submitError}</p>}
      {/* Sticky Footer */}
      <div className={panelFooterClass + " justify-end"}>
        <Button
          variant="outline"
          type="button"
          onClick={requestClose ?? onCancel}
          disabled={isSubmitting || isLoading || customFields.uploadCount > 0}
          className={panelSecondaryActionClass}
        >
          Cancel
        </Button>
        {hasPermission && (
          <Button
            type="submit"
            disabled={customFields.blocked || isSubmitDisabled}
            className={cn(
              'h-[42px] px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-all shadow-lg shadow-primary/25',
              isSubmitDisabled
                ? 'bg-primary cursor-not-allowed opacity-60'
                : 'bg-primary hover:bg-primary/90 active:scale-95',
            )}
          >
            {isLoading || isSubmitting ? 'Saving...' : isCreateMode ? 'Create Deal' : 'Update Deal'}
          </Button>
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
  return <PanelSectionHeading number={num}>{title}</PanelSectionHeading>;
}

function FieldWrap({ label, fieldKey, error, htmlFor, children, beforeLabel }: { beforeLabel?: React.ReactNode; label: string; fieldKey?: string; error?: string; htmlFor?: string; children: React.ReactNode }): React.ReactElement {
  const isRequired = label.endsWith(' *');
  const displayText = isRequired ? label.slice(0, -2) : label;

  return (
    <div className={cn("min-w-0 space-y-1.5", (fieldKey === 'title' || fieldKey === 'productInterestIds' || fieldKey === 'address') && 'sm:col-span-2')}>
      {beforeLabel}
      <Label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
        <span>{displayText}{isRequired && <span className="text-red-500"> *</span>}</span>
      </Label>
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

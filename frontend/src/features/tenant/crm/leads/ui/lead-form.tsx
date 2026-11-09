'use client';
import { getNameDigitError } from '@/shared/utils/name-digit-error';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { cn } from '@/lib/utils';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';
import { applyCrmFieldErrors, isStaffEmailError, showCrmMutationError } from '@/shared/utils/crm-mutation-error';
import { useEmailAvailability } from '@/shared/hooks/use-email-availability';
import { usePhoneAvailability } from '@/shared/hooks/use-phone-availability';
import { LeadPhoneSchema, STAFF_PHONE_CONFLICT } from '@leadcrm/shared';

import { LeadFieldsSchema, SELECTABLE_LEAD_SOURCES, isDirectMailSource, LeadNameSchema, OptionalLeadSourceSchema } from '@leadcrm/shared';
import { OrganizationFields, useOrganizationForm } from '@/shared/components/crm/organization-fields';
import { ConfiguredFormLayout } from '@/shared/components/crm/configured-form-layout';
import { useRecordCustomFields, CustomFieldGroup, CustomFieldExtraGroups } from '@/shared/components/crm/record-custom-fields';
import { ProductInterestField, ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { CrmEmailSchema } from '@leadcrm/shared';

import { LeadStatusSchema, LEAD_STATUSES, normalizeCrmStatus } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';

import React, { useState, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lead } from '@/store/types';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { useScrollToError } from '@/shared/hooks/use-scroll-to-error';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';
import { useDuplicateCheck } from '@/shared/hooks/use-duplicate-check';
import { DuplicateWarning } from '@/shared/components/crm/duplicate-warning';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { AssignedAgentSelect } from '@/shared/components/crm/assigned-agent-select';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { toE164, validatePhMobile, normalizePhInput } from '@/shared/utils/ph-phone';
import {
  Mail,
  MapPin,
  AlertCircle,
  ChevronDown,
  Check,
} from 'lucide-react';
import { Textarea } from '@/shared/components/ui/textarea';
import { Input, textFieldClassName } from '@/shared/components/ui/input';

// Shared Lead constraints; controls use empty strings for unselected relationships.
const LeadFormSchema = z.object({
  firstName: LeadNameSchema,
  lastName: LeadNameSchema,
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(),
  companyName: LeadFieldsSchema.shape.companyName,
  status: LeadStatusSchema,
  source: OptionalLeadSourceSchema.optional(),
  sourceDetail: LeadFieldsSchema.shape.sourceDetail,
  accountId: z.string().optional(),
  assignedUserId: z.string().optional(),
  productInterest: LeadFieldsSchema.shape.productInterest,
  address: LeadFieldsSchema.shape.address,
});

type LeadFormData = z.infer<typeof LeadFormSchema>;



const STATUS_OPTIONS = LEAD_STATUSES.map(value => ({ value, label: value }));

const SOURCE_OPTIONS = SELECTABLE_LEAD_SOURCES;

interface LeadFormProps {
  initialData?: Lead;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead>) => void | Promise<void>;
}

interface AddLeadFormProps {
  prefill?: Partial<Lead>;
  initialData?: Lead;
  onSave: (data: Partial<Lead>) => void | Promise<void>;
  onCancel: () => void;
}

export function AddLeadForm({ initialData, prefill, onSave, onCancel }: AddLeadFormProps) {
  const recordAccess = useCrmRecordAccess('leads');
  const actionAllowed = useHasPermission(initialData ? 'leads.edit' : 'leads.create');
  const canSubmit = actionAllowed && !!recordAccess.policy && (!initialData || recordAccess.canMutate(initialData));
  const customFields = useRecordCustomFields('leads', initialData?.id);
  const organization = useOrganizationForm(initialData);
  const { users } = useData();
  const isEdit = !!initialData;
  const { user } = useAuth();
  const selfAssigned = !isEdit && recordAccess.policy?.assignmentRestricted === true;
  const currentAgentName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || '';
  const requestId = useRef<string | undefined>(undefined);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const statusVersion = useRef(initialData);
  useEffect(() => { statusVersion.current = initialData; }, [initialData?.id]);
  const { products: productRecords, categories, error: productError, loading: productsLoading } = useProductInterests();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting: isValidatingSubmission, isDirty },
    reset,
    setFocus,
    setError,
    clearErrors,
    setValue,
    control,
    watch,
  } = useForm<LeadFormData>({
    resolver: zodResolver(LeadFormSchema),
    mode: 'onBlur',
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      companyName: '',
      status: 'Inquiry',
      source: '',
      sourceDetail: '',
      accountId: '',
      assignedUserId: '',
      productInterest: [],
      address: '',
    },
  });
  const isSubmitting = isValidatingSubmission || isSaving;
  const requestClose = usePanelDraft({ dirty: isDirty || customFields.dirty || organization.dirty, busy: isSubmitting || customFields.uploadCount > 0 });

  useEffect(() => {
    setValue('companyName', organization.fields.companyName);
    setValue('accountId', organization.mode === 'existing' ? organization.accountId : '');
  }, [organization.fields.companyName, organization.mode, organization.accountId, setValue]);

  // Product interest state (for custom dropdown UX)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Philippine phone — local 10-digit number, no country code
  const [phoneLocal, setPhoneLocal] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Scroll to first error on submit via shared hook
  const fieldId = React.useId();
  const formRef = useRef<HTMLFormElement>(null);
  useScrollToError({ errors, formRef, setFocus });

  // Duplicate detection — check email/phone on change (only on create, not edit)
  const watchedEmail = watch('email');
  const emailCheck = useEmailAvailability(watchedEmail, 'leads', !isEdit && canSubmit);
  const emailError = emailCheck.error || errors.email?.message;
  const phoneCheck = usePhoneAvailability(watch('phone') ?? '', 'leads', canSubmit);
  const phoneError = phoneCheck.error || errors.phone?.message || (phoneTouched ? validatePhMobile(phoneLocal) : null);
  const watchedFirstName = watch('firstName');
  const watchedLastName = watch('lastName');
  const firstNameError = getNameDigitError('firstName', watchedFirstName) ?? errors.firstName?.message;
  const lastNameError = getNameDigitError('lastName', watchedLastName) ?? errors.lastName?.message;
  const { matches: duplicateMatches, isChecking: isDuplicateChecking, hasDuplicates, dismiss: dismissDuplicates } = useDuplicateCheck({
    email: watchedEmail || undefined,
    phone: phoneLocal ? toE164(phoneLocal) : undefined,
    firstName: watchedFirstName || undefined,
    lastName: watchedLastName || undefined,
    excludeId: initialData?.id,
    entityTypes: ['lead', 'contact'],
    enabled: !isEdit,
  });

  useEffect(() => {
    setSubmitError(null);
    if (initialData) {
      const phone = initialData.phone || '';
      setPhoneLocal(normalizePhInput(phone));

      setSelectedProducts(initialData.productInterestIds ?? []);
      reset({
        firstName: initialData.firstName || '',
        lastName: initialData.lastName || '',
        email: initialData.email || '',
        phone: normalizePhInput(phone) ? toE164(normalizePhInput(phone)) : '',
        companyName: initialData.companyName || '',
        status: normalizeCrmStatus(initialData.status),
        source: OptionalLeadSourceSchema.safeParse(initialData.leadSource || initialData.source || '').data ?? '',
        sourceDetail: initialData.sourceDetail ?? '',
        accountId: initialData.accountId || initialData.organizationId || '',
        assignedUserId: initialData.assignedUserId || '',
        productInterest: initialData.productInterestIds ?? [],
        address: initialData.address || '',
      });
    } else {
      setSelectedProducts([]);

      setPhoneLocal('');
      setPhoneTouched(false);
      reset({
        firstName: prefill?.firstName ?? '',
        lastName: prefill?.lastName ?? '',
        email: prefill?.email ?? '',
        phone: '',
        companyName: '',
        status: 'Inquiry',
        source: isDirectMailSource(prefill?.source) ? '' : OptionalLeadSourceSchema.safeParse(prefill?.source ?? '').data ?? '',
        sourceDetail: prefill?.sourceDetail ?? '',
        accountId: '',
        assignedUserId: '',
        productInterest: [],
        address: '',
      });
    }
  }, [initialData?.id, reset]); // Refreshes of the same record must not overwrite an unfinished draft.

  const onFormSubmit = async (data: LeadFormData): Promise<void> => {
    if (!canSubmit || saving.current) return;
    if (getNameDigitError('firstName', data.firstName) || getNameDigitError('lastName', data.lastName)) return;
    if (!phoneCheck.confirm(data.phone ?? '')) return;
    if (!isEdit && !emailCheck.confirm(data.email)) return;
    setPhoneTouched(true);
    if (validatePhMobile(phoneLocal) || !customFields.validate() || !organization.validate()) return;
    // Build phone in E.164 format from local 10-digit number
    const fullPhone = phoneLocal ? toE164(phoneLocal) : '';

    const productInterest = selectedProducts;
    if (productsLoading || productError) return;
    if (!isEdit) requestId.current ??= crypto.randomUUID();
    // Build payload matching backend CreateContactSchema field names exactly.
    // No phantom fields — adapter handles any remaining mapping.
    const payload: Partial<Lead> = {

      customFieldValues: customFields.payload(),
      ...(!isEdit ? { requestId: requestId.current } : {}),
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || undefined,
      phone: fullPhone,
      ...organization.payload(),
      status: isEdit && data.status === normalizeCrmStatus(statusVersion.current?.status) ? undefined : data.status || 'Inquiry',
      ...(isEdit && data.status !== normalizeCrmStatus(statusVersion.current?.status) ? { expectedUpdatedAt: statusVersion.current?.updatedAt } : {}),
      ...(!isDirectMailSource(data.source) && (data.source || !initialData || OptionalLeadSourceSchema.safeParse(initialData.leadSource || initialData.source || '').success) ? {
        source: data.source ?? '', sourceDetail: data.source === 'Others' ? data.sourceDetail?.trim() ?? '' : '',
      } : {}),
      assignedUserId: selfAssigned ? recordAccess.policy?.userId : data.assignedUserId || (isEdit ? '' : undefined),
      productInterest: productInterest,
      address: data.address?.trim() ?? '',
    };

    setSubmitError(null);
    saving.current = true;
    setIsSaving(true);
    try { await onSave(payload); }
    catch (error: unknown) {
      if ((error as { fieldErrors?: { phone?: string[] } }).fieldErrors?.phone?.includes(STAFF_PHONE_CONFLICT)) {
        phoneCheck.reject(); setError('phone', { type: 'server', message: STAFF_PHONE_CONFLICT }); setSubmitError(null); return;
      }
      if (!isEdit && isStaffEmailError(error)) {
        emailCheck.reject('STAFF_EMAIL_NOT_ALLOWED');
        setSubmitError(null);
        return;
      }
      applyCrmFieldErrors(error, setError, ['firstName', 'lastName', 'email', 'phone', 'status', 'source', 'assignedUserId', 'address']);
      organization.applyServerErrors(error);
      showCrmMutationError(error, 'Unable to save Lead.');
      setSubmitError(error instanceof Error ? error.message : 'Unable to save lead. Please try again.');
    } finally { saving.current = false; setIsSaving(false); }
  };

  // Shared field classes
  const inputCls = cn(textFieldClassName, "w-full border rounded-xl px-3.5 py-2.5 text-sm transition-all");
  const selectCls = 'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl pl-3.5 pr-8 py-2.5 text-sm text-slate-900 dark:text-white outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all [&>option]:bg-white dark:[&>option]:bg-slate-900';
  const errorInputCls = '!border-red-500 focus:!ring-red-500/20';

  return (
    <form ref={formRef} onSubmit={event => { if (saving.current) event.preventDefault(); else void handleSubmit(onFormSubmit)(event); }} className="flex flex-col h-full" noValidate>
      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        <ConfiguredFormLayout form={customFields} module="leads">
        {/* Section 1: Basic Information */}
        <div className="space-y-4">
          <SectionHeader num={1} title="Basic Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="firstName" label="First Name *" htmlFor={`${fieldId}-firstName`} error={firstNameError}>
              <Input
                {...register('firstName')} maxLength={100} required aria-required="true"
                id={`${fieldId}-firstName`}
                aria-invalid={!!firstNameError}
                aria-describedby={firstNameError ? `${fieldId}-firstName-error` : undefined}
                className={`${inputCls}${firstNameError ? `  ${errorInputCls}` : ''}`}
                placeholder="Enter first name"
              />
            </FieldWrap>
            <FieldWrap fieldKey="lastName" label="Last Name *" htmlFor={`${fieldId}-lastName`} error={lastNameError}>
              <Input
                {...register('lastName')} maxLength={100} required aria-required="true"
                id={`${fieldId}-lastName`}
                aria-invalid={!!lastNameError}
                aria-describedby={lastNameError ? `${fieldId}-lastName-error` : undefined}
                className={`${inputCls}${lastNameError ? `  ${errorInputCls}` : ''}`}
                placeholder="Enter last name"
              />
            </FieldWrap>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="email" label="Email *" htmlFor={`${fieldId}-email`} error={emailError}>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <Input
                  type="email"
                  {...register('email', !isEdit ? { onChange: () => clearErrors('email'), onBlur: emailCheck.retry } : {})} required aria-required="true" maxLength={254}
                  id={`${fieldId}-email`}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? `${fieldId}-email-error` : undefined}
                  className={`${inputCls} pl-9${!isEdit ? ' pr-10' : ''}${emailError ? `  ${errorInputCls}` : ''}`}
                  placeholder="email@example.com"
                />
                {emailCheck.available && !emailError && <Check size={16} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400" />}
              </div>
            </FieldWrap>
            <FieldWrap fieldKey="phone" label="Phone" htmlFor={`${fieldId}-phone`}>
              <PhilippinePhoneInput
                id={`${fieldId}-phone`}
                value={phoneLocal}
                onBlur={phoneCheck.retry}
                onChange={(v) => { setPhoneLocal(v); setPhoneTouched(true); clearErrors('phone'); setValue('phone', v ? toE164(v) : '', { shouldDirty: true, shouldValidate: true }); }}
                error={phoneError}
              />
            </FieldWrap>
          </div>
          <CustomFieldGroup form={customFields} group="Basic Information" />
        </div>

        {/* Duplicate Detection Warning */}
        {hasDuplicates && (
          <DuplicateWarning
            matches={duplicateMatches}
            isChecking={isDuplicateChecking}
            onDismiss={dismissDuplicates}
          />
        )}

        {/* Section 2: Status & Interest */}
        <div className="space-y-4">
          <SectionHeader num={2} title="Status & Interest" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="status" htmlFor={`${fieldId}-status`} error={errors.status?.message} label="Status">
              {!initialData ? <Input id={`${fieldId}-status`} value="Inquiry" readOnly className={selectCls} /> : <div className="relative">
                <select
                  {...register('status')}
                  id={`${fieldId}-status`}
                  aria-invalid={!!errors.status}
                  aria-describedby={errors.status ? `${fieldId}-status-error` : undefined}
                  className={selectCls}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} disabled={opt.value !== normalizeCrmStatus(initialData.status) && (initialData.statusEditOptions ? !initialData.statusEditOptions.includes(opt.value) : normalizeCrmStatus(initialData.status) === 'Cancelled' ? opt.value !== 'Inquiry' : normalizeCrmStatus(initialData.status) === 'Closed Deal' ? opt.value !== 'Cancelled' : opt.value === 'Closed Deal')}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>}
            </FieldWrap>
            <ProductInterestField fieldKey="productInterestIds" label="Product Interest" error={productError || errors.productInterest?.message}>
              <ProductInterestSelect products={productRecords} categories={categories} showUncategorized={false} values={selectedProducts} onChange={values => { setSelectedProducts(values); setValue('productInterest', values, { shouldDirty: true }); }} disabled={productsLoading || !!productError} labels={Object.fromEntries((initialData?.productInterestIds ?? []).map((id: string, i: number) => [id, initialData?.productInterests?.[i] ?? "Unavailable product"]))} />
            </ProductInterestField>
          </div>
          <CustomFieldGroup form={customFields} group="Status & Interest" />
        </div>

        {/* Section 3: Organization */}
        <div className="space-y-4">
          <SectionHeader num={3} title="Organization" />
          <div data-crm-field-key="companyName" data-crm-secondary-field-key="accountId" className="sm:col-span-2"><OrganizationFields draft={organization} disabled={isSubmitting} companyLabel={customFields.layout?.fields.companyName?.label ?? 'Company Name'} showCompany={customFields.layout?.fields.companyName?.visibleInForm !== false} showAccount={customFields.layout?.fields.accountId?.visibleInForm !== false} /></div>
          <CustomFieldGroup form={customFields} group="Organization" />
        </div>

        {/* Section 4: Additional Information */}
        <div className="space-y-4">
          <SectionHeader num={4} title="Additional Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="source" htmlFor={`${fieldId}-source`} error={errors.source?.message} label="Lead Source">
              <div className="relative">
                <select
                  {...register('source')}
                  id={`${fieldId}-source`}
                  aria-invalid={!!errors.source}
                  aria-describedby={errors.source ? `${fieldId}-source-error` : undefined}
                  className={selectCls}
                >
                  <option value="">Select source...</option>
                  {isDirectMailSource(initialData?.leadSource || initialData?.source) && <option value={initialData?.leadSource || initialData?.source} disabled>Direct Mail (historical)</option>}
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
              {watch('source') === 'Others' && <div className="mt-3"><label className="block text-sm font-medium" htmlFor={`${fieldId}-source-detail`}>Source detail</label><input id={`${fieldId}-source-detail`} {...register('sourceDetail')} maxLength={200} list={`${fieldId}-source-options`} className={selectCls} placeholder="Call, SMS, event, or another source" /><datalist id={`${fieldId}-source-options`}><option value="Call" /><option value="SMS" /></datalist><p className="mt-1 text-xs text-muted-foreground">Calls and SMS are entered by staff after receiving the inquiry.</p></div>}
            </FieldWrap>
            <FieldWrap fieldKey="assignedUserId" htmlFor={`${fieldId}-assignedUserId`} error={errors.assignedUserId?.message} label="Assigned Agent">
              {selfAssigned ? <Input id={`${fieldId}-assignedUserId`} value={currentAgentName} readOnly className={selectCls} /> : (
              <Controller
                name="assignedUserId"
                control={control}
                render={({ field }) => (
                  <AssignedAgentSelect
                    modules={isEdit ? ['leads'] : ['leads', 'deals']}
                    id={`${fieldId}-assignedUserId`}
                    value={field.value ?? ''}
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    users={recordAccess.policy?.assignmentRestricted && !(initialData && recordAccess.canReassignRecord?.(initialData)) ? users.filter(user => user.id === recordAccess.policy?.userId) : users} disabled={!recordAccess.policy || (!!initialData && !(recordAccess.canReassignRecord?.(initialData) ?? recordAccess.canReassign))}
                    placeholder={isEdit ? 'Unassigned' : 'Assign automatically'}
                    className={selectCls}
                    invalid={!!errors.assignedUserId}
                    describedBy={errors.assignedUserId ? `${fieldId}-assignedUserId-error` : undefined}
                  />
                )}
              />
              )}
            </FieldWrap>
          </div>
          <FieldWrap fieldKey="address" htmlFor={`${fieldId}-address`} error={errors.address?.message} label="Lead Address">
            <div className="relative">
              <MapPin className="absolute left-3.5 top-3 text-slate-400" size={14} />
              <Textarea
                {...register('address')} maxLength={2000}
                id={`${fieldId}-address`}
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
                rows={3}
                className="w-full pl-9 pr-4 border rounded-xl py-2.5 text-sm transition-all resize-none overflow-hidden"
                placeholder="123 Main St, Apt 4B, City, State, Zip Code"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${target.scrollHeight + 2}px`;
                }}
              />
            </div>
          </FieldWrap>
          <CustomFieldGroup form={customFields} group="Additional Information" />
        </div>
        <CustomFieldExtraGroups form={customFields} startNumber={5} />
        </ConfiguredFormLayout>

      </div>{/* end scrollable body */}

      {submitError && <p role="alert" className="px-6 py-3 text-sm text-red-700 dark:text-red-400">{submitError}</p>}
      {/* Sticky Footer */}
      <div className="shrink-0 px-6 py-4 border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-slate-900 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={requestClose ?? onCancel}
          disabled={isSubmitting}
          className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.08] border border-gray-200 dark:border-white/[0.08] rounded-xl transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting || !canSubmit || emailCheck.blocked || phoneCheck.blocked || customFields.blocked || productsLoading || !!productError}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-[var(--primary-hover)] active:scale-95 rounded-xl transition-all shadow-lg shadow-primary/25"
        >
          {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Lead'}
        </button>
      </div>
    </form>
  );
}

// ── Small reusable helpers ─────────────────────────────────────────────────────

function SectionHeader({ title }: { num?: number; title: string }): React.ReactElement {
  return (
    <div className="flex min-h-6 items-center gap-3">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">{title}</h3>
      <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.06]" />
    </div>
  );
}

function FieldWrap({ label, fieldKey, error, htmlFor, children, beforeLabel }: { beforeLabel?: React.ReactNode; label: string; fieldKey?: string; error?: string; htmlFor?: string; children: React.ReactNode }): React.ReactElement {
  const isRequired = label.endsWith(' *');
  const displayText = isRequired ? label.slice(0, -2) : label;

  return (
    <div className={`min-w-0 space-y-1.5 ${fieldKey === 'status' ? 'sm:col-span-2' : ''}`}>
      {beforeLabel}
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

// ── Sheet wrapper ──────────────────────────────────────────────────────────────

export function LeadFormSheet({ initialData, isOpen, onClose, onSave }: LeadFormProps): React.ReactElement {
  return (
    <SlidingDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? 'Edit Lead' : 'New Lead'}
      subtitle="Complete the lead details below."
    >
      <AddLeadForm initialData={initialData} onSave={onSave} onCancel={onClose} />
    </SlidingDrawer>
  );
}

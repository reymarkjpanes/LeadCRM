'use client';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';
import { applyCrmFieldErrors } from '@/shared/utils/crm-mutation-error';

import { LeadFieldsSchema, LEAD_SOURCES, LeadNameSchema, OptionalLeadSourceSchema } from '@leadcrm/shared';
import { OrganizationFields, useOrganizationForm } from '@/shared/components/crm/organization-fields';
import { ConfiguredFormLayout } from '@/shared/components/crm/configured-form-layout';
import { useRecordCustomFields, CustomFieldGroup, CustomFieldExtraGroups } from '@/shared/components/crm/record-custom-fields';
import { ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
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
} from 'lucide-react';

// Shared Lead constraints; controls use empty strings for unselected relationships.
const LeadFormSchema = z.object({
  firstName: LeadNameSchema,
  lastName: LeadNameSchema,
  email: CrmEmailSchema,
  phone: z.string().optional(),
  companyName: LeadFieldsSchema.shape.companyName,
  status: LeadStatusSchema,
  source: OptionalLeadSourceSchema.optional(),
  accountId: z.string().optional(),
  assignedUserId: z.string().optional(),
  productInterest: LeadFieldsSchema.shape.productInterest,
  address: LeadFieldsSchema.shape.address,
});

type LeadFormData = z.infer<typeof LeadFormSchema>;



const STATUS_OPTIONS = LEAD_STATUSES.map(value => ({ value, label: value }));

const SOURCE_OPTIONS = LEAD_SOURCES;

interface LeadFormProps {
  initialData?: Lead;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead>) => void | Promise<void>;
}

interface AddLeadFormProps {
  initialData?: Lead;
  onSave: (data: Partial<Lead>) => void | Promise<void>;
  onCancel: () => void;
}

export function AddLeadForm({ initialData, onSave, onCancel }: AddLeadFormProps) {
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
  const watchedFirstName = watch('firstName');
  const watchedLastName = watch('lastName');
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
        phone: phone,
        companyName: initialData.companyName || '',
        status: normalizeCrmStatus(initialData.status),
        source: OptionalLeadSourceSchema.safeParse(initialData.leadSource || initialData.source || '').data ?? '',
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
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        companyName: '',
        status: 'Inquiry',
        source: '',
        accountId: '',
        assignedUserId: '',
        productInterest: [],
        address: '',
      });
    }
  }, [initialData?.id, reset]); // Refreshes of the same record must not overwrite an unfinished draft.

  const onFormSubmit = async (data: LeadFormData): Promise<void> => {
    if (!canSubmit || saving.current) return;
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
      ...((data.source || !initialData || OptionalLeadSourceSchema.safeParse(initialData.leadSource || initialData.source || '').success) ? { source: data.source ?? '' } : {}),
      assignedUserId: selfAssigned ? recordAccess.policy?.userId : data.assignedUserId || (isEdit ? '' : undefined),
      productInterest: productInterest,
      address: data.address?.trim() ?? '',
    };

    setSubmitError(null);
    saving.current = true;
    setIsSaving(true);
    try { await onSave(payload); }
    catch (error: unknown) {
      applyCrmFieldErrors(error, setError, ['firstName', 'lastName', 'email', 'phone', 'status', 'source', 'assignedUserId', 'address']);
      organization.applyServerErrors(error);
      setSubmitError(error instanceof Error ? error.message : 'Unable to save lead. Please try again.');
    } finally { saving.current = false; setIsSaving(false); }
  };

  // Shared field classes
  const inputCls = 'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-primary/20 focus:border-primary';
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
            <FieldWrap fieldKey="firstName" label="First Name *" htmlFor={`${fieldId}-firstName`} error={errors.firstName?.message}>
              <input
                {...register('firstName')} maxLength={100} required aria-required="true"
                id={`${fieldId}-firstName`}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? `${fieldId}-firstName-error` : undefined}
                className={`${inputCls}${errors.firstName ? ` ${errorInputCls}` : ''}`}
                placeholder="Enter first name"
              />
            </FieldWrap>
            <FieldWrap fieldKey="lastName" label="Last Name *" htmlFor={`${fieldId}-lastName`} error={errors.lastName?.message}>
              <input
                {...register('lastName')} maxLength={100} required aria-required="true"
                id={`${fieldId}-lastName`}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? `${fieldId}-lastName-error` : undefined}
                className={`${inputCls}${errors.lastName ? ` ${errorInputCls}` : ''}`}
                placeholder="Enter last name"
              />
            </FieldWrap>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="email" label="Email *" htmlFor={`${fieldId}-email`} error={errors.email?.message}>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="email"
                  {...register('email')} required aria-required="true" maxLength={254}
                  id={`${fieldId}-email`}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? `${fieldId}-email-error` : undefined}
                  className={`${inputCls} pl-9${errors.email ? ` ${errorInputCls}` : ''}`}
                  placeholder="email@example.com"
                />
              </div>
            </FieldWrap>
            <FieldWrap fieldKey="phone" label="Phone">
              <PhilippinePhoneInput
                value={phoneLocal}
                onChange={(v) => { setPhoneLocal(v); setPhoneTouched(true); setValue('phone', v ? toE164(v) : '', { shouldDirty: true }); }}
                error={phoneTouched ? validatePhMobile(phoneLocal) : null}
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
              {!initialData ? <input id={`${fieldId}-status`} value="Inquiry" readOnly className={selectCls} /> : <div className="relative">
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
            <FieldWrap fieldKey="productInterestIds" label="Product Interest">
<ProductInterestSelect products={productRecords} categories={categories} showUncategorized={false} values={selectedProducts} onChange={values => { setSelectedProducts(values); setValue('productInterest', values, { shouldDirty: true }); }} disabled={productsLoading || !!productError} labels={Object.fromEntries((initialData?.productInterestIds ?? []).map((id: string, i: number) => [id, initialData?.productInterests?.[i] ?? "Unavailable product"]))} />
{productError && <p role="alert" className="text-xs text-destructive">{productError}</p>}
</FieldWrap>
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
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </FieldWrap>
            <FieldWrap fieldKey="assignedUserId" htmlFor={`${fieldId}-assignedUserId`} error={errors.assignedUserId?.message} label="Assigned Agent">
              {selfAssigned ? <input id={`${fieldId}-assignedUserId`} value={currentAgentName} readOnly className={selectCls} /> : (
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
                    ownerGroupId={initialData?.ownerGroupId} users={recordAccess.policy?.assignmentRestricted && !(initialData && recordAccess.canReassignRecord?.(initialData)) ? users.filter(user => user.id === recordAccess.policy?.userId) : users} disabled={!recordAccess.policy || (!!initialData && !(recordAccess.canReassignRecord?.(initialData) ?? recordAccess.canReassign))}
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
              <textarea
                {...register('address')} maxLength={2000}
                id={`${fieldId}-address`}
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
                rows={3}
                className="w-full pl-9 pr-4 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none overflow-hidden"
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
          disabled={isSubmitting || !canSubmit || customFields.blocked || productsLoading || !!productError}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 active:scale-95 rounded-xl transition-all shadow-lg shadow-primary/25"
        >
          {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Lead'}
        </button>
      </div>
    </form>
  );
}

// ── Small reusable helpers ─────────────────────────────────────────────────────

function SectionHeader({ title }: { num: number; title: string }): React.ReactElement {
  return (
    <div className="flex min-h-6 items-center gap-3">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">{title}</h3>
      <div className="flex-1 h-px bg-gray-200 dark:bg-white/[0.06]" />
    </div>
  );
}

function FieldWrap({ label, error, htmlFor, children }: { label: string; fieldKey?: string; error?: string; htmlFor?: string; children: React.ReactNode }): React.ReactElement {
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

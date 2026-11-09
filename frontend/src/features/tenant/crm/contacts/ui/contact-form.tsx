'use client';
import { applyCrmFieldErrors, showCrmMutationError, isStaffEmailError } from '@/shared/utils/crm-mutation-error';
import { useEmailAvailability } from '@/shared/hooks/use-email-availability';
import { usePhoneAvailability } from '@/shared/hooks/use-phone-availability';
import { STAFF_PHONE_CONFLICT } from '@leadcrm/shared';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';

import { SELECTABLE_LEAD_SOURCES, isDirectMailSource, defaultFieldLayout, getCrmFieldCatalog } from '@leadcrm/shared';
import { OrganizationFields, useOrganizationForm } from '@/shared/components/crm/organization-fields';
import { ConfiguredFormLayout } from '@/shared/components/crm/configured-form-layout';
import { useRecordCustomFields, CustomFieldGroup, CustomFieldExtraGroups } from '@/shared/components/crm/record-custom-fields';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelInputClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';
import { ProductInterestField, ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { CRM_STATUSES, normalizeCrmStatus } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useData } from '@/store/DataContext';
import { useAuth } from '@/store/AuthContext';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { AssignedAgentSelect } from '@/shared/components/crm/assigned-agent-select';
import { useScrollToError } from '@/shared/hooks/use-scroll-to-error';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';
import { toast } from '@/shared/utils/toast';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { toE164, validatePhMobile, normalizePhInput } from '@/shared/utils/ph-phone';
import {
  Mail,
  MapPin,
  AlertCircle,
  ChevronDown,
  X,
  Check,
} from 'lucide-react';
import {
  CreateContactFormSchema,
  UpdateContactFormSchema,
  type CreateContactFormValues,
  type UpdateContactFormValues,
} from '../schemas/contact-form.schema';
import type { Contact } from '@/store/types';
import { Textarea } from '@/shared/components/ui/textarea';
import { Input } from '@/shared/components/ui/input';

// ─── Constants ─────────────────────────────────────────────────────────────



const SOURCES = SELECTABLE_LEAD_SOURCES;

const STATUS_OPTIONS = CRM_STATUSES.map(value => ({ value, label: value }));

// ─── Props ─────────────────────────────────────────────────────────────────

interface ContactFormProps {
  initialData?: Contact;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Contact>) => void | Promise<void>;
}

interface ContactFormInnerProps {
  initialData?: Contact;
  onSave: (data: Partial<Contact>) => void | Promise<void>;
  onCancel: () => void;
}

// ─── Form Component ────────────────────────────────────────────────────────

export function ContactFormInner({ initialData, onSave, onCancel }: ContactFormInnerProps): React.ReactElement {
  const recordAccess = useCrmRecordAccess('contacts');
  const actionAllowed = useHasPermission(initialData ? 'contacts.edit' : 'contacts.create');
  const canSubmit = actionAllowed && !!recordAccess.policy && (!initialData || recordAccess.canMutate(initialData));
  const customFields = useRecordCustomFields('contacts', initialData?.id);
  const organization = useOrganizationForm(initialData);
  const { products: productRecords, categories, loading: productsLoading, error: productError } = useProductInterests();
  const { users } = useData();
  const isEdit = !!initialData;
  const { user } = useAuth();
  const selfAssigned = !isEdit && recordAccess.policy?.assignmentRestricted === true;
  const currentAgentName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || '';
  const [isSaving, setIsSaving] = useState(false);
  const statusVersion = useRef(initialData);
  useEffect(() => { statusVersion.current = initialData; }, [initialData?.id]);

  // New Contacts use the requested section order without rewriting saved layouts.
  const configuredFields = useMemo(() => {
    if (isEdit) return customFields;
    const defaults = defaultFieldLayout('contacts');
    const saved = customFields.layout ?? defaults;
    const builtInIds = new Set(defaults.groups.map(group => group.id));
    const groups = [...defaults.groups, ...saved.groups.filter(group => !builtInIds.has(group.id)).sort((a, b) => a.order - b.order).map((group, index) => ({ ...group, order: defaults.groups.length + index }))];
    const fields = { ...saved.fields };
    for (const field of getCrmFieldCatalog('contacts')) {
      const override = fields[field.technicalKey];
      if (override) fields[field.technicalKey] = { ...override, groupId: field.groupId, order: field.order };
    }
    return { ...customFields, layout: { ...saved, groups, fields } };
  }, [customFields, isEdit]);

  // Map initialData to form values that match the backend schema
  const defaultValues = useMemo((): CreateContactFormValues => ({
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    email: initialData?.email || '',
    phone: initialData?.phone ? toE164(normalizePhInput(initialData.phone)) : '',
    companyName: initialData?.companyName || '',
    notes: initialData?.notes || '',
    status: initialData?.status ? normalizeCrmStatus(initialData.status) : 'Inquiry',
    source: initialData?.leadSource || '',
    accountId: initialData?.accountId || initialData?.organizationId || '',
    assignedUserId: initialData?.assignedUserId || '',
    productInterest: initialData?.productInterests || initialData?.productInterest || [],
    address: initialData?.address || '',
  }), [initialData]);

  // Create and edit both require trimmed names and a valid email.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = isEdit ? UpdateContactFormSchema : CreateContactFormSchema;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting: isValidatingSubmission, isDirty },
    setValue,
    watch,
    setFocus,
    setError,
    clearErrors,
  } = useForm<CreateContactFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RHF v7.82 + resolvers v5.4 type mismatch
    resolver: zodResolver(schema) as never,
    defaultValues,
    mode: 'onBlur',
  });
  const isSubmitting = isValidatingSubmission || isSaving;
  const requestClose = usePanelDraft({ dirty: isDirty || customFields.dirty || organization.dirty, busy: isSubmitting || customFields.uploadCount > 0 });

  useEffect(() => {
    setValue('companyName', organization.fields.companyName);
    setValue('accountId', organization.mode === 'existing' ? organization.accountId : '');
  }, [organization.fields.companyName, organization.mode, organization.accountId, setValue]);

  // Scroll to first error on submit
  const fieldId = React.useId();
  const formRef = useRef<HTMLFormElement>(null);
  useScrollToError({ errors, formRef, setFocus });

  // Philippine phone — local 10-digit number managed outside RHF
  const [phoneLocal, setPhoneLocal] = useState(() => normalizePhInput(initialData?.phone ?? ''));
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Re-initialize phone when initialData changes (e.g. opening edit for a different contact)
  useEffect(() => {
    setPhoneLocal(normalizePhInput(initialData?.phone ?? ''));
    setPhoneTouched(false);
  }, [initialData?.id]);

  const selectedProducts = watch('productInterest') || [];
  const emailCheck = useEmailAvailability(watch('email'), 'contacts', !isEdit && canSubmit);
  const emailError = emailCheck.error || errors.email?.message;
  const phoneCheck = usePhoneAvailability(watch('phone') ?? '', 'contacts', canSubmit);
  const phoneError = phoneCheck.error || errors.phone?.message || (phoneTouched ? validatePhMobile(phoneLocal) : null);

  const [saveError, setSaveError] = useState('');
  const saving = useRef(false);
  const onSubmit = async (data: CreateContactFormValues | UpdateContactFormValues): Promise<void> => {
    if (!canSubmit || saving.current) return;
    if (!phoneCheck.confirm(data.phone ?? '')) return;
    if (!isEdit && !emailCheck.confirm(data.email!)) return;
    setPhoneTouched(true);
    if (validatePhMobile(phoneLocal) || !customFields.validate() || !organization.validate()) return;
    setSaveError('');
    // contactsV2Api translates the display aliases to Contact API columns.
    const cleaned: Partial<Contact> = {

      customFieldValues: customFields.payload(),
      firstName: data.firstName || undefined,
      lastName: data.lastName || undefined,
      email: data.email || undefined,
      phone: phoneLocal ? toE164(phoneLocal) : isEdit ? '' : undefined,
      ...organization.payload(),
      ...(isEdit ? { notes: data.notes || '' } : {}),
      status: isEdit && data.status === normalizeCrmStatus(statusVersion.current?.status) ? undefined : data.status || 'Inquiry',
      ...(isEdit && data.status !== normalizeCrmStatus(statusVersion.current?.status) ? { expectedUpdatedAt: statusVersion.current?.updatedAt } : {}),
      leadSource: isDirectMailSource(data.source) ? undefined : data.source || (isEdit ? '' : undefined),
      assignedUserId: selfAssigned ? recordAccess.policy?.userId : data.assignedUserId || undefined,
      productInterest: data.productInterest || [],
      address: data.address || (isEdit ? '' : undefined),
    };

    if (isEdit && !data.assignedUserId) (cleaned as Record<string, unknown>).assignedUserId = null;

    saving.current = true;
    setIsSaving(true);
    try { await onSave(cleaned); }
    catch (error) {
      if ((error as { fieldErrors?: { phone?: string[] } }).fieldErrors?.phone?.includes(STAFF_PHONE_CONFLICT)) {
        phoneCheck.reject(); setError('phone', { type: 'server', message: STAFF_PHONE_CONFLICT }); setSaveError(''); return;
      }
      if (!isEdit && isStaffEmailError(error)) {
        emailCheck.reject('STAFF_EMAIL_NOT_ALLOWED');
        setSaveError('');
        return;
      }
      applyCrmFieldErrors(error, setError, ['firstName', 'lastName', 'email', 'phone', 'status', 'source', 'assignedUserId', 'address']);
      organization.applyServerErrors(error);
      showCrmMutationError(error, 'Unable to save Contact.');
      setSaveError(error instanceof Error ? error.message : 'Unable to save Contact. Please try again.');
    } finally { saving.current = false; setIsSaving(false); }
  };

  // Style classes
  const inputCls = panelInputClass;
  const inputErrorCls = '!border-red-500';
  const selectCls = panelInputClass + ' appearance-none pr-8 cursor-pointer';

  return (
    <form ref={formRef} onSubmit={event => { if (saving.current) event.preventDefault(); else void handleSubmit(onSubmit)(event); }} className="flex h-full min-h-0 flex-col" noValidate>
      {/* Scrollable Body */}
      <div className={panelBodyClass + " space-y-6"}>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

        <ConfiguredFormLayout form={configuredFields} module="contacts">
        {/* Section 1: Basic Information */}
        <div className="space-y-4">
          <SectionHeader num={1} title="Basic Information" />

          {/* First & Last Name (required) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap fieldKey="firstName" label="First Name *" htmlFor={`${fieldId}-firstName`} error={errors.firstName?.message}>
              <Input
                {...register('firstName')}
                id={`${fieldId}-firstName`}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? `${fieldId}-firstName-error` : undefined}
                className={`${inputCls}  ${errors.firstName ? inputErrorCls : ''}`}
                placeholder="Enter first name"
              />
            </FieldWrap>
            <FieldWrap fieldKey="lastName" label="Last Name *" htmlFor={`${fieldId}-lastName`} error={errors.lastName?.message}>
              <Input
                {...register('lastName')}
                id={`${fieldId}-lastName`}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? `${fieldId}-lastName-error` : undefined}
                className={`${inputCls}  ${errors.lastName ? inputErrorCls : ''}`}
                placeholder="Enter last name"
              />
            </FieldWrap>
          </div>

          {/* Email & Phone */}
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
                  className={`${inputCls} pl-9${!isEdit ? ' pr-10' : ''}  ${emailError ? inputErrorCls : ''}`}
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

        {/* Section 2: Status & Interest */}
        <div className="space-y-4">
          <SectionHeader num={2} title="Status & Interest" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Status */}
            <FieldWrap fieldKey="status" label="Status" htmlFor={`${fieldId}-status`} error={errors.status?.message}>
              {!initialData ? <Input id={`${fieldId}-status`} value="Inquiry" readOnly className={selectCls} /> : <div className="relative">
                <select
                  {...register('status')}
                  id={`${fieldId}-status`}
                  aria-invalid={!!errors.status}
                  aria-describedby={errors.status ? `${fieldId}-status-error` : undefined}
                  className={`${selectCls} ${errors.status ? inputErrorCls : ''}`}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} disabled={opt.value !== normalizeCrmStatus(initialData.status) && (initialData.statusEditOptions ? !initialData.statusEditOptions.includes(opt.value) : normalizeCrmStatus(initialData.status) === 'Cancelled' ? opt.value !== 'Inquiry' : normalizeCrmStatus(initialData.status) === 'Closed Deal' ? opt.value !== 'Cancelled' : opt.value === 'Closed Deal')}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>}
            </FieldWrap>

            <ProductInterestField fieldKey="productInterestIds" label="Product Interest" error={productError || errors.productInterest?.message}>
              <ProductInterestSelect products={productRecords} categories={categories} showUncategorized={false} valueMode="name" values={selectedProducts} onChange={values => setValue('productInterest', values, { shouldValidate: true, shouldDirty: true })} disabled={productsLoading || !!productError} />
            </ProductInterestField>
          </div>
          <CustomFieldGroup form={customFields} group="Status & Interest" />
        </div>

        {/* Section 3: Organization */}
        <div className="space-y-4">
          <SectionHeader num={3} title="Organization" />

          {/* Account (organization) selector */}
          <div data-crm-field-key="companyName" data-crm-secondary-field-key="accountId" className="sm:col-span-2"><OrganizationFields draft={organization} disabled={isSubmitting} companyLabel={customFields.layout?.fields.companyName?.label ?? 'Company'} showCompany={customFields.layout?.fields.companyName?.visibleInForm !== false} showAccount={configuredFields.layout?.fields.accountId?.visibleInForm !== false} /></div>

          <CustomFieldGroup form={customFields} group="Organization" />
        </div>

        {/* Section 4: Additional Information */}
        <div className="space-y-4">
          <SectionHeader num={4} title="Additional Information" />

          <FieldWrap fieldKey="source" label="Source" htmlFor={`${fieldId}-source`} error={errors.source?.message}>
            <div className="relative">
              <select
                {...register('source')}
                id={`${fieldId}-source`}
                aria-invalid={!!errors.source}
                aria-describedby={errors.source ? `${fieldId}-source-error` : undefined}
                className={`${selectCls} ${errors.source ? inputErrorCls : ''}`}
              >
                <option value="">Select source...</option>
                  {isDirectMailSource(initialData?.leadSource) && <option value={initialData?.leadSource} disabled>Direct Mail (historical)</option>}
                {SOURCES.map((src) => <option key={src} value={src}>{src}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          </FieldWrap>

          {/* Address */}
              <FieldWrap fieldKey="address" label="Contact Address" htmlFor={`${fieldId}-address`} error={errors.address?.message}>
            <div className="relative">
              <MapPin className="absolute left-3.5 top-3 text-slate-400" size={14} />
              <Textarea
                {...register('address')}
                id={`${fieldId}-address`}
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
                rows={3}
                className={`w-full pl-9 pr-4 border rounded-xl py-2.5 text-sm transition-all resize-none ${errors.address ? inputErrorCls : ''}`}
                placeholder="123 Main St, City, State, Zip Code"
              />
            </div>
          </FieldWrap>
          {isEdit && <FieldWrap fieldKey="notes" label="Notes" htmlFor={`${fieldId}-notes`} error={errors.notes?.message}>
            <Textarea {...register('notes')} id={`${fieldId}-notes`} rows={3} maxLength={10000} className={`${inputCls}  ${errors.notes ? inputErrorCls : ''}`} placeholder="Add notes" />
          </FieldWrap>}
          <CustomFieldGroup form={customFields} group="Additional Information" />
        </div>
        {/* Section 5: Assigned Agent */}
        <div className="space-y-4">
          <SectionHeader num={5} title="Assigned Agent" />
          <FieldWrap fieldKey="assignedUserId" label="Assigned Agent" htmlFor={`${fieldId}-assignedUserId`} error={errors.assignedUserId?.message}>
            {selfAssigned ? <Input id={`${fieldId}-assignedUserId`} value={currentAgentName} readOnly className={inputCls} /> : (
              <Controller
              name="assignedUserId"
              control={control}
              render={({ field }) => (
                <AssignedAgentSelect
                  modules={isEdit ? ['contacts'] : ['contacts', 'deals']}
                  id={`${fieldId}-assignedUserId`}
                  value={field.value ?? ''}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                  users={recordAccess.policy?.assignmentRestricted && !(initialData && recordAccess.canReassignRecord?.(initialData)) ? users.filter(user => user.id === recordAccess.policy?.userId) : users} disabled={!recordAccess.policy || (!!initialData && !(recordAccess.canReassignRecord?.(initialData) ?? recordAccess.canReassign))}
                  placeholder={isEdit ? 'Unassigned' : 'Assign automatically'}
                  className={`${selectCls} ${errors.assignedUserId ? inputErrorCls : ''}`}
                  invalid={!!errors.assignedUserId}
                  describedBy={errors.assignedUserId ? `${fieldId}-assignedUserId-error` : undefined}
                />
              )}
            />
            )}
          </FieldWrap>
          <CustomFieldGroup form={customFields} group="Assigned Agent" />
        </div>

        <CustomFieldExtraGroups form={customFields} startNumber={6} />
        </ConfiguredFormLayout>
      </div>

      {/* Sticky Footer */}
      <div className={panelFooterClass + " justify-end"}>
        <button
          type="button"
          onClick={requestClose ?? onCancel}
          className={panelSecondaryActionClass}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit || emailCheck.blocked || phoneCheck.blocked || customFields.blocked || isSubmitting}
          className="h-[42px] px-6 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-[var(--primary-hover)] active:scale-95 rounded-xl transition-all shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Contact'}
        </button>
      </div>
    </form>
  );
}

// ─── Sheet Wrapper ─────────────────────────────────────────────────────────

export function ContactFormSheet({ initialData, isOpen, onClose, onSave }: ContactFormProps): React.ReactElement {
  return (
    <SlidingDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? 'Edit Contact' : 'New Contact'}
      subtitle="Complete the contact details below."
    >
      <ContactFormInner initialData={initialData} onSave={onSave} onCancel={onClose} />
    </SlidingDrawer>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: number; title: string }): React.ReactElement {
  return <PanelSectionHeading number={num}>{title}</PanelSectionHeading>;
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

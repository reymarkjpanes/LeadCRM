'use client';
import { LEAD_SOURCES } from '@leadcrm/shared';
import { useRecordCustomFields, CustomFieldGroup, CustomFieldExtraGroups } from '@/shared/components/crm/record-custom-fields';
import { PanelSectionHeading, panelBodyClass, panelFooterClass, panelInputClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';
import { ProductInterestSelect } from '@/shared/components/crm/product-interest-select';
import { CRM_STATUSES, normalizeCrmStatus } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useData } from '@/store/DataContext';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { AssignedAgentSelect } from '@/shared/components/crm/assigned-agent-select';
import { useScrollToError } from '@/shared/hooks/use-scroll-to-error';
import { toast } from 'sonner';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { toE164, validatePhMobile, normalizePhInput } from '@/shared/utils/ph-phone';
import {
  Mail,
  MapPin,
  AlertCircle,
  ChevronDown,
  X,
} from 'lucide-react';
import {
  CreateContactFormSchema,
  UpdateContactFormSchema,
  type CreateContactFormValues,
  type UpdateContactFormValues,
} from '../schemas/contact-form.schema';
import type { Contact } from '@/store/types';

// ─── Constants ─────────────────────────────────────────────────────────────



const SOURCES = LEAD_SOURCES;

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
  const customFields = useRecordCustomFields('contacts', initialData?.id);
  const { products: productRecords, loading: productsLoading, error: productError } = useProductInterests();
  const { users } = useData();
  const isEdit = !!initialData;

  // Map initialData to form values that match the backend schema
  const defaultValues = useMemo((): CreateContactFormValues => ({
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    companyName: initialData?.companyName || '',
    status: normalizeCrmStatus(initialData?.status),
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
    formState: { errors, isSubmitting },
    setValue,
    watch,
    setFocus,
  } = useForm<CreateContactFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RHF v7.82 + resolvers v5.4 type mismatch
    resolver: zodResolver(schema) as never,
    defaultValues,
    mode: 'onBlur',
  });

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

  const [saveError, setSaveError] = useState('');
  const onSubmit = async (data: CreateContactFormValues | UpdateContactFormValues): Promise<void> => {
    if (!customFields.validate()) return;
    setSaveError('');
    // contactsV2Api translates the display aliases to Contact API columns.
    const cleaned: Partial<Contact> = {
      customFieldValues: customFields.payload(),
      firstName: data.firstName || undefined,
      lastName: data.lastName || undefined,
      email: data.email || undefined,
      phone: phoneLocal ? toE164(phoneLocal) : isEdit ? '' : undefined,
      companyName: data.companyName || (isEdit ? '' : undefined),
      status: data.status || 'Warm',
      leadSource: data.source || (isEdit ? '' : undefined),
      assignedUserId: data.assignedUserId || undefined,
      productInterest: data.productInterest || [],
      address: data.address || (isEdit ? '' : undefined),
    };

    // Pass accountId through directly — adapter maps it correctly
    if (data.accountId || isEdit) (cleaned as Record<string, unknown>).accountId = data.accountId || null;
    if (isEdit && !data.assignedUserId) (cleaned as Record<string, unknown>).assignedUserId = null;

    try { await onSave(cleaned); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save Contact. Please try again.'); }
  };

  // Style classes
  const inputCls = panelInputClass;
  const inputErrorCls = '!border-red-500 focus:!ring-red-500/20';
  const selectCls = panelInputClass + ' appearance-none pr-8 cursor-pointer';

  return (
    <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="flex h-full min-h-0 flex-col" noValidate>
      {/* Scrollable Body */}
      <div className={panelBodyClass + " space-y-6"}>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        {/* Section 1: Basic Information */}
        <div className="space-y-4">
          <SectionHeader num={1} title="Basic Information" />

          {/* First & Last Name (required) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap label="First Name *" htmlFor={`${fieldId}-firstName`} error={errors.firstName?.message}>
              <input
                {...register('firstName')}
                id={`${fieldId}-firstName`}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? `${fieldId}-firstName-error` : undefined}
                className={`${inputCls} ${errors.firstName ? inputErrorCls : ''}`}
                placeholder="Enter first name"
              />
            </FieldWrap>
            <FieldWrap label="Last Name *" htmlFor={`${fieldId}-lastName`} error={errors.lastName?.message}>
              <input
                {...register('lastName')}
                id={`${fieldId}-lastName`}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? `${fieldId}-lastName-error` : undefined}
                className={`${inputCls} ${errors.lastName ? inputErrorCls : ''}`}
                placeholder="Enter last name"
              />
            </FieldWrap>
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap label="Email *" htmlFor={`${fieldId}-email`} error={errors.email?.message}>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="email"
                  {...register('email')} required aria-required="true" maxLength={254}
                  id={`${fieldId}-email`}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? `${fieldId}-email-error` : undefined}
                  className={`${inputCls} pl-9 ${errors.email ? inputErrorCls : ''}`}
                  placeholder="email@example.com"
                />
              </div>
            </FieldWrap>
            <FieldWrap label="Phone">
              <PhilippinePhoneInput
                value={phoneLocal}
                onChange={(v) => { setPhoneLocal(v); setPhoneTouched(true); }}
                error={phoneTouched ? validatePhMobile(phoneLocal) : null}
              />
            </FieldWrap>
          </div>

          {/* Company Name */}
          <FieldWrap label="Company Name" htmlFor={`${fieldId}-companyName`} error={errors.companyName?.message}>
            <input
              {...register('companyName')}
              id={`${fieldId}-companyName`}
              aria-invalid={!!errors.companyName}
              aria-describedby={errors.companyName ? `${fieldId}-companyName-error` : undefined}
              className={`${inputCls} ${errors.companyName ? inputErrorCls : ''}`}
              placeholder="Company or organization name"
            />
          </FieldWrap>
          <CustomFieldGroup form={customFields} group="Basic Information" />
        </div>

        {/* Section 2: Status & Classification */}
        <div className="space-y-4">
          <SectionHeader num={2} title="Status & Classification" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Status */}
            <FieldWrap label="Status" htmlFor={`${fieldId}-status`} error={errors.status?.message}>
              <div className="relative">
                <select
                  {...register('status')}
                  id={`${fieldId}-status`}
                  aria-invalid={!!errors.status}
                  aria-describedby={errors.status ? `${fieldId}-status-error` : undefined}
                  className={`${selectCls} ${errors.status ? inputErrorCls : ''}`}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </FieldWrap>

            <FieldWrap label="Product Interest">
              <ProductInterestSelect products={productRecords} valueMode="name" values={selectedProducts} onChange={values => setValue('productInterest', values, { shouldValidate: true })} disabled={productsLoading || !!productError} />
              {productError && <p role="alert" className="text-xs text-destructive">{productError}</p>}
            </FieldWrap>
          </div>
          <CustomFieldGroup form={customFields} group="Status & Classification" />
        </div>

        {/* Section 3: Relationships */}
        <div className="space-y-4">
          <SectionHeader num={3} title="Relationships" />

          {/* Account (organization) selector */}
          <FieldWrap label="Account">
            <Controller
              name="accountId"
              control={control}
              render={({ field }) => (
                <EntityCombobox
                  entityType="accounts"
                  value={field.value || null}
                  onChange={(id) => field.onChange(id || '')}
                  placeholder="Search accounts..."
                  error={errors.accountId?.message}
                />
              )}
            />
          </FieldWrap>

          {/* Assigned User */}
          <FieldWrap label="Assigned Agent" htmlFor={`${fieldId}-assignedUserId`} error={errors.assignedUserId?.message}>
            <Controller
              name="assignedUserId"
              control={control}
              render={({ field }) => (
                <AssignedAgentSelect
                  id={`${fieldId}-assignedUserId`}
                  value={field.value ?? ''}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                  users={users}
                  placeholder={isEdit ? 'Unassigned' : 'Assign automatically'}
                  className={`${selectCls} ${errors.assignedUserId ? inputErrorCls : ''}`}
                  invalid={!!errors.assignedUserId}
                  describedBy={errors.assignedUserId ? `${fieldId}-assignedUserId-error` : undefined}
                />
              )}
            />
          </FieldWrap>
          <CustomFieldGroup form={customFields} group="Relationships" />
        </div>

        {/* Section 4: Additional Information */}
        <div className="space-y-4">
          <SectionHeader num={4} title="Additional Information" />

          <FieldWrap label="Source" htmlFor={`${fieldId}-source`} error={errors.source?.message}>
            <div className="relative">
              <select
                {...register('source')}
                id={`${fieldId}-source`}
                aria-invalid={!!errors.source}
                aria-describedby={errors.source ? `${fieldId}-source-error` : undefined}
                className={`${selectCls} ${errors.source ? inputErrorCls : ''}`}
              >
                <option value="">Select source...</option>
                {SOURCES.map((src) => <option key={src} value={src}>{src}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          </FieldWrap>

          {/* Address */}
              <FieldWrap label="Full Address" htmlFor={`${fieldId}-address`} error={errors.address?.message}>
            <div className="relative">
              <MapPin className="absolute left-3.5 top-3 text-slate-400" size={14} />
              <textarea
                {...register('address')}
                id={`${fieldId}-address`}
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
                rows={3}
                className={`w-full pl-9 pr-4 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none ${errors.address ? inputErrorCls : ''}`}
                placeholder="123 Main St, City, State, Zip Code"
              />
            </div>
          </FieldWrap>
          <CustomFieldGroup form={customFields} group="Additional Information" />
        </div>
        <CustomFieldExtraGroups form={customFields} startNumber={5} />
      </div>

      {/* Sticky Footer */}
      <div className={panelFooterClass + " justify-end"}>
        <button
          type="button"
          onClick={onCancel}
          className={panelSecondaryActionClass}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={customFields.blocked || isSubmitting}
          className="h-[42px] px-6 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 active:scale-95 rounded-xl transition-all shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
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

'use client';
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
import { useScrollToError } from '@/shared/hooks/use-scroll-to-error';
import { useDuplicateCheck } from '@/shared/hooks/use-duplicate-check';
import { DuplicateWarning } from '@/shared/components/crm/duplicate-warning';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { toE164, validatePhMobile, normalizePhInput } from '@/shared/utils/ph-phone';
import {
  Mail,
  MapPin,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';

// ── Zod schemas mirroring backend CreateContactSchema / UpdateContactSchema ──
// Backend route POST /crm/leads validates against CreateContactSchema from contacts.dto.ts.

// Unified form schema — used for both Create and Edit.
// On create: firstName + lastName are required (min 1).
// On edit: all fields pre-populated, same constraints apply for non-empty values.
// Backend UpdateContactSchema makes all fields optional, but the form always
// sends populated values (pre-filled from initialData), so using the Create schema
// for validation is correct for both modes.
const LeadFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'Max 100 characters'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Max 100 characters'),
  email: CrmEmailSchema,
  phone: z.string().optional(),
  companyName: z.string().optional(),
  status: LeadStatusSchema,
  source: z.string().optional(),
  accountId: z.string().optional(),
  assignedUserId: z.string().optional(),
  productInterest: z.array(z.string()).optional(),
  address: z.string().optional(),
});

type LeadFormData = z.infer<typeof LeadFormSchema>;



const STATUS_OPTIONS = LEAD_STATUSES.map(value => ({ value, label: value }));

const SOURCE_OPTIONS = [
  'Google Ads',
  'Referral',
  'Email Campaign',
  'Website',
  'Social Media Advertisement',
  'Direct Mail',
  'Content Marketing',
  'Others',
];

interface LeadFormProps {
  initialData?: Lead;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead>) => void;
}

interface AddLeadFormProps {
  initialData?: Lead;
  onSave: (data: Partial<Lead>) => void;
  onCancel: () => void;
}

export function AddLeadForm({ initialData, onSave, onCancel }: AddLeadFormProps) {
  const { users } = useData();
  const isEdit = !!initialData;
  const requestId = useRef<string | undefined>(undefined);
  const { products: productRecords, error: productError, loading: productsLoading } = useProductInterests();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setFocus,
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
      status: 'Warm',
      source: '',
      accountId: '',
      assignedUserId: '',
      productInterest: [],
      address: '',
    },
  });

  // Product interest state (for custom dropdown UX)
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

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
        source: initialData.leadSource || initialData.source || '',
        accountId: initialData.accountId || initialData.organizationId || '',
        assignedUserId: initialData.assignedUserId || '',
        productInterest: initialData.productInterests || initialData.productInterest || [],
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
        status: 'Warm',
        source: '',
        accountId: '',
        assignedUserId: '',
        productInterest: [],
        address: '',
      });
    }
  }, [initialData, reset]);

  const onFormSubmit = (data: LeadFormData): void => {
    // Build phone in E.164 format from local 10-digit number
    const fullPhone = phoneLocal ? toE164(phoneLocal) : '';

    const productInterest = selectedProducts;
    if (productsLoading || productError) return;
    if (!isEdit) requestId.current ??= crypto.randomUUID();
    // Build payload matching backend CreateContactSchema field names exactly.
    // No phantom fields — adapter handles any remaining mapping.
    const payload: Partial<Lead> = {
      ...(!isEdit ? { requestId: requestId.current } : {}),
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || undefined,
      phone: fullPhone || undefined,
      companyName: data.companyName || undefined,
      status: data.status || 'Warm',
      source: data.source || undefined,
      accountId: data.accountId || undefined,
      assignedUserId: data.assignedUserId || undefined,
      productInterest: productInterest,
      address: data.address || undefined,
    };

    onSave(payload);
  };

  // Shared field classes
  const inputCls = 'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
  const selectCls = 'w-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl pl-3.5 pr-8 py-2.5 text-sm text-slate-900 dark:text-white outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all [&>option]:bg-white dark:[&>option]:bg-slate-900';
  const errorInputCls = '!border-red-500 focus:!ring-red-500/20';

  return (
    <form ref={formRef} onSubmit={handleSubmit(onFormSubmit)} className="flex flex-col h-full" noValidate>
      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* Section 1: Basic Information */}
        <div className="space-y-4">
          <SectionHeader num={1} title="Basic Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap label="First Name *" htmlFor={`${fieldId}-firstName`} error={errors.firstName?.message}>
              <input
                {...register('firstName')}
                id={`${fieldId}-firstName`}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? `${fieldId}-firstName-error` : undefined}
                className={`${inputCls}${errors.firstName ? ` ${errorInputCls}` : ''}`}
                placeholder="Enter first name"
              />
            </FieldWrap>
            <FieldWrap label="Last Name *" htmlFor={`${fieldId}-lastName`} error={errors.lastName?.message}>
              <input
                {...register('lastName')}
                id={`${fieldId}-lastName`}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? `${fieldId}-lastName-error` : undefined}
                className={`${inputCls}${errors.lastName ? ` ${errorInputCls}` : ''}`}
                placeholder="Enter last name"
              />
            </FieldWrap>
          </div>
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
                  className={`${inputCls} pl-9${errors.email ? ` ${errorInputCls}` : ''}`}
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
          <FieldWrap htmlFor={`${fieldId}-companyName`} error={errors.companyName?.message} label="Company Name">
            <input
              {...register('companyName')}
              id={`${fieldId}-companyName`}
              aria-invalid={!!errors.companyName}
              aria-describedby={errors.companyName ? `${fieldId}-companyName-error` : undefined}
              className={inputCls}
              placeholder="Enter company name"
            />
          </FieldWrap>
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
            <FieldWrap htmlFor={`${fieldId}-status`} error={errors.status?.message} label="Status">
              <div className="relative">
                <select
                  {...register('status')}
                  id={`${fieldId}-status`}
                  aria-invalid={!!errors.status}
                  aria-describedby={errors.status ? `${fieldId}-status-error` : undefined}
                  className={selectCls}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </FieldWrap>
            <FieldWrap label="Product Interest">
<ProductInterestSelect products={productRecords} values={selectedProducts} onChange={setSelectedProducts} disabled={productsLoading || !!productError} labels={Object.fromEntries((initialData?.productInterestIds ?? []).map((id: string, i: number) => [id, initialData?.productInterests?.[i] ?? "Unavailable product"]))} />
{productError && <p role="alert" className="text-xs text-destructive">{productError}</p>}
</FieldWrap>
          </div>
        </div>

        {/* Section 3: Organization */}
        <div className="space-y-4">
          <SectionHeader num={3} title="Organization" />
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
        </div>

        {/* Section 4: Additional Information */}
        <div className="space-y-4">
          <SectionHeader num={4} title="Additional Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldWrap htmlFor={`${fieldId}-source`} error={errors.source?.message} label="Lead Source">
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
            <FieldWrap htmlFor={`${fieldId}-assignedUserId`} error={errors.assignedUserId?.message} label="Assigned Agent">
              <div className="relative">
                <select
                  {...register('assignedUserId')}
                  id={`${fieldId}-assignedUserId`}
                  aria-invalid={!!errors.assignedUserId}
                  aria-describedby={errors.assignedUserId ? `${fieldId}-assignedUserId-error` : undefined}
                  className={selectCls}
                >
                  <option value="">{isEdit ? 'Unassigned' : 'Assign automatically'}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </FieldWrap>
          </div>
          <FieldWrap htmlFor={`${fieldId}-address`} error={errors.address?.message} label="Full Address">
            <div className="relative">
              <MapPin className="absolute left-3.5 top-3 text-slate-400" size={14} />
              <textarea
                {...register('address')}
                id={`${fieldId}-address`}
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? `${fieldId}-address-error` : undefined}
                rows={3}
                className="w-full pl-9 pr-4 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-none overflow-hidden"
                placeholder="123 Main St, Apt 4B, City, State, Zip Code"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${target.scrollHeight + 2}px`;
                }}
              />
            </div>
          </FieldWrap>
        </div>

      </div>{/* end scrollable body */}

      {/* Sticky Footer */}
      <div className="shrink-0 px-6 py-4 border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-slate-900 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.08] border border-gray-200 dark:border-white/[0.08] rounded-xl transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={productsLoading || !!productError}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-xl transition-all shadow-lg shadow-blue-500/25"
        >
          {isEdit ? 'Save Changes' : 'Create Lead'}
        </button>
      </div>
    </form>
  );
}

// ── Small reusable helpers ─────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: number; title: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-[11px] font-bold shrink-0">
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

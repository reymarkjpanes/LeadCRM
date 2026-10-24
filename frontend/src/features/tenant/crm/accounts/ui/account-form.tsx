'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { useCrmRecordAccess } from '@/shared/hooks/use-crm-record-access';
import { useScrollToError } from '@/shared/hooks/use-scroll-to-error';
import { ConfiguredFormLayout } from '@/shared/components/crm/configured-form-layout';
import { AccountNativeField } from '@/shared/components/crm/account-native-field';
import { useRecordCustomFields } from '@/shared/components/crm/record-custom-fields';
import { panelBodyClass, panelFooterClass, panelSecondaryActionClass } from '@/shared/components/side-panel-styles';
import { SlidingDrawer } from '@/shared/components/sliding-drawer';
import { applyCrmFieldErrors, showCrmMutationError } from '@/shared/utils/crm-mutation-error';
import { CreateAccountSchema, UpdateAccountSchema, type AccountFormValues } from '../schemas/account.schema';
import type { Account, AccountMutationInput } from '../types/account.types';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';

interface AccountFormInnerProps {
  initialData?: Account | null;
  onSave: (data: AccountMutationInput) => void | Promise<void>;
  onCancel: () => void;
}
interface AccountFormSheetProps extends Omit<AccountFormInnerProps, 'onCancel'> {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountFormInner({ initialData, onSave, onCancel }: AccountFormInnerProps): React.ReactElement {
  const recordAccess = useCrmRecordAccess('accounts');
  const actionAllowed = useHasPermission(initialData ? 'accounts.edit' : 'accounts.create');
  const canSubmit = actionAllowed && !!recordAccess.policy && (!initialData || recordAccess.canMutate(initialData));
  const customFields = useRecordCustomFields('accounts', initialData?.id);
  const isEdit = !!initialData;
  const defaultValues = useMemo((): AccountFormValues => ({
    name: initialData?.name || '', industry: initialData?.industry || '', size: (initialData?.size as AccountFormValues['size']) || '',
    website: initialData?.website || '', address: initialData?.address || '',
  }), [initialData]);
  const { register, handleSubmit, formState: { errors, isSubmitting: isValidatingSubmission, isDirty }, setFocus, setError } = useForm<AccountFormValues>({
    resolver: zodResolver(isEdit ? UpdateAccountSchema : CreateAccountSchema) as never, defaultValues, mode: 'onBlur',
  });
  const fieldId = React.useId();
  const formRef = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const requestId = useRef<string | undefined>(undefined);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSubmitting = isValidatingSubmission || isSaving;
  const requestClose = usePanelDraft({ dirty: isDirty || !!customFields.dirty, busy: isSubmitting || customFields.uploadCount > 0 });
  useScrollToError({ errors, formRef, setFocus });

  const onSubmit = async (data: AccountFormValues): Promise<void> => {
    if (!canSubmit || saving.current || !customFields.validate()) return;
    saving.current = true; setSaveError('');
    setIsSaving(true);
    try {
      if (!isEdit) requestId.current ??= crypto.randomUUID();
      await onSave({ ...(!isEdit ? { requestId: requestId.current } : {}), customFieldValues: customFields.payload(), name: data.name,
        industry: data.industry || (isEdit ? '' : undefined), size: data.size || (isEdit ? null : undefined),
        website: data.website || (isEdit ? '' : undefined),
        address: data.address || (isEdit ? '' : undefined) });
    } catch (error) {
      applyCrmFieldErrors(error, setError, ['name', 'industry', 'size', 'website', 'address']);
      const message = error instanceof Error ? error.message : 'Unable to save Account. Please try again.';
      setSaveError(message); showCrmMutationError(error, message);
    } finally { saving.current = false; setIsSaving(false); }
  };

  return <form ref={formRef} onSubmit={event => { if (saving.current) event.preventDefault(); else void handleSubmit(onSubmit)(event); }} className="flex h-full min-h-0 flex-col" noValidate>
    <div className={`${panelBodyClass} space-y-6`}>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      <ConfiguredFormLayout form={customFields} module="accounts">
        <AccountNativeField fieldKey="name" label="Account Name *" id={`${fieldId}-name`} registration={register('name')} error={errors.name?.message} disabled={isSubmitting} />
        <AccountNativeField fieldKey="industry" label="Industry" id={`${fieldId}-industry`} registration={register('industry')} error={errors.industry?.message} disabled={isSubmitting} />
        <AccountNativeField fieldKey="size" label="Company Size" id={`${fieldId}-size`} registration={register('size')} error={errors.size?.message} disabled={isSubmitting} />
        <AccountNativeField fieldKey="website" label="Website" id={`${fieldId}-website`} registration={register('website')} error={errors.website?.message} disabled={isSubmitting} />
        <AccountNativeField fieldKey="address" label="Company Address" id={`${fieldId}-address`} registration={register('address')} error={errors.address?.message} disabled={isSubmitting} />
      </ConfiguredFormLayout>
    </div>
    <div className={`${panelFooterClass} justify-end`}>
      <button type="button" onClick={requestClose ?? onCancel} className={panelSecondaryActionClass} disabled={isSubmitting}>Cancel</button>
      <button type="submit" disabled={!canSubmit || customFields.blocked || isSubmitting} className="h-[42px] rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
        {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Account'}
      </button>
    </div>
  </form>;
}

export function AccountFormSheet({ initialData, isOpen, onClose, onSave }: AccountFormSheetProps): React.ReactElement {
  return <SlidingDrawer isOpen={isOpen} onClose={onClose} title={initialData ? 'Edit Account' : 'New Account'} subtitle="Complete the account details below.">
    <AccountFormInner initialData={initialData} onSave={onSave} onCancel={onClose} />
  </SlidingDrawer>;
}

export default function AccountForm({ initial, onSubmit, onCancel }: {
  initial?: Account | null; onSubmit: (data: AccountMutationInput) => void | Promise<void>; onCancel: () => void;
}): React.ReactElement {
  return <AccountFormInner initialData={initial} onSave={onSubmit} onCancel={onCancel} />;
}

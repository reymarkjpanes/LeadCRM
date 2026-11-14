'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AccountFieldsSchema, CrmCompanyNameSchema, NewAccountSchema, type NewAccountInput } from '@leadcrm/shared';
import { textFieldError } from '@/shared/utils/text-field-validation';
import type { ApiRequestError } from '@/lib/api/client';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { EntityCombobox } from '@/shared/components/entity-combobox';
import { AccountNativeField, type AccountNativeFieldKey } from './account-native-field';
import { CustomFieldInput, useRecordCustomFields } from './record-custom-fields';
import { usePanelDraft } from '@/shared/hooks/use-panel-close-guard';

type Mode = 'existing' | 'new';
type CompanyFields = { companyName: string; industry: string; size: string; website: string; address: string };
type OrganizationPayload = { companyName?: string; accountId?: string | null; newAccount?: NewAccountInput };
const empty = { companyName: '', industry: '', size: '', website: '', address: '' };

export function useOrganizationForm(initial?: { id?: string; accountId?: string | null; organizationId?: string; companyName?: string | null }, options: { initialMode?: Mode } = {}) {
  const canView = useHasPermission('accounts.view');
  const canCreate = useHasPermission('accounts.create');
  const [mode, setMode] = useState<Mode>(options.initialMode ?? 'existing');
  const [accountId, setAccountId] = useState(initial?.accountId || initial?.organizationId || '');
  const [fields, setFields] = useState<CompanyFields>({ ...empty, companyName: initial?.companyName || '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const custom = useRef<ReturnType<typeof useRecordCustomFields> | null>(null);
  const identity = useRef<{ value: string; requestId: string } | undefined>(undefined);
  const baseline = useRef({ mode, accountId, fields });
  useEffect(() => {
    const next = { mode: options.initialMode ?? 'existing', accountId: initial?.accountId || initial?.organizationId || '', fields: { ...empty, companyName: initial?.companyName || '' } };
    baseline.current = next;
    setMode(next.mode);
    setAccountId(next.accountId);
    setFields(next.fields);
    setError(''); setFieldErrors({}); identity.current = undefined;
  }, [initial?.id]); // Background refreshes must not replace a user's draft.
  const newAccount = (): NewAccountInput => {
    const values = { name: fields.companyName, industry: fields.industry || undefined, size: fields.size || undefined,
      website: fields.website || undefined, address: fields.address || undefined, customFieldValues: custom.current?.payload() };
    const fingerprint = JSON.stringify(values);
    if (identity.current?.value !== fingerprint) identity.current = { value: fingerprint, requestId: crypto.randomUUID() };
    return { ...values, requestId: identity.current.requestId } as NewAccountInput;
  };
  const validate = () => {
    setError(''); setFieldErrors({});
    if (mode !== 'new') {
      const companyError = !initial?.id && !accountId && initial?.companyName
        ? textFieldError(CrmCompanyNameSchema, initial.companyName) : undefined;
      if (companyError) setError(companyError);
      return !companyError;
    }
    if (!canView || !canCreate) { setError('Accounts View and Create permissions are required. Ask your administrator for access, or link an existing account.'); return false; }
    const parsed = NewAccountSchema.safeParse(newAccount());
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.'), issue.message])));
      setError('Review the highlighted account fields before saving.'); return false;
    }
    if (!custom.current?.validate()) { setError('Complete the required account fields before saving.'); return false; }
    return true;
  };
  const payload = (): OrganizationPayload => mode === 'new' ? { newAccount: NewAccountSchema.parse(newAccount()) }
    : { accountId: accountId || null, ...(!initial?.id && !accountId && initial?.companyName ? { companyName: initial.companyName } : {}) };
  const applyServerErrors = (failure: unknown) => {
    const errors = (failure as ApiRequestError)?.fieldErrors;
    if (!errors) return;
    const nested = Object.fromEntries(Object.entries(errors).filter(([key]) => key.startsWith('newAccount.')).map(([key, messages]) => [key.slice('newAccount.'.length), messages[0]]));
    setFieldErrors(nested);
    if (errors.accountId?.[0]) setError(errors.accountId[0]);
    else if (errors.newAccount?.[0]) setError(errors.newAccount[0]);
  };
  const dirty = mode !== baseline.current.mode || accountId !== baseline.current.accountId || JSON.stringify(fields) !== JSON.stringify(baseline.current.fields);
  const changeField = (key: keyof CompanyFields, value: string) => {
    setFields(previous => ({ ...previous, [key]: value }));
    const field = key === 'companyName' ? 'name' : key;
    setFieldErrors(previous => ({ ...previous, [field]: field === 'name' || field === 'address'
      ? textFieldError(AccountFieldsSchema.shape[field], value) ?? '' : '' }));
  };
  return { mode, setMode, accountId, setAccountId, fields, setFields, changeField, dirty, error, fieldErrors, custom, validate, payload, applyServerErrors };
}
type OrganizationForm = ReturnType<typeof useOrganizationForm>;

function CompanyCustomFields({ draft }: { draft: OrganizationForm }) {
  const fields = useRecordCustomFields('accounts');
  usePanelDraft({ dirty: fields.dirty, busy: fields.uploadCount > 0 });
  draft.custom.current = fields;
  useEffect(() => () => { draft.custom.current = null; }, [draft.custom]);
  return <>{fields.fields.map(field => <CustomFieldInput key={field.id} field={field} form={fields} />)}
    {fields.query?.isInitialLoad && <p role="status" className="text-xs text-muted-foreground sm:col-span-2">Loading account fields…</p>}
    {fields.query?.error && <p role="alert" className="text-xs text-destructive sm:col-span-2">{fields.query.error} <button type="button" className="underline" onClick={() => void fields.query.refetch()}>Retry account fields</button></p>}</>;
}

/** Company attributes are owned by Account; the person keeps only its canonical link. */
export function OrganizationFields({ draft, companyLabel = 'Company Name', showAccount = true, showCompany = true, disabled = false }: {
  draft: OrganizationForm; companyLabel?: string; showAccount?: boolean; showCompany?: boolean; disabled?: boolean;
}) {
  const id = useId();
  usePanelDraft({ dirty: draft.dirty, busy: disabled });
  const canView = useHasPermission('accounts.view');
  const canCreate = useHasPermission('accounts.create');
  const [accountDraftOpened, setAccountDraftOpened] = useState(draft.mode === 'new');
  const change = draft.changeField;
  const keys: AccountNativeFieldKey[] = ['name', 'industry', 'size', 'website', 'address'];
  return <div className="min-w-0 space-y-4 sm:col-span-2">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Account options">
      {([['existing', 'Link existing account'], ['new', 'Create new account']] as const).map(([mode, label]) =>
        <button key={mode} type="button" aria-pressed={draft.mode === mode} disabled={disabled || (mode === 'existing' ? !canView || !showAccount : !canView || !canCreate || !showCompany)}
          className="min-h-9 rounded-lg border border-border px-3 py-1.5 text-xs aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:opacity-50"
          onClick={() => { if (mode === 'new') setAccountDraftOpened(true); draft.setMode(mode); }}>{label}</button>)}
    </div>
    {draft.mode === 'existing' && showAccount && <div className="space-y-2">
      <span className="block text-xs font-semibold text-muted-foreground">Account</span>
      <EntityCombobox entityType="accounts" value={draft.accountId || null} onChange={value => draft.setAccountId(value || '')}
        disabled={disabled || !canView} placeholder="Search accounts..." error={draft.error || undefined} />
    </div>}
    {draft.mode === 'new' && showCompany && <>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {keys.map(key => <AccountNativeField key={key} fieldKey={key} id={`${id}-${key}`}
          label={key === 'name' ? `${companyLabel} *` : undefined} value={key === 'name' ? draft.fields.companyName : draft.fields[key]}
          onChange={value => change(key === 'name' ? 'companyName' : key, value)} error={draft.fieldErrors[key]} disabled={disabled || !canView || !canCreate} />)}
      </div>
      <p className="text-xs text-muted-foreground">The new account and this record will be saved together.</p>
    </>}
    {showCompany && canView && canCreate && (draft.mode === 'new' || accountDraftOpened) && <div hidden={draft.mode !== 'new'}>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"><CompanyCustomFields draft={draft} /></div>
    </div>}
    {draft.mode === 'new' && draft.error && <p role="alert" className="text-xs text-destructive">{draft.error}</p>}
  </div>;
}

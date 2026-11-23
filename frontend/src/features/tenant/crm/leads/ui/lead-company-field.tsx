'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { COMPANY_NAME_MAX_LENGTH, companyNameMatchKey, CrmCompanyNameSchema, matchLeadCompanyOptions } from '@leadcrm/shared';
import { USE_MOCK_DATA } from '@/lib/config';
import { EntityCombobox, type EntityOption } from '@/shared/components/entity-combobox';
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { readMockAccounts } from '@/shared/utils/mock-account-storage';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import type { Lead, Organization } from '@/store/types';
import { leadsService } from '../services/leads.service';

const leadNamePrefix = 'company:';
const companyOption = (name: string): EntityOption => ({
  id: leadNamePrefix + name, label: name, group: 'Companies from Leads',
});
const isAccount = (option: EntityOption | null): boolean =>
  !!option && !option.id.startsWith(leadNamePrefix);

function initialCompany(lead: Lead | undefined): EntityOption | null {
  const accountId = lead?.accountId === undefined ? lead?.organizationId : lead.accountId;
  if (accountId) return { id: accountId, label: lead?.account?.name || lead?.companyName || 'Linked account' };
  return lead?.companyName ? companyOption(lead.companyName) : null;
}

export function useLeadCompanyDraft(lead: Lead | undefined, showCompany: boolean, showAccount: boolean) {
  const mayViewAccounts = useHasPermission('accounts.view');
  const showAccounts = showAccount && mayViewAccounts;
  const initial = useRef(initialCompany(lead));
  const [selection, setSelection] = useState(initial.current);
  const [error, setError] = useState<string>();
  useEffect(() => {
    initial.current = initialCompany(lead);
    setSelection(initial.current);
    setError(undefined);
  }, [lead?.id]); // Record refreshes should preserve an in-progress selection.

  const dirty = selection?.id !== initial.current?.id;
  const readOnly = !showAccounts && isAccount(initial.current);
  const selected = selection && (isAccount(selection) ? showAccounts : showCompany) ? selection : undefined;
  return {
    selected, dirty, readOnly, showAccounts, showCompany, error, setError,
    select(option: EntityOption | null) {
      setSelection(option);
      setError(undefined);
    },
    payload(): Pick<Partial<Lead>, 'accountId' | 'companyName'> {
      if (!dirty || readOnly) return {};
      if (selection && isAccount(selection)) return showAccounts ? { accountId: selection.id } : {};
      if (showCompany) return { companyName: selection?.label ?? '', accountId: null };
      return showAccounts && !selection ? { accountId: null } : {};
    },
  };
}

export function LeadCompanyField({ draft, label = 'Company', disabled }: {
  draft: ReturnType<typeof useLeadCompanyDraft>;
  label?: string;
  disabled?: boolean;
}) {
  if (draft.readOnly || (!draft.showCompany && !draft.showAccounts)) return null;
  return <LeadCompanyPicker label={label} selected={draft.selected} onSelect={draft.select}
    showCompany={draft.showCompany} showAccounts={draft.showAccounts} disabled={disabled} error={draft.error} />;
}

export function LeadCompanyNameEditor({ value, onChange, disabled }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return <LeadCompanyPicker label="Company" hideLabel selected={value ? companyOption(value) : undefined}
    onSelect={option => onChange(option?.label ?? '')} showCompany showAccounts={false} disabled={disabled} />;
}

function LeadCompanyPicker({ label, hideLabel, selected, onSelect, showCompany, showAccounts, disabled, error }: {
  label: string;
  hideLabel?: boolean;
  selected?: EntityOption;
  onSelect: (option: EntityOption | null) => void;
  showCompany: boolean;
  showAccounts: boolean;
  disabled?: boolean;
  error?: string;
}) {
  const id = useId();
  const { tenant } = useAuth();
  const { contacts } = useData();
  const mayViewLeads = useHasPermission('leads.view');
  const tenantId = tenant?.id;
  const source = showAccounts && showCompany ? 'both' : showAccounts ? 'accounts' : 'leads';
  const load = useCallback(async (search: string, signal: AbortSignal) => {
    const parsed = CrmCompanyNameSchema.safeParse(search);
    if (!parsed.success) return [];
    const results = USE_MOCK_DATA ? matchLeadCompanyOptions(
      showAccounts ? readMockAccounts<Organization>().filter(account => account.tenantId === tenantId && !account.isArchived)
        .map(({ id, name, industry, address }) => ({ id, name, industry: industry ?? null, address: address ?? null })) : [],
      showCompany && mayViewLeads && tenantId ? contacts.flatMap(lead =>
        lead.tenantId === tenantId && !lead.isArchived && !lead.deletedAt && !lead.convertedAt && lead.status !== 'Merged' &&
        !lead.accountId && (lead.accountId === null || !lead.organizationId) &&
        lead.companyName ? [lead.companyName] : [],
      ) : [],
      parsed.data,
    ) : (await leadsService.getCompanyOptions({ search: parsed.data, source }, signal)).data;
    if (!results) throw new Error('Unable to load company options.');
    return [
      ...results.accounts.map(account => ({
        id: account.id, label: account.name, group: 'Existing Accounts',
        sublabel: [account.industry, account.address].filter(Boolean).join(' · '),
      })),
      ...results.leadCompanies.map(companyOption),
    ];
  }, [showAccounts, tenantId, showCompany, mayViewLeads, contacts, source]);

  return <>
    <label id={id + '-label'} htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block text-xs font-semibold text-muted-foreground'}>{label}</label>
    <EntityCombobox
      id={id}
      aria-labelledby={id + '-label'}
      entityType="accounts"
      value={selected?.id ?? null}
      onChange={(_, option) => onSelect(option ?? null)}
      placeholder="Search companies..."
      minSearchChars={1}
      disabled={disabled}
      error={error}
      optionSource={{
        label: 'Company options',
        maxSearchLength: COMPANY_NAME_MAX_LENGTH,
        load,
        selected,
        addOption: showCompany ? (search, options) => {
          const result = CrmCompanyNameSchema.safeParse(search);
          if (!result.success || !result.data) return undefined;
          const key = companyNameMatchKey(result.data);
          return options.some(option => companyNameMatchKey(option.label) === key)
            ? undefined : companyOption(result.data.replace(/\s+/g, ' '));
        } : undefined,
      }}
    />
  </>;
}

'use client';

import React from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { AlertCircle, Building2, ChevronDown, Globe, MapPin } from 'lucide-react';
import { COMPANY_INDUSTRIES, COMPANY_SIZE_OPTIONS } from '@leadcrm/shared';
import { panelInputClass } from '@/shared/components/side-panel-styles';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';

export type AccountNativeFieldKey = 'name' | 'industry' | 'size' | 'website' | 'address';
const labels: Record<AccountNativeFieldKey, string> = { name: 'Account Name', industry: 'Industry', size: 'Company Size', website: 'Website', address: 'Company Address' };

/** One set of Account controls for standalone forms and nested person creation. */
export function AccountNativeField({ fieldKey, id, label = labels[fieldKey], registration, value, onChange, error, disabled = false }: {
  fieldKey: AccountNativeFieldKey;
  id: string;
  label?: string;
  registration?: UseFormRegisterReturn;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const required = label.endsWith(' *');
  const inputClass = `${panelInputClass} ${error ? '!border-red-500 focus:!ring-red-500/20' : ''}`;
  const common = { ...registration, id, value, name: registration?.name ?? `newAccount.${fieldKey}`, disabled,
    'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined, 'aria-required': required,
    onChange: onChange ? (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(event.target.value) : registration?.onChange };
  const options = fieldKey === 'industry' ? COMPANY_INDUSTRIES : COMPANY_SIZE_OPTIONS;
  return <div className={`min-w-0 space-y-1.5 ${fieldKey === 'address' ? 'sm:col-span-2' : ''}`}>
    <label htmlFor={id} className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
      {required ? label.slice(0, -2) : label}{required && <span className="text-red-500"> *</span>}
    </label>
    <div className="relative">
      {fieldKey === 'industry' || fieldKey === 'size' ? <>
        <select {...common} className={`${inputClass} appearance-none pr-8 cursor-pointer`}>
          <option value="">{fieldKey === 'industry' ? 'Select industry' : 'Select size'}</option>
          {value && !options.some(option => option === value) && <option value={value}>{value}</option>}
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </> : fieldKey === 'address' ? <>
        <MapPin size={14} className="pointer-events-none absolute left-3.5 top-3 text-slate-400" />
        <Textarea {...common} rows={3} className={`${inputClass} pl-9 resize-y`} placeholder="Enter the complete company address" />
      </> : <>
        {fieldKey === 'name' ? <Building2 size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /> : <Globe size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />}
        <Input {...common} type={fieldKey === 'website' ? 'url' : 'text'} className={`${inputClass} pl-9`} placeholder={fieldKey === 'name' ? 'Enter account name' : 'https://company.com'} />
      </>}
    </div>
    {error && <p id={`${id}-error`} role="alert" className="flex items-center gap-1 text-[11px] text-red-500"><AlertCircle size={11} />{error}</p>}
  </div>;
}

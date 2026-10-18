'use client';

import React, { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';
import { ModuleSearchInput } from '@/shared/components/crm/module-search-input';
import { matchesSearch } from '@/shared/utils/search';

export type CheckboxOption = {
  value: string;
  label: string;
};

export interface CheckboxDropdownSelectProps {
  id?: string;
  values: string[];
  options: CheckboxOption[];
  onChange: (values: string[]) => void;
  placeholder: string;
  ariaLabel: string;
  contentAriaLabel?: string;
  disabled?: boolean;
  emptyMessage?: string;
  single?: boolean;
  searchable?: boolean;
}

export function CheckboxDropdownSelect({ id, values, options, onChange, placeholder, ariaLabel, contentAriaLabel = ariaLabel, disabled, emptyMessage = 'No options available.', single = false, searchable = false }: CheckboxDropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const visibleOptions = searchable ? options.filter(option => matchesSearch(search, option.label)) : options;
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = [...new Set(values)];
  const labelFor = (value: string) => options.find(option => option.value === value)?.label || value;
  return <div className="min-w-0 [&>div]:w-full">
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild><button ref={trigger} id={id} type="button" disabled={disabled} aria-label={ariaLabel} className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <span className="min-w-0 [overflow-wrap:anywhere]">{selected.length === 0 ? placeholder : selected.length === 1 ? labelFor(selected[0]) : `${selected.length} selected`}</span><ChevronDown className="h-4 w-4 shrink-0" />
      </button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" role="group" aria-label={contentAriaLabel} className="w-80 max-w-[calc(100vw-2rem)]" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          if ((event.target as HTMLInputElement).type === 'text' && ['Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]'));
          const index = items.indexOf(document.activeElement as HTMLInputElement);
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }}>
        {searchable && <div className="p-2"><ModuleSearchInput label={`Search ${ariaLabel.toLowerCase()}`} placeholder="Search products…" value={search} onChange={setSearch} fullWidth /></div>}
        <div className="max-h-[min(18rem,60dvh)] overflow-y-auto overscroll-contain">
          {visibleOptions.length ? visibleOptions.map((option, index) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent focus-within:bg-accent">
            <input autoFocus={index === 0} type={single ? "radio" : "checkbox"} disabled={disabled} checked={selected.includes(option.value)} onChange={event => onChange(event.target.checked ? (single ? [option.value] : [...new Set([...selected, option.value])]) : selected.filter(value => value !== option.value))} className="h-4 w-4 shrink-0 accent-primary" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
          </label>) : <p className="p-3 text-sm text-muted-foreground">{emptyMessage}</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

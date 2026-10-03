'use client';

import React, { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ProductInterest } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';

interface Props {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  products: ProductInterest[];
  valueMode?: 'id' | 'name';
  disabled?: boolean;
  labels?: Record<string, string>;
}

/** One catalog-backed selector; name mode preserves the Contact/Account snapshot API. */
export function ProductInterestSelect({ id, values, onChange, products, valueMode = 'id', disabled, labels = {} }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = [...new Set(values)];
  const options = products.map(p => ({ id: p.id, value: valueMode === 'id' ? p.id : p.name, label: p.name }));
  for (const value of selected) if (!options.some(p => p.value === value)) options.push({ id: value, value, label: labels[value] || (valueMode === 'name' ? value : 'Unavailable product') });
  const labelFor = (value: string) => options.find(p => p.value === value)?.label || value;
  return <div className="min-w-0 [&>div]:w-full">
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild><button ref={trigger} id={id} type="button" disabled={disabled} aria-label="Product Interest" className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <span className="min-w-0 [overflow-wrap:anywhere]">{selected.length === 0 ? 'Select product interests…' : selected.length === 1 ? labelFor(selected[0]) : `${selected.length} selected`}</span><ChevronDown className="h-4 w-4 shrink-0" />
      </button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" role="group" aria-label="Product interests" className="w-80" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input'));
          const index = items.indexOf(document.activeElement as HTMLInputElement);
          items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }}>
        <div className="max-h-[min(18rem,60dvh)] overflow-y-auto overscroll-contain">
          {options.length ? options.map((p, index) => <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent focus-within:bg-accent">
            <input autoFocus={index === 0} type="checkbox" disabled={disabled} checked={selected.includes(p.value)} onChange={e => onChange(e.target.checked ? [...new Set([...selected, p.value])] : selected.filter(v => v !== p.value))} className="h-4 w-4 shrink-0 accent-primary" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{p.label}</span>
          </label>) : <p className="p-3 text-sm text-muted-foreground">No configured Product Interests.</p>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function CatalogProductInterestSelect(props: Omit<Props, 'products'>) {
  const { products, loading, error, refresh } = useProductInterests();
  return <><ProductInterestSelect {...props} products={products} disabled={props.disabled || loading || !!error} />{error && <p role="alert" className="text-xs text-destructive">{error} <button type="button" onClick={refresh}>Retry products</button></p>}</>;
}

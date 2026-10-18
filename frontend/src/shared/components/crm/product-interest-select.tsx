'use client';

import React from 'react';
import type { ProductInterest } from '@leadcrm/shared';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { CheckboxDropdownSelect } from '@/shared/components/ui/checkbox-dropdown-select';

interface Props {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  products: ProductInterest[];
  valueMode?: 'id' | 'name';
  disabled?: boolean;
  single?: boolean;
  labels?: Record<string, string>;
  ariaLabel?: string;
  searchable?: boolean;
}

/** One catalog-backed selector; name mode preserves the Contact/Account snapshot API. */
export function ProductInterestSelect({ id, values, onChange, products, valueMode = 'id', disabled, single = false, labels = {}, ariaLabel = 'Product Interest', searchable = false }: Props) {
  const selected = [...new Set(values)];
  const options = products.map(p => ({ value: valueMode === 'id' ? p.id : p.name, label: p.name }));
  for (const value of selected) if (!options.some(p => p.value === value)) options.push({ value, label: labels[value] || (valueMode === 'name' ? value : 'Unavailable product') });
  return <CheckboxDropdownSelect id={id} values={values} options={options} onChange={onChange} disabled={disabled} single={single} searchable={searchable} ariaLabel={ariaLabel} contentAriaLabel="Product interests" placeholder="Select product interests…" emptyMessage="No configured Product Interests." />;
}

export function CatalogProductInterestSelect(props: Omit<Props, 'products'>) {
  const { products, loading, error, refresh } = useProductInterests();
  return <><ProductInterestSelect {...props} products={products} disabled={props.disabled || loading || !!error} />{error && <p role="alert" className="text-xs text-destructive">{error} <button type="button" onClick={refresh}>Retry products</button></p>}</>;
}

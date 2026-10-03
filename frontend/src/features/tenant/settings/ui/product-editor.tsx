'use client';
import { useState } from 'react';
import { ProductInterestSchema, type ProductInterest } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm';
export function ProductEditor({ product, busy, onSave, onCancel }: { product?: ProductInterest; busy: boolean; onSave: (data: { name: string; dealValue: number }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [amount, setAmount] = useState(product ? String(product.dealValue) : '');
  const [error, setError] = useState('');
  return <form className="space-y-3 rounded-lg border border-border p-3" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) { setError('Enter a non-negative amount with up to two decimal places.'); return; }
    const parsed = ProductInterestSchema.safeParse({ name, dealValue: Number(amount.trim()) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(''); await onSave(parsed.data);
  }}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
      <label className="min-w-0 space-y-1 text-xs font-medium">Product Name<input autoFocus className={inputClass} maxLength={200} value={name} disabled={busy} onChange={e => setName(e.target.value)} required /></label>
      <label className="min-w-0 space-y-1 text-xs font-medium">Deal Value (PHP)<span className="relative block"><span className="absolute left-3 top-3 text-sm">₱</span><input className={inputClass + ' pl-7'} aria-label="Deal Value (PHP)" inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} required /></span></label>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Product'}</Button></div>
  </form>;
}


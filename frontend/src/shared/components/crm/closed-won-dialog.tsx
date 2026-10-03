'use client';
import React, { useState } from 'react';
import { CLOSED_WON_CONFIRMATION_TYPES, ClosedWonConfirmationSchema, type ClosedWonConfirmation } from '@leadcrm/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';

export function ClosedWonDialog({ onConfirm, onCancel }: { onConfirm: (value: ClosedWonConfirmation) => void; onCancel: () => void }) {
  const [type, setType] = useState<ClosedWonConfirmation['type'] | ''>('');
  const today = new Date().toLocaleDateString('en-CA');
  const [date, setDate] = useState(today), [note, setNote] = useState(''), [error, setError] = useState('');
  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
      <DialogHeader><DialogTitle>Confirm Closed Won</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Confirm that the sale is finalized. Positive email language alone does not close a Deal.</p>
      <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); const parsed = ClosedWonConfirmationSchema.safeParse({ type, date, note }); if (!parsed.success) { setError(parsed.error.issues[0].message); return; } onConfirm(parsed.data); }}>
        <label className="block text-sm">Confirmation Type
          <select required value={type} onChange={event => setType(event.target.value as ClosedWonConfirmation['type'])} className="mt-1 min-h-11 w-full min-w-0 rounded border bg-background px-2 text-sm">
            <option value="">Select confirmation</option>{CLOSED_WON_CONFIRMATION_TYPES.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="block text-sm">Closed Won Date<input required type="date" max={today} value={date} onChange={event => setDate(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded border bg-background px-2" /></label>
        <label className="block text-sm">{type === 'Other' ? 'Explanation (required)' : 'Note / reference (optional)'}<textarea required={type === 'Other'} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} className="mt-1 min-h-24 w-full rounded border bg-background p-2" /></label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit">Confirm Closed Won</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

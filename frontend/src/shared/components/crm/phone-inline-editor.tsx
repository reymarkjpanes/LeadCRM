'use client';
import React, { useEffect } from 'react';
import { STAFF_PHONE_CONFLICT, CUSTOMER_PHONE_CONFLICT } from '@leadcrm/shared';
import { PhilippinePhoneInput } from '@/shared/components/philippine-phone-input';
import { normalizePhInput, toE164 } from '@/shared/utils/ph-phone';
import { usePhoneAvailability } from '@/shared/hooks/use-phone-availability';

export function PhoneInlineEditor({ module, recordId, value, onChange, disabled, error, onSave, onCancel }: {
  recordId?: string;
  module: 'leads' | 'contacts'; value: string; onChange: (value: string) => void;
  disabled: boolean; error: string; onSave: () => void; onCancel: () => void;
}) {
  const check = usePhoneAvailability(value, module, true, recordId);
  const serverReason = error === STAFF_PHONE_CONFLICT ? 'STAFF_PHONE_NOT_ALLOWED'
    : error === CUSTOMER_PHONE_CONFLICT ? 'CUSTOMER_PHONE_CONFLICT' : undefined;
  useEffect(() => { if (serverReason) check.reject(serverReason); }, [serverReason]);
  return <div className="space-y-1.5">
    <PhilippinePhoneInput value={normalizePhInput(value)} onChange={local => onChange(local ? toE164(local) : '')}
      disabled={disabled} onBlur={check.retry} error={check.error || error} available={check.available} />
    <div className="flex justify-end gap-1">
      <button type="button" className="rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground disabled:opacity-50" disabled={disabled || check.blocked || !!serverReason}
        onClick={() => { if (!serverReason && check.confirm(value)) onSave(); }}>Save</button>
      <button type="button" className="rounded-md border border-border px-2 py-0.5 text-[11px]" disabled={disabled} onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}

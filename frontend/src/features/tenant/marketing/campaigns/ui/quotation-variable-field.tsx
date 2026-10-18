'use client';
import React, { useRef, useState } from 'react';
import { QUOTATION_VARIABLE_GROUPS, type GroupedCampaignVariableChoice } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu';
import { panelInputClass, panelLabelClass } from '@/shared/components/side-panel-styles';
import { insertVariableAtSelection } from '@/shared/utils/insert-variable';
import { CampaignVariablePicker } from './campaign-variable-picker';
export function QuotationVariableField({ id, label, value, onChange, choices, rows = 4 }: {
  id: string; label: string; value: string; onChange: (value: string) => void; choices: GroupedCampaignVariableChoice[]; rows?: number;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  return <div className="min-w-0 space-y-1.5">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-1"><label htmlFor={id} className={panelLabelClass}>{label}</label>
      <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" aria-label={`Insert Variable into ${label}`} className="text-xs">{'{}'} Insert Variable</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="p-0"><CampaignVariablePicker choices={choices} categories={QUOTATION_VARIABLE_GROUPS} onInsert={token => { insertVariableAtSelection(input.current, value, token, onChange); setOpen(false); }} /></DropdownMenuContent>
      </DropdownMenu>
    </div>
    <textarea ref={input} id={id} rows={rows} maxLength={15000} className={panelInputClass} value={value} onChange={event => onChange(event.target.value)} />
  </div>;
}

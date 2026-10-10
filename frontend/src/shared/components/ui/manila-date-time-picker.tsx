'use client';
import { useEffect, useState } from 'react';
import { DatePicker } from './date-time-picker';
import { Button } from './button';
import { panelInputClass } from '../side-panel-styles';
import { manilaCurrentDate, isPastManilaTaskDueDateTime, resolveManilaTaskDueDateTime } from '@/lib/manila-time';

/** The Task picker keeps temporary edits until Done. Email schedules additionally
 * reject elapsed times today, while Tasks retain their next-occurrence behavior. */
export function ManilaDateTimePicker({ value, onDone, onCancel, rollPastToday = false, busy = false, label = 'Choose scheduled date and time', prefix = 'Schedule', id }: {
  value: string; onDone: (value: string) => void; onCancel: () => void; rollPastToday?: boolean; busy?: boolean; label?: string; prefix?: string; id?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [, refreshClock] = useState(0);
  useEffect(() => { const timer = setInterval(() => refreshClock(value => value + 1), 1000); return () => clearInterval(timer); }, []);
  const resolved = rollPastToday ? resolveManilaTaskDueDateTime(draft) : draft;
  let valid = false;
  try { valid = !!resolved && resolved.slice(0, 10) >= manilaCurrentDate() && !isPastManilaTaskDueDateTime(resolved); } catch { /* Invalid partial input. */ }
  const hour = Number(draft.slice(11, 13) || 0);
  const changeTime = (nextHour: number, minute = draft.slice(14, 16) || '00') => setDraft(`${draft.slice(0, 10)}T${String(nextHour).padStart(2, '0')}:${minute}`);
  return <div id={id} role="group" aria-label={label} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-2 sm:p-3" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <DatePicker inline value={draft.slice(0, 10)} minDate={manilaCurrentDate()} todayDate={manilaCurrentDate()} onChange={date => setDraft(`${date}T${draft.slice(11)}`)} />
    <div className="grid min-w-0 grid-cols-3 gap-2">
      <label className="min-w-0 text-xs">Hour<select aria-label={`${prefix} hour`} className={panelInputClass + ' !px-2'} value={hour % 12 || 12} onChange={event => changeTime(Number(event.target.value) % 12 + (hour >= 12 ? 12 : 0))}>{Array.from({ length: 12 }, (_, i) => i + 1).map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="min-w-0 text-xs">Minute<select aria-label={`${prefix} minute`} className={panelInputClass + ' !px-2'} value={draft.slice(14, 16)} onChange={event => changeTime(hour, event.target.value)}>{Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="min-w-0 text-xs">AM/PM<select aria-label={`${prefix} period`} className={panelInputClass + ' !px-2'} value={hour >= 12 ? 'PM' : 'AM'} onChange={event => changeTime(hour % 12 + (event.target.value === 'PM' ? 12 : 0))}><option>AM</option><option>PM</option></select></label>
    </div>
    {resolved !== draft && <p className="text-xs text-muted-foreground">Next occurrence: {resolved.replace('T', ' ')}</p>}
    {!valid && <p className="text-xs text-red-600">Choose a future date and time.</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="button" disabled={!valid || busy} onClick={() => { if (valid) onDone(resolved); }}>{busy ? 'Saving…' : 'Done'}</Button></div>
  </div>;
}

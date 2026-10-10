'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ThemedPortal } from '@/shared/components/theme-scope';
import { ChevronLeft, ChevronRight, Calendar, Clock } from 'lucide-react';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  minDate?: string;
  inline?: boolean;
  todayDate?: string;
  placeholder?: string;
  id?: string;
}

interface TimePickerProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
  id?: string;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

function formatDisplayTime(time: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export function DatePicker({ value, onChange, minDate, inline = false, todayDate, placeholder = 'Select date', id }: DatePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || inline) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [open, inline]);

  const today = new Date();
  const todayStr = todayDate || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const initial = new Date((value || todayStr) + 'T00:00:00');
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const min = minDate || todayStr;

  function isDisabled(dateStr: string): boolean {
    return dateStr < min;
  }

  function handleOpen(): void {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const calendarWidth = 256;
      const clampedLeft = Math.min(rect.left, window.innerWidth - calendarWidth - 8);
      setPos({ top: rect.bottom + 6, left: Math.max(8, clampedLeft) });
    }
    setOpen(true);
  }

  function prevMonth(): void {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth(): void {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  function selectDay(day: number): void {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isDisabled(dateStr)) { onChange(dateStr); setOpen(false); }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const calendar = (
          <div
            className={`${inline ? "w-full" : "fixed z-300 w-64"} bg-card border border-border rounded-lg shadow-xl p-3`}
            style={inline ? undefined : { top: pos.top, left: pos.left }}
          >
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 cursor-pointer transition-colors duration-200" aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-foreground">{MONTHS[viewMonth]} {viewYear}</span>
              <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 cursor-pointer transition-colors duration-200" aria-label="Next month">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => <div key={d} className="text-center text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 py-1">{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;
                const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const disabled = isDisabled(dateStr);
                const selected = dateStr === value;
                const isToday = dateStr === todayStr;
                return (
                  <button
                    key={dateStr}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectDay(day)}
                    className={`h-8 ${inline ? 'w-full max-w-8' : 'w-8'} mx-auto rounded-md text-xs font-medium transition-all duration-200
                      ${disabled ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'cursor-pointer hover:bg-primary/10'}
                      ${selected ? 'bg-primary text-white hover:bg-primary/90' : ''}
                      ${isToday && !selected ? 'border border-primary/50 text-primary' : ''}
                      ${!selected && !disabled && !isToday ? 'text-slate-700 dark:text-slate-200' : ''}
                    `}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
  );

  return (
    <div className="relative">
      {!inline && <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => open ? setOpen(false) : handleOpen()}
        className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm text-left flex items-center gap-2 text-foreground cursor-pointer focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 transition-all duration-200"
      >
        <Calendar size={14} className="text-slate-400 shrink-0" />
        <span className={value ? '' : 'text-slate-400'}>{value ? formatDisplayDate(value) : placeholder}</span>
      </button>}

      {(inline || open) && (inline ? calendar : <ThemedPortal>{<>
          <div className="fixed inset-0 z-299" onClick={() => setOpen(false)} />
          {calendar}
        </>}</ThemedPortal>)}
    </div>
  );
}

function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

export function TimePicker({ value, onChange, placeholder = 'Select time', id }: TimePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [open]);

  useEffect(() => {
    if (open && listRef.current && value) {
      const idx = TIME_SLOTS.indexOf(value);
      if (idx > -1) listRef.current.scrollTop = idx * 36 - 72;
    }
  }, [open, value]);

  function handleOpen(): void {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
    setOpen(true);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => open ? setOpen(false) : handleOpen()}
        className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm text-left flex items-center gap-2 text-foreground cursor-pointer focus:outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20 transition-all duration-200"
      >
        <Clock size={14} className="text-slate-400 shrink-0" />
        <span className={value ? '' : 'text-slate-400'}>{value ? formatDisplayTime(value) : placeholder}</span>
      </button>

      {open && <ThemedPortal>{<>
          <div className="fixed inset-0 z-299" onClick={() => setOpen(false)} />
          <div
            className="fixed z-300 w-44 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
            style={{ top: pos.top, left: pos.left }}
          >
            <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
              {TIME_SLOTS.map(slot => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => { onChange(slot); setOpen(false); }}
                  className={`w-full h-9 px-3 text-sm text-left cursor-pointer transition-colors duration-200
                    ${slot === value
                      ? 'bg-primary text-white font-medium'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-primary/10'
                    }
                  `}
                >
                  {formatDisplayTime(slot)}
                </button>
              ))}
            </div>
          </div>
        </>}</ThemedPortal>}
    </div>
  );
}

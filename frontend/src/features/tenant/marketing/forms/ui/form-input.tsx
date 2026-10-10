'use client';
import type { CSSProperties } from 'react';
import type { FormField, FormDesign } from '@leadcrm/shared';
export function FormInput({ field: f, value = '', onChange, error, design }: { field: FormField; value?: string | boolean | string[]; onChange: (v: string | boolean | string[]) => void; error?: string; design: FormDesign }) {
  const id = 'input-' + f.id;
  if (f.type === 'heading') return <h2 className="text-2xl font-bold break-words">{f.label}</h2>;
  if (f.type === 'paragraph') return <p className="whitespace-pre-wrap break-words">{f.label}</p>;
  if (f.type === 'divider') return <hr />;
  const style: CSSProperties = { backgroundColor: design.fieldBg || '#ffffff', borderColor: design.fieldBorder || '#cbd5e1', color: design.fieldText || '#0f172a',
    borderRadius: { none: 0, sm: 4, md: 6, lg: 12, full: 24 }[design.fieldRadius], padding: design.fieldSize === 'lg' ? 12 : design.fieldSize === 'sm' ? 6 : 9 };
  const props = { id, 'aria-invalid': !!error, 'aria-describedby': error ? id + '-error' : undefined, required: f.required, className: 'w-full min-w-0 max-w-full border focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm', style };
  const phone = ['phone', 'contact-phone'].includes(f.type);
  const string = typeof value === 'string' ? value : '';
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-medium mb-1 break-words">{f.label}{f.required && <span className="text-red-600" aria-hidden="true"> *</span>}</label>
    {f.mapToField === 'productInterest' ? <div id={id} tabIndex={-1} role="group" aria-label={f.label} className="max-h-60 overflow-y-auto rounded border p-2">{f.options?.map(option => { const selected = Array.isArray(value) ? value : string ? [string] : []; return <label key={option} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(option)} onChange={e => onChange(e.target.checked ? [...selected, option] : selected.filter(v => v !== option))} />{f.optionLabels?.[option] ?? option}</label>; })}</div> : f.type === 'multi-line' ? <textarea {...props} rows={3} maxLength={4000} placeholder={f.placeholder} value={string} onChange={e => onChange(e.target.value)} />
      : f.type === 'dropdown' || f.type === 'rating' ? <select {...props} value={string} onChange={e => onChange(e.target.value)}><option value="">{f.placeholder || 'Select an option'}</option>{(f.type === 'rating' ? ['1','2','3','4','5'] : f.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>
      : f.type === 'radio' ? <div role="radiogroup" aria-label={f.label} aria-describedby={props['aria-describedby']}>{f.options?.map((o, i) => <label key={o} className="flex gap-2 py-1 text-sm"><input id={i === 0 ? id : id + i} type="radio" name={id} value={o} checked={string === o} onChange={() => onChange(o)} />{o}</label>)}</div>
      : f.type === 'checkbox' ? <input {...props} style={undefined} className="h-5 w-5" type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
      : phone ? <div className="flex min-w-0 items-center"><span className="text-xs shrink-0 border border-r-0 rounded-l p-2.5 bg-slate-50 text-slate-700">PH (+63)</span><input {...props} type="tel" inputMode="numeric" maxLength={10} pattern="9[0-9]{9}" placeholder="9XXXXXXXXX" value={string.replace(/^\+63/, '')} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
      : <input {...props} type={['email', 'contact-email'].includes(f.type) ? 'email' : ['url', 'company-website'].includes(f.type) ? 'url' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} maxLength={254} placeholder={f.placeholder} value={string} onChange={e => onChange(e.target.value)} />}
    {error && <p id={id + '-error'} className="mt-1 text-sm text-red-600 break-words">{error}</p>}
  </div>;
}

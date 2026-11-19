'use client';
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { Input } from '@/shared/components/ui/input';

type ConditionSelectProps = Pick<SelectHTMLAttributes<HTMLSelectElement>, 'aria-required' | 'aria-invalid' | 'aria-describedby'>;

export function ConditionFieldSelect({ fields, value, onChange, className, id, disabled, required, label = 'Field', ...ariaProps }: ConditionSelectProps & { fields: { key: string; label: string; group?: string; disabled?: boolean }[]; value: string; onChange: (value: string) => void; className?: string; id?: string; disabled?: boolean; required?: boolean; label?: string }) {
  const groups = [...new Set(fields.map(field => field.group || 'Fields'))];
  return <select {...ariaProps} id={id} disabled={disabled} aria-required={required || ariaProps['aria-required']} aria-label={label} className={className} value={value} onChange={event => onChange(event.target.value)}><option value="">Choose a field</option>{value && !fields.some(field => field.key === value) && <option value={value}>Unavailable field — repair required</option>}{groups.map(group => <optgroup key={group} label={group}>{fields.filter(field => (field.group || 'Fields') === group).map(field => <option key={field.key} value={field.key} disabled={field.disabled}>{field.label}</option>)}</optgroup>)}</select>;
}
export function ConditionOperatorSelect({ operators, value, onChange, className, id, disabled, label = 'Operator', ...ariaProps }: ConditionSelectProps & { operators: { key: string; label: string }[]; value: string; onChange: (value: string) => void; className?: string; id?: string; disabled?: boolean; label?: string }) {
  return <select {...ariaProps} id={id} disabled={disabled} aria-label={label} className={className} value={value} onChange={event => onChange(event.target.value)}>{!value && <option value="">Choose an operator</option>}{value && !operators.some(operator => operator.key === value) && <option value={value}>Unavailable operator — repair required</option>}{operators.map(operator => <option key={operator.key} value={operator.key}>{operator.label}</option>)}</select>;
}
export function ConditionScalarInput({ value, onValueChange, type = 'text', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: unknown; onValueChange: (value: string | number) => void }) {
  return <Input placeholder={type === 'text' ? 'Enter a value...' : undefined} {...props} type={type} step={type === 'number' ? 'any' : undefined} value={String(value ?? '')} onChange={event => onValueChange(type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />;
}

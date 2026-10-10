'use client';

import { StrongPasswordSchema } from '@leadcrm/shared';
import React, { useMemo } from 'react';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Password requirement rules ───────────────────────────────────────────────
// Each rule maps to a boolean test against the candidate password.
// Display hints mirror the shared schema, which owns submit validation.

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: p => p.length >= 8 && p.length <= 72 && new TextEncoder().encode(p).length <= 72 },
  { id: 'uppercase', label: 'One uppercase letter', test: p => /[A-Z]/.test(p) },
  { id: 'lowercase', label: 'One lowercase letter', test: p => /[a-z]/.test(p) },
  { id: 'number', label: 'One number', test: p => /\d/.test(p) },
  { id: 'special', label: 'One special character', test: p => /[^a-zA-Z0-9\s]/.test(p) },
];

/** True only when every password rule passes. Used by the form to gate submit. */
export function isPasswordValid(password: string): boolean {
  return StrongPasswordSchema.safeParse(password).success;
}

/** Number of satisfied rules — drives the segmented strength bar. */
function countSatisfied(password: string): number {
  return PASSWORD_RULES.filter((rule) => rule.test(password)).length;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PasswordStrengthMeterProps {
  password: string;
  /** Hide the whole meter when the field is empty (default: true). */
  hideWhenEmpty?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Displays one strength segment per requirement and an accessible checklist. */
export function PasswordStrengthMeter({
  password,
  hideWhenEmpty = true,
}: PasswordStrengthMeterProps): React.ReactElement | null {
  const satisfied = useMemo(() => countSatisfied(password), [password]);

  if (hideWhenEmpty && password.length === 0) return null;

  const total = PASSWORD_RULES.length;

  const strengthLabel = ['Very weak', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'][satisfied];
  const color = satisfied === total ? 'bg-emerald-500' : satisfied >= 3 ? 'bg-amber-500' : 'bg-rose-500';
  return <div className="mt-3 space-y-2" aria-live="polite">
    <div role="progressbar" aria-label="Password requirements met" aria-valuemin={0} aria-valuemax={total} aria-valuenow={satisfied} aria-valuetext={strengthLabel} className="flex gap-1">
      {PASSWORD_RULES.map((rule, index) => <span key={rule.id} className={cn('h-1.5 min-w-0 flex-1 rounded-full transition-colors', index < satisfied ? color : 'bg-slate-200 dark:bg-slate-700')} />)}
    </div>
    <p className={cn('text-xs font-medium', satisfied === total ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500')}>{strengthLabel}</p>
    <ul className="pt-2 text-xs space-y-2">{PASSWORD_RULES.map(rule => <li key={rule.id} className={cn('flex items-center gap-2', rule.test(password) ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>{rule.test(password) ? <Check className="shrink-0" size={14} aria-label="Met" /> : <Circle className="shrink-0" size={14} aria-label="Not met" />}{rule.label}</li>)}</ul>
    {password && new TextEncoder().encode(password).length > 72 && <p role="alert" className="text-xs text-red-600">Password must be no more than 72 bytes.</p>}
  </div>;
}

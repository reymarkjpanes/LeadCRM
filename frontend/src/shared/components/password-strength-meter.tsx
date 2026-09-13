'use client';

import React, { useMemo } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Password requirement rules ───────────────────────────────────────────────
// Each rule maps to a boolean test against the candidate password.
// These are the single source of truth for both the UI checklist and the
// isPasswordValid() helper the register form uses for submit gating.

export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'uppercase', label: 'At least 1 uppercase', test: (p) => /[A-Z]/.test(p) },
  { id: 'number',    label: 'At least 1 number',    test: (p) => /[0-9]/.test(p) },
  { id: 'special',   label: 'At least 1 special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
  { id: 'length',    label: 'At least 8 characters', test: (p) => p.length >= 8 },
];

/** True only when every password rule passes. Used by the form to gate submit. */
export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
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

/**
 * PasswordStrengthMeter
 *
 * Renders a 3-segment strength bar plus a live requirement checklist:
 *   ✓ At least 1 uppercase
 *   ✓ At least 1 number
 *   ✓ At least 8 characters
 *
 * Segment colors: 1 rule → red (Weak), 2 rules → amber (Fair), 3 rules → green (Strong).
 * Satisfied rules show a green check; unmet rules show a muted X.
 */
export function PasswordStrengthMeter({
  password,
  hideWhenEmpty = true,
}: PasswordStrengthMeterProps): React.ReactElement | null {
  const satisfied = useMemo(() => countSatisfied(password), [password]);

  if (hideWhenEmpty && password.length === 0) return null;

  const total = PASSWORD_RULES.length;

  const strengthLabel =
    satisfied <= 1 ? 'Weak password. Must contain:'
    : satisfied < total ? 'Fair password. Must contain:'
    : 'Strong password';

  // Segment fill color based on how many rules pass.
  const segmentColor = (index: number): string => {
    if (index >= satisfied) return 'bg-gray-200 dark:bg-slate-700';
    if (satisfied <= 1) return 'bg-red-500';
    if (satisfied < total) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      {/* Segmented strength bar */}
      <div className="flex gap-1.5">
        {PASSWORD_RULES.map((_, index) => (
          <div
            key={index}
            className={cn('h-1 flex-1 rounded-full transition-colors', segmentColor(index))}
          />
        ))}
      </div>

      {/* Strength label */}
      <p
        className={cn(
          'text-xs font-medium',
          satisfied <= 1 && 'text-red-500',
          satisfied === 2 && 'text-amber-600 dark:text-amber-400',
          satisfied === total && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {strengthLabel}
      </p>

      {/* Requirement checklist — only show while not fully satisfied */}
      {satisfied < total && (
        <ul className="space-y-1.5">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(password);
            return (
              <li key={rule.id} className="flex items-center gap-2 text-xs">
                {met ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" aria-hidden="true" />
                )}
                <span className={cn(met ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500')}>
                  {rule.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

import React from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

interface AccessibleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function AccessibleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: AccessibleSwitchProps): React.ReactElement {
  const shouldReduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
        'w-10 h-[22px]',
        checked ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'cursor-pointer'
      )}
    >
      <span
        className={cn(
          'inline-block w-4 h-4 bg-white rounded-full shadow-sm ml-[3px]',
          shouldReduceMotion ? '' : 'transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-0'
        )}
      />
    </button>
  );
}

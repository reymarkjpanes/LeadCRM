'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageSizeSelectProps {
  value: number;
  onChange: (size: number) => void;
  options?: number[];
  disabled?: boolean;
}

export function PageSizeSelect({ value, onChange, options = [10, 20, 25, 50, 100], disabled }: PageSizeSelectProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey); };
  }, [isOpen]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Records per page"
      >
        {value}
        <ChevronDown size={12} className={cn('text-slate-400 transition-transform duration-150', isOpen && 'rotate-180')} />
      </button>

      {isOpen && !disabled && (
        <div className="absolute bottom-full left-0 mb-1 w-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1" role="listbox">
          {options.map((size) => (
            <button
              key={size}
              type="button"
              role="option"
              aria-selected={value === size}
              onClick={() => { onChange(size); setIsOpen(false); }}
              className={cn(
                'w-full px-3 py-1.5 text-xs text-left transition-colors',
                value === size
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700',
              )}
            >
              {size}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

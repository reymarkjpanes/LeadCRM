'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

export interface BackButtonProps {
  label?: string;
  onClick?: () => void;
  href?: string;
  className?: string;
  variant?: 'default' | 'ghost' | 'subtle';
  ariaLabel?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({
  label = 'Back',
  onClick,
  href,
  className = '',
  variant = 'default',
  ariaLabel,
}) => {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (onClick) {
      onClick();
      return;
    }
    if (href) {
      router.push(href);
      return;
    }
    router.back();
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'ghost':
        return 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 border-transparent';
      case 'subtle':
        return 'bg-slate-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 border-slate-200/60 dark:border-white/10';
      case 'default':
      default:
        return 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850 hover:text-primary dark:hover:text-blue-400 border border-slate-200 dark:border-white/10 shadow-xs';
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel || label}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer ${getVariantStyles()} ${className}`}
    >
      <ChevronLeft size={16} className="shrink-0 text-slate-400 dark:text-slate-400 group-hover:text-blue-500 transition-colors" />
      {label && <span>{label}</span>}
    </button>
  );
};

export default BackButton;

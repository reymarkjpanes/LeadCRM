'use client';

import React from 'react';
import { X } from 'lucide-react';

export interface ModalCloseButtonProps {
  onClose: () => void;
  className?: string;
  size?: number;
  variant?: 'default' | 'filled' | 'ghost';
  ariaLabel?: string;
}

export const ModalCloseButton: React.FC<ModalCloseButtonProps> = ({
  onClose,
  className = '',
  size = 18,
  variant = 'default',
  ariaLabel = 'Close modal',
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'filled':
        return 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700';
      case 'ghost':
        return 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-transparent';
      case 'default':
      default:
        return 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80';
    }
  };

  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`p-2 rounded-xl transition-all duration-150 active:scale-95 outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer ${getVariantStyles()} ${className}`}
    >
      <X size={size} className="shrink-0" />
    </button>
  );
};

export default ModalCloseButton;

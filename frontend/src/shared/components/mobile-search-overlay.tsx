'use client';

import React from 'react';
import { X, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GlobalOmnibox } from './global-omnibox';
import { cn } from '@/lib/utils';

interface MobileSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileSearchOverlay({ isOpen, onClose }: MobileSearchOverlayProps): React.ReactElement {
  // Close on Escape key
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — closes on tap */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/40 md:hidden"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-down panel */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={cn(
              'fixed top-0 inset-x-0 z-[61] md:hidden',
              'bg-[var(--surface)] border-b border-[var(--border)]',
              'px-4 pt-3 pb-4 shadow-xl',
            )}
            role="search"
            aria-label="Global search"
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <Search size={16} className="text-[var(--text-tertiary)]" aria-hidden="true" />
                <span className="text-sm font-semibold">Search</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
                aria-label="Close search"
              >
                <X size={18} />
              </button>
            </div>

            {/* GlobalOmnibox with autoFocus so the input is focused when the overlay opens */}
            <GlobalOmnibox autoFocus={isOpen} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

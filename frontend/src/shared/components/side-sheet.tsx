'use client';
import { panelThemeClass, panelHeaderClass, panelTitleClass, panelCloseClass } from '@/shared/components/side-panel-styles';

import React, { ReactNode, useId, useRef } from 'react';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { OverlayOwnerContext, ThemedPortal } from '@/shared/components/theme-scope';
import { AnimatePresence, motion } from 'motion/react';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';

interface SideSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}

export function SideSheet({ isOpen, onClose, title, subtitle, children, width = 'w-full max-w-lg md:max-w-xl' }: SideSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const owner = useId();
  const titleId = useId();
  useModalInteraction({ open: isOpen, panelRef, owner, onClose });

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-200"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed inset-y-0 right-0 h-dvh ${width} ${panelThemeClass} shadow-2xl z-210 flex flex-col border-l border-gray-200 dark:border-white/10`}
          >
            {/* Header */}
            <div className={panelHeaderClass + " flex items-center justify-between gap-3"}>
              <div className="min-w-0">
                <h2 id={titleId} className={panelTitleClass}>{title}</h2>
                {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
              </div>
              <ModalCloseButton onClose={onClose} ariaLabel="Close sheet" size={20} className={panelCloseClass + " grid place-items-center"} />
            </div>

            {/* Body Container */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof window === 'undefined') return null;
  return <OverlayOwnerContext.Provider value={owner}><ThemedPortal>{content}</ThemedPortal></OverlayOwnerContext.Provider>;
}

'use client';
import { panelThemeClass, panelHeaderClass, panelTitleClass, panelCloseClass } from '@/shared/components/side-panel-styles';

import React, { ReactNode, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ModalCloseButton } from '@/shared/components/ui/modal-close-button';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { OverlayOwnerContext, ThemedPortal } from '@/shared/components/theme-scope';

interface SlidingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
  headerActions?: ReactNode;
}

export function SlidingDrawer({
  isOpen,
  onClose,
  title,
  eyebrow,
  subtitle,
  children,
  width = 'w-full max-w-lg md:max-w-xl',
  headerActions,
}: SlidingDrawerProps) {
  const owner = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalInteraction({ open: isOpen, panelRef, owner, onClose });

  return (
    <OverlayOwnerContext.Provider value={owner}><ThemedPortal><AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Blur Overlay */}
          <motion.div
            id="sliding-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[100] cursor-pointer"
          />

          {/* Sliding Drawer Container */}
          <motion.div
            ref={panelRef}
            id="sliding-drawer-container"
            role="dialog"
            aria-modal="true"
            aria-label={title || 'Record editor'}
            tabIndex={-1}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={`fixed inset-y-0 right-0 h-dvh ${width} ${panelThemeClass} shadow-[0_0_50px_0_rgba(0,0,0,0.15)] dark:shadow-[0_0_50px_0_rgba(0,0,0,0.3)] z-[110] flex flex-col border-l border-slate-200 dark:border-white/10`}
          >
            {/* Drawer Header */}
            <div className={panelHeaderClass + " flex items-center justify-between gap-3"}>
              <div className="min-w-0">
                {eyebrow && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>}
                {title ? (
                  <h2 className={panelTitleClass}>
                    {title}
                  </h2>
                ) : (
                  <div className="h-6" />
                )}
                {subtitle && (
                  <p className="text-sm text-slate-500 mt-1 dark:text-slate-400 font-medium">
                    {subtitle}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {headerActions}
                <ModalCloseButton onClose={onClose} ariaLabel="Close drawer" size={20} className={panelCloseClass + " grid place-items-center"} />
              </div>
            </div>

            {/* Scrollable Drawer Body Content */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence></ThemedPortal></OverlayOwnerContext.Provider>
  );
}

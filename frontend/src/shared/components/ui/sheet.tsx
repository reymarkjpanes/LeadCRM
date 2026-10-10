'use client';

import * as React from 'react';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { OverlayOwnerContext, ThemedPortal } from '@/shared/components/theme-scope';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SheetContext = React.createContext<SheetContextValue | null>(null);

export function useSheet() {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error('useSheet must be used within a Sheet component');
  }
  return context;
}

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Sheet({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(newOpen);
      }
      onOpenChange?.(newOpen);
    },
    [isControlled, onOpenChange]
  );

  return (
    <SheetContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      {children}
    </SheetContext.Provider>
  );
}

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showClose?: boolean;
  closeClassName?: string;
  trapFocus?: boolean;
  layerClassName?: string;
  children: React.ReactNode;
}

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = 'right', showClose = true, closeClassName, trapFocus = true, layerClassName, ...props }, ref) => {
    const { open, onOpenChange } = useSheet();
    const [mounted, setMounted] = React.useState(false);
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const owner = React.useId();

    React.useEffect(() => {
      setMounted(true);
    }, []);

    useModalInteraction({ open: open && mounted, panelRef, owner, trapFocus, onClose: () => onOpenChange(false) });

    if (!mounted) return null;

    const variants = {
      right: {
        initial: { x: '100%' },
        animate: { x: 0 },
        exit: { x: '100%' },
      },
      left: {
        initial: { x: '-100%' },
        animate: { x: 0 },
        exit: { x: '-100%' },
      },
      top: {
        initial: { y: '-100%' },
        animate: { y: 0 },
        exit: { y: '-100%' },
      },
      bottom: {
        initial: { y: '100%' },
        animate: { y: 0 },
        exit: { y: '100%' },
      },
    };

    const sideClasses = {
      right: 'fixed inset-y-0 right-0 h-dvh w-full max-w-full sm:max-w-[540px] border-l border-border',
      left: 'fixed inset-y-0 left-0 h-dvh w-full max-w-full sm:max-w-[540px] border-r border-border',
      top: 'fixed inset-x-0 top-0 w-full border-b border-border',
      bottom: 'fixed inset-x-0 bottom-0 w-full border-t border-border',
    };

    const content = (
      <AnimatePresence>
        {open && (
          <div className={cn('fixed inset-0 z-50 flex justify-end', layerClassName)}>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => onOpenChange(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm"
              aria-hidden="true"
            />

            {/* Panel */}
            <motion.div
              ref={node => {
                panelRef.current = node;
                if (typeof ref === 'function') ref(node);
                else if (ref) ref.current = node;
              }}
              tabIndex={trapFocus ? -1 : undefined}
              role="dialog"
              aria-modal="true"
              initial={variants[side].initial}
              animate={variants[side].animate}
              exit={variants[side].exit}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className={cn(
                'z-50 min-h-0 min-w-0 flex flex-col overflow-y-auto overscroll-contain bg-background text-foreground shadow-panel',
                sideClasses[side],
                className
              )}
              {...(props as any)}
            >
              {showClose && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close sheet"
                  className={cn('absolute right-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', closeClassName)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );

    return <OverlayOwnerContext.Provider value={owner}><ThemedPortal>{content}</ThemedPortal></OverlayOwnerContext.Provider>;
  }
);
SheetContent.displayName = 'SheetContent';

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 p-5 text-left', className)}
      {...props}
    />
  );
}
SheetHeader.displayName = 'SheetHeader';

export function SheetTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-lg font-semibold tracking-tight text-foreground', className)}
      {...props}
    />
  );
}
SheetTitle.displayName = 'SheetTitle';

export function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
SheetDescription.displayName = 'SheetDescription';

export function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-2 p-5 border-t border-border', className)}
      {...props}
    />
  );
}
SheetFooter.displayName = 'SheetFooter';

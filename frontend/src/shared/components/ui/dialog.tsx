'use client';

import * as React from 'react';
import { useModalInteraction } from '@/shared/hooks/use-modal-interaction';
import { OverlayOwnerContext, ThemedPortal } from '@/shared/components/theme-scope';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

export function useDialog() {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a Dialog component');
  }
  return context;
}

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DialogProps) {
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
    <DialogContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogTrigger({
  asChild,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { onOpenChange } = useDialog();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!e.defaultPrevented) {
      onOpenChange(true);
    }
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: (e: any) => {
        (children as any).props.onClick?.(e);
        if (!e.defaultPrevented) {
          onOpenChange(true);
        }
      },
    });
  }

  return (
    <button type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
}

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  showClose?: boolean;
  trapFocus?: boolean;
  closeClassName?: string;
  children: React.ReactNode;
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, showClose = true, trapFocus = true, closeClassName, ...props }, ref) => {
    const { open, onOpenChange } = useDialog();
    const [mounted, setMounted] = React.useState(false);
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const owner = React.useId();

    React.useEffect(() => {
      setMounted(true);
    }, []);

    useModalInteraction({ open: open && mounted, panelRef, owner, trapFocus, onClose: () => onOpenChange(false) });

    if (!mounted) return null;

    const content = (
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-2 sm:p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => onOpenChange(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              aria-hidden="true"
            />

            {/* Dialog Panel */}
            <motion.div
              ref={node => {
                panelRef.current = node;
                if (typeof ref === 'function') ref(node);
                else if (ref) ref.current = node;
              }}
              tabIndex={trapFocus ? -1 : undefined}
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className={cn(
                'relative z-[260] min-w-0 w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-4 sm:p-6 text-card-foreground shadow-2xl',
                className
              )}
              {...(props as any)}
            >
              {showClose && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close dialog"
                  className={cn('absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', closeClassName)}
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
DialogContent.displayName = 'DialogContent';

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 text-left', className)}
      {...props}
    />
  );
}
DialogHeader.displayName = 'DialogHeader';

export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-base font-semibold leading-none tracking-tight text-foreground', className)}
      {...props}
    />
  );
}
DialogTitle.displayName = 'DialogTitle';

export function DialogDescription({
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
DialogDescription.displayName = 'DialogDescription';

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-6 flex flex-wrap items-center justify-end gap-2', className)}
      {...props}
    />
  );
}
DialogFooter.displayName = 'DialogFooter';

export function DialogClose({
  asChild,
  className,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { onOpenChange } = useDialog();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!e.defaultPrevented) {
      onOpenChange(false);
    }
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: (e: any) => {
        (children as any).props.onClick?.(e);
        if (!e.defaultPrevented) {
          onOpenChange(false);
        }
      },
    });
  }

  return (
    <button
      type="button"
      className={cn('', className)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}
DialogClose.displayName = 'DialogClose';


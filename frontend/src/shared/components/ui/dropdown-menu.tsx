'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

export function useDropdownMenu() {
  const context = React.useContext(DropdownMenuContext);
  if (!context) {
    throw new Error('useDropdownMenu must be used within a DropdownMenu');
  }
  return context;
}

export function DropdownMenu({ children, open: controlledOpen, onOpenChange }: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback((value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  }, [controlledOpen, onOpenChange]);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { open, setOpen, triggerRef } = useDropdownMenu();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    props.onClick?.(e);
    if (!e.defaultPrevented) setOpen(!open);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      ref: (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        const childRef = (children as React.ReactElement<{ ref?: React.Ref<HTMLButtonElement> }>).props.ref;
        if (typeof childRef === 'function') childRef(node);
        else if (childRef) childRef.current = node;
      },
      'aria-expanded': open,
      'aria-haspopup': 'menu',
      onClick: (e: any) => {
        (children as any).props.onClick?.(e);
        handleClick(e);
      },
    });
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={open}
      aria-haspopup="true"
      {...props}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  children,
  ...props
}: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef } = useDropdownMenu();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [position, setPosition] = React.useState({ top: 0, left: 8 });

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Click outside to close
  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, setOpen, triggerRef]);

  React.useLayoutEffect(() => {
    if (!mounted || !open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const menu = contentRef.current;
      if (!rect || !menu) return;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = align === 'end' ? rect.right - width : align === 'center' ? rect.left + (rect.width - width) / 2 : rect.left;
      const below = rect.bottom + sideOffset;
      const top = below + height <= window.innerHeight - 8 ? below : rect.top - sideOffset - height;
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - height - 8)) });
    };
    updatePosition();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePosition) : null;
    if (contentRef.current) observer?.observe(contentRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [mounted, open, align, sideOffset, triggerRef]);

  if (!mounted || !open) return null;

  const content = (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] pointer-events-none">
        <motion.div
          ref={contentRef}
          role="menu"
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.12 }}
          style={{ ...position, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 16px)' }}
          className={cn(
            'pointer-events-auto absolute z-[300] min-w-[12rem] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            className
          )}
          {...(props as any)}
        >
          {children}
        </motion.div>
      </div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

export interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export function DropdownMenuItem({
  className,
  destructive = false,
  disabled = false,
  onSelect,
  onClick,
  children,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenu();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    onClick?.(e);
    onSelect?.();
    setOpen(false);
  };

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as any);
        }
      }}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
        destructive && 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10 hover:text-destructive focus:text-destructive',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator({ className }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('-mx-1 my-1 h-px bg-border', className)} />;
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-2.5 py-1.5 text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}

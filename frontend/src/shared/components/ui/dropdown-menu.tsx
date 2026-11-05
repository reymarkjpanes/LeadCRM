'use client';

import * as React from 'react';
import { ThemedPortal } from '@/shared/components/theme-scope';
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    props.onKeyDown?.(e);
    if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setOpen(!open); }
    if (!e.defaultPrevented && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); e.stopPropagation(); setOpen(true); }
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      ref: (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        const childRef = (children as React.ReactElement<{ ref?: React.Ref<HTMLButtonElement> }>).props.ref;
        if (typeof childRef === 'function') childRef(node);
        else if (childRef) childRef.current = node;
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => { (children as React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>).props.onKeyDown?.(e); handleKeyDown(e); },
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
      aria-haspopup="menu"
      {...props}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Searchable pickers keep keyboard focus in their controls until selection/Escape. */
  formContent?: boolean;
  /** Prefer the checked, enabled item when initially focusing this menu. */
  focusSelectedItem?: boolean;
}

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  formContent = false,
  focusSelectedItem = false,
  style,
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
      if (formContent && contentRef.current?.contains(e.target as Node) && e.key === 'Tab') {
        const controls = Array.from(contentRef.current.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]'));
        const current = controls.indexOf(document.activeElement as HTMLElement);
        if (controls.length) {
          e.preventDefault(); e.stopPropagation();
          controls[(current + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
        }
        return;
      }
      if (contentRef.current?.contains(e.target as Node) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        if (formContent && e.target instanceof HTMLInputElement && ['Home', 'End'].includes(e.key)) return;
        const items = Array.from(contentRef.current.querySelectorAll<HTMLElement>('[role^="menuitem"][aria-disabled="false"]'));
        // Groups such as Product Interest own their checkbox navigation.
        if (!items.length) return;
        e.preventDefault(); e.stopPropagation();
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items.forEach((item, index) => { item.tabIndex = index === next ? 0 : -1; });
        items[next]?.focus(); items[next]?.scrollIntoView?.({ block: 'nearest' });
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
      if (e.key === 'Tab') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, setOpen, triggerRef, formContent]);

  React.useEffect(() => {
    if (!open || !mounted) return;
    const frame = requestAnimationFrame(() => {
      const menu = contentRef.current;
      const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"][aria-disabled="false"]') ?? []);
      const preferred = (focusSelectedItem ? items.find(item => item.getAttribute('aria-checked') === 'true') : undefined) ?? items[0];
      const active = menu?.contains(document.activeElement) ? document.activeElement : preferred;
      items.forEach(item => { item.tabIndex = item === active ? 0 : -1; });
      // An async read can enable items after opening. Move focus only while
      // the user is still on the trigger, preserving navigation within the menu.
      if (!menu || document.activeElement !== triggerRef.current) return;
      const target = formContent ? menu.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)') : preferred;
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, mounted, children, triggerRef, formContent, focusSelectedItem]);
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
          style={{ ...style, ...position, maxWidth: style?.maxWidth ?? 'calc(100vw - 16px)', maxHeight: style?.maxHeight ?? 'calc(100dvh - 16px)' }}
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

  return <ThemedPortal>{content}</ThemedPortal>;
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
  const { setOpen, triggerRef } = useDropdownMenu();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.stopPropagation();
    onClick?.(e);
    if (e.defaultPrevented) return;
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    onSelect?.();
  };

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick(e as any);
          e.preventDefault();
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
  return <div role="separator" className={cn('-mx-1 my-1 h-px bg-border', className)} />;
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

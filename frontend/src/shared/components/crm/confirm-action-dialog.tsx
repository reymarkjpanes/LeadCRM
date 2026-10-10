'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { ThemedPortal } from '@/shared/components/theme-scope';
import { AlertTriangle, CheckCircle2, Info, Loader2, Trash2, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lockBackgroundScroll, lockModalBackground, registerOverlay } from '@/shared/lib/overlay-state';

export type ConfirmActionVariant = 'default' | 'destructive' | 'success' | 'warning';

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  items?: string[];
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmActionVariant;
  icon?: LucideIcon;
  /** Resolving closes the dialog. Throw an error to keep it open, or return false for a controlled transition. */
  onConfirm: () => void | boolean | Promise<void | boolean>;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}

export type ConfirmActionOptions = Omit<ConfirmActionDialogProps, 'open' | 'onOpenChange'>;

const variants = {
  default: { icon: Info, accent: 'bg-primary/10 text-primary', button: 'bg-primary hover:bg-primary/90' },
  destructive: { icon: Trash2, accent: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400', button: 'bg-red-600 hover:bg-red-700' },
  success: { icon: CheckCircle2, accent: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400', button: 'bg-green-700 hover:bg-green-800' },
  warning: { icon: AlertTriangle, accent: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400', button: 'bg-orange-700 hover:bg-orange-800' },
} satisfies Record<ConfirmActionVariant, { icon: LucideIcon; accent: string; button: string }>;

const focusableSelector = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

/** Canonical compact confirmation for CRM actions, including confirmations above drawers and forms. */
export function ConfirmActionDialog({
  open, onOpenChange, title, description, items, warning,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default', icon,
  onConfirm, isLoading = false, confirmDisabled = false, children,
}: ConfirmActionDialogProps): React.ReactElement | null {
  const id = useId();
  const [internalLoading, setInternalLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const session = useRef(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const loading = internalLoading || isLoading;
  const latest = useRef({ loading, onOpenChange });
  latest.current = { loading, onOpenChange };

  useEffect(() => {
    session.current++;
    setError('');
    setInternalLoading(false);
    pending.current = false;
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const layer = layerRef.current;
    const releaseOverlay = registerOverlay(id);
    const releaseScroll = lockBackgroundScroll();
    const releaseInert = dialog ? lockModalBackground(dialog) : () => {};
    const isTopmost = () => {
      const layers = document.querySelectorAll('[data-confirm-action-layer]');
      return layers[layers.length - 1] === layer;
    };
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert]') && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
    (cancelRef.current?.disabled ? dialog : cancelRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!pending.current && !latest.current.loading) latest.current.onOpenChange(false);
      }
      if (event.key !== 'Tab' || !dialog) return;
      // Parent drawer traps must not handle this confirmation's Tab key.
      event.stopImmediatePropagation();
      const elements = focusable(), first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (isTopmost() && dialog && !dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      session.current++;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      releaseInert();
      releaseScroll();
      releaseOverlay();
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && (!dialog.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) dialog.focus();
  }, [open, loading]);

  const handleCancel = () => {
    if (!pending.current && !loading) onOpenChange(false);
  };
  const handleConfirm = async () => {
    if (pending.current || loading || confirmDisabled) return;
    const inputs = dialogRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
    if (inputs && Array.from(inputs).some(input => !input.reportValidity())) return;
    pending.current = true;
    const started = session.current;
    setInternalLoading(true);
    setError('');
    try {
      const result = await onConfirm();
      if (session.current === started && result !== false) onOpenChange(false);
    } catch (failure) {
      if (session.current === started) setError(failure instanceof Error && failure.message ? failure.message : 'Unable to complete this action. Please try again.');
    } finally {
      if (session.current === started) { pending.current = false; setInternalLoading(false); }
    }
  };

  if (!open || typeof document === 'undefined') return null;
  const style = variants[variant];
  const Icon = icon ?? style.icon;
  const describedBy = [description && `${id}-description`, warning && `${id}-warning`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';

  return <ThemedPortal>{<div ref={layerRef} data-confirm-action-layer className="fixed inset-0 z-[400] flex items-center justify-center p-4" onClick={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()}>
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm" onClick={handleCancel} aria-hidden="true" />
      <div ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={describedBy} aria-busy={loading}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl outline-none">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-4 dark:border-white/[0.05] sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div aria-hidden="true" className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', style.accent)}><Icon size={18} /></div>
            <h2 id={`${id}-title`} className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-white">{title}</h2>
          </div>
          <button type="button" onClick={handleCancel} disabled={loading} aria-label="Close confirmation" className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white', focusClass)}><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-4 text-sm text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300 sm:px-5">
          {description && <p id={`${id}-description`} className="leading-relaxed">{description}</p>}
          {!!items?.length && <ul className="list-inside list-disc space-y-1.5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs dark:border-white/5 dark:bg-white/[0.02]">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          {children && <fieldset disabled={loading} className="min-w-0 space-y-3">{children}</fieldset>}
          {warning && <p id={`${id}-warning`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{warning}</span></p>}
          {error && <p id={`${id}-error`} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300">{error}</p>}
          <span role="status" className="sr-only">{loading ? 'Processing. Please wait.' : ''}</span>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-100 bg-slate-50/50 px-4 py-3 dark:border-white/[0.05] dark:bg-white/[0.02] sm:px-5">
          <button ref={cancelRef} type="button" onClick={handleCancel} disabled={loading} className={cn('min-h-9 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/5', focusClass)}>{cancelLabel}</button>
          <button type="button" onClick={() => void handleConfirm()} disabled={loading || confirmDisabled} className={cn('flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50', focusClass, style.button)}>
            {loading && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{confirmLabel}
          </button>
        </footer>
      </div>
    </div>}</ThemedPortal>;
}

export default ConfirmActionDialog;

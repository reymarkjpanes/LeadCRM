'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Info, RefreshCw, X } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** List of actions that will happen on confirm */
  items?: string[];
  /** Warning text (e.g. "This cannot be undone") */
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

// ─── Component ─────────────────────────────────────────────────────────────

/**
 * ConfirmActionDialog — professional confirmation dialog for CRM actions.
 * Replaces window.confirm() with a styled, accessible dialog.
 *
 * Variants:
 * - default: blue confirm button (informational actions)
 * - destructive: red confirm button (delete/archive/irreversible)
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  isLoading = false,
}: ConfirmActionDialogProps): React.ReactElement | null {
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = isLoading || internalLoading;
  const dialogRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ loading, onOpenChange });
  latest.current = { loading, onOpenChange };
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!latest.current.loading) latest.current.onOpenChange(false);
      }
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [open]);

  if (!open) return null;

  const handleConfirm = async (): Promise<void> => {
    setInternalLoading(true);
    try {
      await onConfirm();
    } finally {
      setInternalLoading(false);
    }
  };

  const handleCancel = (): void => {
    if (!loading) onOpenChange(false);
  };

  const isDestructive = variant === 'destructive';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 animate-in fade-in-0"
        onClick={handleCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-md animate-in fade-in-0 zoom-in-95"
        role="alertdialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
      >
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between px-6 pt-5 pb-2">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center shrink-0',
                isDestructive
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-blue-100 dark:bg-blue-900/30',
              )}>
                {isDestructive
                  ? <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />
                  : <Info size={18} className="text-blue-600 dark:text-blue-400" />
                }
              </div>
              <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-white">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 pb-4 space-y-3">
            {description && (
              <p id="confirm-dialog-desc" className="text-sm text-slate-600 dark:text-slate-400">
                {description}
              </p>
            )}

            {items && items.length > 0 && (
              <div className="rounded-lg border border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-white/[0.02] p-3 space-y-1.5">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <span className="text-slate-400 mt-0.5">•</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}

            {warning && (
              <div className={cn(
                'flex items-start gap-2 p-2.5 rounded-lg text-xs',
                isDestructive
                  ? 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                  : 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
              )}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{warning}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05] bg-slate-50/50 dark:bg-white/[0.01]">
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.05] rounded-lg transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
                isDestructive
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              {loading && <RefreshCw size={13} className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ConfirmActionDialog;

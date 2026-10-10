'use client';

import { useState, useCallback } from 'react';
import type { ConfirmActionDialogProps, ConfirmActionOptions } from '@/shared/components/crm/confirm-action-dialog';

// ─── Types ─────────────────────────────────────────────────────────────────

type ConfirmDialogState = ConfirmActionOptions & { open: boolean };

interface UseConfirmDialogResult {
  dialogProps: ConfirmActionDialogProps;
  confirm: (options: ConfirmActionOptions) => void;
  close: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

const DEFAULT_STATE: ConfirmDialogState = {
  open: false,
  title: '',
  onConfirm: () => {},
};

/**
 * useConfirmDialog — manages confirmation dialog state.
 * Use with ConfirmActionDialog component for a complete solution.
 *
 * Usage:
 * ```tsx
 * const { dialogProps, confirm } = useConfirmDialog();
 *
 * // Trigger
 * onClick: () => confirm({
 *   title: 'Archive Lead?',
 *   description: 'This will archive the lead.',
 *   warning: 'You can restore this record from Archived Data.',
 *   variant: 'destructive',
 *   confirmLabel: 'Archive',
 *   onConfirm: async () => { await archiveLead(id); },
 * })
 *
 * // Render
 * <ConfirmActionDialog {...dialogProps} />
 * ```
 */
export function useConfirmDialog(): UseConfirmDialogResult {
  const [state, setState] = useState<ConfirmDialogState>(DEFAULT_STATE);

  const confirm = useCallback((options: ConfirmActionOptions): void => {
    setState({ ...options, open: true });
  }, []);

  const close = useCallback((): void => {
    setState(DEFAULT_STATE);
  }, []);

  const onOpenChange = useCallback((open: boolean): void => {
    if (!open) close();
  }, [close]);

  return {
    dialogProps: { ...state, onOpenChange },
    confirm,
    close,
  };
}

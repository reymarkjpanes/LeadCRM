import { ConfirmActionDialog, type ConfirmActionDialogProps } from '@/shared/components/crm/confirm-action-dialog';

type WorkflowPauseDialogProps = Pick<ConfirmActionDialogProps,
  'open' | 'onOpenChange' | 'onConfirm' | 'isLoading' | 'confirmDisabled'>;

export function WorkflowPauseDialog(props: WorkflowPauseDialogProps) {
  return (
    <ConfirmActionDialog
      {...props}
      title="Pause workflow?"
      description="Pausing prevents new runs until you resume this workflow."
      warning="Already dispatched actions cannot be recalled."
      confirmLabel="Pause workflow"
    />
  );
}

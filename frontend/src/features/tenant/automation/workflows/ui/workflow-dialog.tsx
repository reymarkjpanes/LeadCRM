'use client';
import { panelSurfaceClass, panelHeaderClass, panelTitleClass, panelBodyClass, panelCloseClass } from '@/shared/components/side-panel-styles';
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
interface WorkflowDialogProps { title: string; onClose: () => void; children: ReactNode; sidePanel?: boolean; }
export function WorkflowDialog({ title, onClose, children, sidePanel }: WorkflowDialogProps) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-label={title} className={sidePanel ? panelSurfaceClass + ' fixed inset-y-0 left-auto right-0 top-0 translate-x-0 translate-y-0 max-h-dvh rounded-none flex flex-col p-0' : 'max-w-3xl max-h-[90vh] overflow-y-auto'} closeClassName={sidePanel ? panelCloseClass : undefined}>
      <DialogHeader className={sidePanel ? panelHeaderClass + " pr-20 sm:pr-20 text-left" : undefined}><DialogTitle className={sidePanel ? panelTitleClass : undefined}>{title}</DialogTitle></DialogHeader>
      <div className={sidePanel ? panelBodyClass + " space-y-5" : "mt-5 space-y-5"}>{children}</div>
    </DialogContent>
  </Dialog>;
}

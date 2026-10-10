'use client';
import type { Deal } from '@/store/types';
import { DealForm, DealFormSheet, type UpdateDealFormData } from './deal-form';

type Props = { deal: Deal; onSave: (data: Partial<UpdateDealFormData>) => void | Promise<void>; onCancel: () => void };

/** Legacy exports reuse the current catalog-backed form. Record panels edit inline. */
export function DealEditForm({ deal, onSave, onCancel }: Props) {
  return <DealForm mode="edit" initialData={deal} onSubmit={async values => { await onSave(values); }} onCancel={onCancel} />;
}
export function DealEditFormSheet({ deal, isOpen, onClose, onSave }: Omit<Props, 'deal' | 'onCancel'> & { deal: Deal | null; isOpen: boolean; onClose: () => void }) {
  return deal ? <DealFormSheet mode="edit" initialData={deal} isOpen={isOpen} onClose={onClose} onSubmit={async values => { await onSave(values); }} /> : null;
}
export default DealEditForm;

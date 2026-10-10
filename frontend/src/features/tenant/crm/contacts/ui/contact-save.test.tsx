import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContactFormInner } from './contact-form';
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [] }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [], loading: false }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: () => {} }));
vi.mock('@/shared/components/entity-combobox', () => ({ EntityCombobox: () => null }));
vi.mock('@/shared/components/crm/record-custom-fields', () => ({
  useRecordCustomFields: () => ({ fields: [], blocked: false, validate: () => true, payload: () => ({}) }),
  CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null,
}));
afterEach(cleanup);
it('retains a failed draft and permits retry without submitting twice while saving', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; })).mockResolvedValue(undefined);
  render(<ContactFormInner onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Nora' } });
  fireEvent.change(screen.getByLabelText('Last Name *'), { target: { value: 'Lim' } });
  fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'nora@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await screen.findByRole('button', { name: 'Saving...' });
  expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error('Temporary save failure'));
  expect((await screen.findByRole('alert')).textContent).toBe('Temporary save failure');
  expect((screen.getByLabelText('First Name *') as HTMLInputElement).value).toBe('Nora');
  fireEvent.click(screen.getByRole('button', { name: 'Create Contact' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});

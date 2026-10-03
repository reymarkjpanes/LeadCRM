import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('@/store/DataContext', () => ({ useData: () => ({ users: [] }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [] }) }));
vi.mock('@/shared/hooks/use-scroll-to-error', () => ({ useScrollToError: vi.fn() }));
import { AccountFormInner } from '../account-form';
afterEach(cleanup);
it.each([false, true])('submits an Account without obsolete fields (edit=%s)', async edit => {
  const save = vi.fn();
  render(<AccountFormInner initialData={edit ? { id: 'account', tenantId: 'tenant', name: 'Account', createdAt: '2026-09-24T00:00:00Z' } : undefined} onSave={save} onCancel={vi.fn()} />);
  for (const label of ['Tax ID', 'Customer Type', 'Customer Since', 'Customer Classification']) expect(screen.queryByText(label)).toBeNull();
  fireEvent.change(screen.getByLabelText(/Account Name/), { target: { value: 'New Account' } });
  fireEvent.submit(screen.getByLabelText(/Account Name/).closest('form')!);
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toMatchObject({ name: 'New Account', country: 'Philippines' });
  for (const field of ['taxId', 'customerType', 'customerSince']) expect(save.mock.calls[0][0]).not.toHaveProperty(field);
});

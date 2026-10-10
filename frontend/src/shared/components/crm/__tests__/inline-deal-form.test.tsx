import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InlineDealForm } from '../inline-deal-form';
const mocks = vi.hoisted(() => ({ stages: [
  { id: 'qualified', name: 'Qualified', isDefault: true }, { id: 'lead', name: 'Lead' }, { id: 'won', name: 'Won', isWon: true },
] }));
vi.mock('@/store/DataContext', () => ({ useData: () => ({ pipelines: [{ id: 'sales', name: 'Sales Pipeline', stages: mocks.stages }] }) }));
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [{ id: '11111111-1111-4111-8111-111111111111', name: 'CCTV', dealValue: 500 }], loading: false }) }));
vi.mock('../record-custom-fields', () => ({
  useRecordCustomFields: () => ({ fields: [], validate: () => true, payload: () => ({}), blocked: false }),
  CustomFieldGroup: () => null, CustomFieldExtraGroups: () => null,
}));
afterEach(cleanup);
beforeEach(() => { mocks.stages = [{ id: 'qualified', name: 'Qualified', isDefault: true }, { id: 'lead', name: 'Lead' }, { id: 'won', name: 'Won', isWon: true }]; });
it('shows the enforced Lead starting stage and submits its configured ID', async () => {
  const submitted = vi.fn().mockResolvedValue(undefined);
  render(<InlineDealForm onSubmit={submitted} />);
  expect((screen.getByLabelText('Starting stage') as HTMLInputElement).value).toBe('Lead');
  expect(screen.queryByRole('combobox', { name: /stage/i })).toBeNull();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'CCTV installation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
  fireEvent.click(screen.getByRole('radio', { name: 'CCTV' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Create Deal' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Create Deal' }));
  await waitFor(() => expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: 'sales', stageId: 'lead' })));
});
it('prevents creation if the Lead stage is unavailable', () => {
  mocks.stages = [{ id: 'qualified', name: 'Qualified', isDefault: true }];
  render(<InlineDealForm onSubmit={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('Lead starting stage is unavailable');
  expect((screen.getByRole('button', { name: 'Create Deal' }) as HTMLButtonElement).disabled).toBe(true);
});

import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClosedWonDialog } from '../closed-won-dialog';
afterEach(cleanup);
it('does not confirm without a type and requires an explanation for Other', () => {
  const confirm = vi.fn(); render(<ClosedWonDialog onConfirm={confirm} onCancel={vi.fn()} />);
  const form = screen.getByRole('button', { name: 'Confirm Closed Won' }).closest('form')!;
  fireEvent.submit(form); expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirmation Type'), { target: { value: 'Other' } });
  fireEvent.submit(form); expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Explanation (required)'), { target: { value: 'Order independently verified by staff.' } });
  fireEvent.submit(form); expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'Other', note: 'Order independently verified by staff.' }));
});
it('supports all five confirmation types and cancelling without a mutation', () => {
  const confirm = vi.fn(), cancel = vi.fn(); render(<ClosedWonDialog onConfirm={confirm} onCancel={cancel} />);
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Select confirmation', 'Approved Quotation', 'Signed/Approved Contract', 'Purchase Order Received', 'Order Confirmed', 'Other']);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
});

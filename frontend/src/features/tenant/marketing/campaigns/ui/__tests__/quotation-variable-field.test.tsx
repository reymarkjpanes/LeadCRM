import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuotationVariableField } from '../quotation-variable-field';
afterEach(cleanup);
it('uses the existing picker and inserts into the selected cursor range', async () => {
  const change = vi.fn();
  render(<QuotationVariableField id="notes" label="Notes" value="Hello customer!" onChange={change} choices={[{ id: 'firstName', technicalKey: 'firstName', label: 'First Name', category: 'Recipient (Lead / Contact)', origins: [], personalizationAvailable: true }]} />);
  const input = screen.getByLabelText('Notes') as HTMLTextAreaElement;
  input.focus(); input.setSelectionRange(6, 14);
  fireEvent.click(screen.getByRole('button', { name: 'Insert Variable into Notes' }));
  expect(screen.getByLabelText('Search variables')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /First Name/ }));
  expect(change).toHaveBeenCalledWith('Hello {{firstName}}!');
});

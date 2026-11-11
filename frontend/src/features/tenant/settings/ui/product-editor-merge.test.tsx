import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductEditor } from './product-editor';

afterEach(cleanup);

it('saves and reopens literal Unicode Product text with meaningful placeholders', async () => {
  const name = `ñ é 中文 日本語 한글 مرحبا 😊 & ' " < > ∑ ₱ e\u0301`;
  const description = `${name}\n<tag>literal text</tag>`;
  const save = vi.fn(async () => {});
  const view = render(<ProductEditor busy={false} categories={['Security']} onSave={save} onCancel={() => {}} />);
  expect(screen.getByPlaceholderText('Enter product name...')).toBe(screen.getByLabelText('Product Name'));
  expect(screen.getByPlaceholderText('Describe this product...')).toBe(screen.getByLabelText('Product Description'));
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Product Description'), { target: { value: description } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Security' } });
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name, description, category: 'Security', dealValue: 123 }));
  view.unmount();
  render(<ProductEditor product={{ name, description, category: 'Security', dealValue: 123, id: 'saved', active: true, createdAt: '', updatedAt: '' }} busy={false} categories={['Security']} onSave={save} onCancel={() => {}} />);
  expect(screen.getByLabelText('Product Name')).toHaveProperty('value', name);
  expect(screen.getByLabelText('Product Description')).toHaveProperty('value', description);
});

it('requires a selected category while preserving the Product description and single category control', async () => {
  const save = vi.fn(async () => {});
  render(<ProductEditor busy={false} categories={['Security']} onSave={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Camera' } });
  fireEvent.change(screen.getByLabelText('Deal Value (PHP)'), { target: { value: '15000' } });
  fireEvent.change(screen.getByLabelText('Product Description'), { target: { value: 'Includes installation' } });
  expect(screen.getAllByRole('combobox', { name: 'Category' })).toHaveLength(1);
  expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(screen.getByText('Category is required.')).toBeTruthy(); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Security' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'Camera', category: 'Security', description: 'Includes installation', dealValue: 15000 }));
});

it('preserves existing 200-character categories, descriptions and decimal values when editing', async () => {
  const save = vi.fn(async () => {});
  const product = { id: 'product', name: 'Camera', category: 'C'.repeat(200), description: 'Existing description', dealValue: 15000.5, active: true, createdAt: '', updatedAt: '' };
  render(<ProductEditor product={product} categories={[product.category]} busy={false} onSave={save} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: product.name, category: product.category, description: product.description, dealValue: product.dealValue }));
});

it('preserves decimal typing states and the cursor while requiring a complete amount to save', async () => {
  const save = vi.fn(async () => {});
  render(<ProductEditor busy={false} categories={['Security']} onSave={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Camera' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Security' } });
  const input = screen.getByLabelText('Deal Value (PHP)') as HTMLInputElement;
  expect(input.inputMode).toBe('decimal');
  input.focus();
  for (const value of ['9', '99', '99.']) {
    fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
    expect(input.value).toBe(value);
    expect(input.selectionStart).toBe(value.length);
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('alert')).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('Enter a non-negative amount with up to two decimal places.');
  for (const value of ['99.2', '99.25']) {
    fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
    expect(input.value).toBe(value);
    expect(input.selectionStart).toBe(value.length);
    expect(screen.queryByRole('alert')).toBeNull();
  }
  // A valid edit in the middle must retain the browser's selection as well.
  fireEvent.change(input, { target: { value: '98.25', selectionStart: 2, selectionEnd: 2 } });
  expect(input.selectionStart).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'Camera', category: 'Security', description: '', dealValue: 98.25 }));
});

it.each([
  ['99.256', 'Enter a non-negative amount with up to two decimal places.'],
  ['-99.25', 'Deal value must not be negative.'],
  ['abc', 'Deal value must contain digits only.'],
])('blocks invalid input %s without submitting the retained prior value', async (value, message) => {
  const save = vi.fn(async () => {});
  render(<ProductEditor busy={false} categories={['Security']} onSave={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Camera' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Security' } });
  const input = screen.getByLabelText('Deal Value (PHP)');
  fireEvent.change(input, { target: { value: '99.25' } });
  fireEvent.change(input, { target: { value } });
  expect(input).toHaveProperty('value', '99.25');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('alert').textContent).toBe(message);
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '99.2' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'Camera', category: 'Security', description: '', dealValue: 99.2 }));
});

it.each(['', '1000000000000'])('rejects empty or above-maximum amounts: %s', amount => {
  const save = vi.fn(async () => {});
  render(<ProductEditor busy={false} categories={['Security']} onSave={save} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Product Name'), { target: { value: 'Camera' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Security' } });
  const input = screen.getByLabelText('Deal Value (PHP)');
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.change(input, { target: { value: amount } });
  expect(input).toHaveProperty('value', amount);
  fireEvent.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe(amount ? 'Number must be less than or equal to 999999999999' : 'Deal value is required.');
});

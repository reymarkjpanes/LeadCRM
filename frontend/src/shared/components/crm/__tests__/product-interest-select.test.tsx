import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProductInterest } from '@leadcrm/shared';
vi.mock('@/shared/hooks/use-product-interests', () => ({ useProductInterests: () => ({ products: [], loading: false, error: '' }) }));
import { ProductInterestSelect } from '../product-interest-select';

afterEach(cleanup);
const products = [{ id: 'a', name: 'Network', dealValue: 25 }, { id: 'b', name: 'CCTV', dealValue: 40 }] as ProductInterest[];
it.each(['id', 'name'] as const)('keeps multiple %s selections checked after Escape and reopening', mode => {
  const change = vi.fn();
  function Form() {
    const [values, setValues] = useState<string[]>([]);
    return <ProductInterestSelect products={products} values={values} valueMode={mode} onChange={next => { change(next); setValues(next); }} />;
  }
  render(<Form />);
  const trigger = screen.getByRole('button', { name: 'Product Interest' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Network' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'CCTV' }));
  expect(change).toHaveBeenLastCalledWith(mode === 'id' ? ['a', 'b'] : ['Network', 'CCTV']);
  fireEvent.keyDown(screen.getByRole('checkbox', { name: 'CCTV' }), { key: 'Escape' });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.textContent).toContain('2 selected');
  expect(screen.queryByText('Network')).toBeNull();
  expect(screen.queryByText('CCTV')).toBeNull();
  fireEvent.click(trigger);
  expect((screen.getByRole('checkbox', { name: 'Network' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: 'CCTV' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Network' }));
  expect(change).toHaveBeenLastCalledWith([mode === 'id' ? 'b' : 'CCTV']);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('supports arrow-key focus and preserves unavailable historical selections', () => {
  render(<ProductInterestSelect products={products} values={['old']} labels={{ old: 'Historical product' }} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Product Interest' }));
  const first = screen.getByRole('checkbox', { name: 'Network' });
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'CCTV' }));
  expect((screen.getByRole('checkbox', { name: 'Historical product' }) as HTMLInputElement).checked).toBe(true);
});

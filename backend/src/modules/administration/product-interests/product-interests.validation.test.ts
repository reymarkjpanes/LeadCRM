import { describe, expect, it } from 'vitest';
import {
  isProductCreateAmountInput,
  parseProductCreateAmount,
  ProductInterestCreateSchema,
  ProductInterestPatchSchema,
  ProductInterestConfigSchema,
  MAX_ACTIVE_PRODUCTS,
  ProductCategoryMutationSchema,
} from '@leadcrm/shared';

describe('new Product Interest validation', () => {
  it('requires a trimmed non-empty name and a numeric deal value', () => {
    expect(ProductInterestCreateSchema.parse({ name: '   CCTV Surveillance System   ', category: 'CCTV', dealValue: 25000 }))
      .toEqual({ name: 'CCTV Surveillance System', category: 'CCTV', description: '', dealValue: 25000 });
    expect(ProductInterestCreateSchema.safeParse({ name: '   ', category: 'CCTV', dealValue: 25000 }).success).toBe(false);
    expect(ProductInterestCreateSchema.safeParse({ name: 'Product', category: 'CCTV', dealValue: undefined }).success).toBe(false);
    expect(ProductInterestCreateSchema.safeParse({ name: 'P'.repeat(201), category: 'CCTV', dealValue: 25000 }).success).toBe(false);
  });

  it.each(['99', '99.2', '99.25', '0.50', '1500.75', '0', '0.00', '25000.50', '999999999999', '999999999998.99'])('accepts monetary amount %s without changing its value', amount => {
    const value = Number(amount);
    expect(parseProductCreateAmount(amount)).toBe(value);
    expect(ProductInterestCreateSchema.parse({ name: 'Product', category: 'CCTV', dealValue: value }).dealValue).toBe(value);
    expect(ProductInterestPatchSchema.parse({ dealValue: value }).dealValue).toBe(value);
  });

  it.each(['₱25000', '25,000', 'abc', '-500', '-99.25', '12abc', '99.256', '1e2', '+99', '.50', '99..25', ' 25000', '25000 ', '', '99.'])('rejects incomplete or unsupported raw amount %s', amount => {
    expect(parseProductCreateAmount(amount)).toBeNull();
    expect(ProductInterestCreateSchema.safeParse({ name: 'Product', category: 'CCTV', dealValue: amount }).success).toBe(false);
  });

  it.each([99.256, -99.25, 999_999_999_999.01, 1_000_000_000_000, NaN, Infinity])('rejects invalid numeric amounts consistently on create and update: %s', dealValue => {
    expect(ProductInterestCreateSchema.safeParse({ name: 'Product', category: 'CCTV', dealValue }).success).toBe(false);
    expect(ProductInterestPatchSchema.safeParse({ dealValue }).success).toBe(false);
  });

  it('allows empty and trailing-decimal input only as typing states', () => {
    for (const amount of ['', '99.']) {
      expect(isProductCreateAmountInput(amount)).toBe(true);
      expect(parseProductCreateAmount(amount)).toBeNull();
    }
    expect(isProductCreateAmountInput('99.256')).toBe(false);
  });

  it.each([undefined, null, '', ' '])('requires category on create and rejects empty supplied update categories: %s', category => {
    expect(ProductInterestCreateSchema.safeParse({ name: 'Camera', category, dealValue: 25 }).success).toBe(false);
    if (category !== undefined) expect(ProductInterestPatchSchema.safeParse({ category }).success).toBe(false);
  });

  it('shares required category validation across add and rename', () => {
    expect(ProductCategoryMutationSchema.parse({ action: 'add', name: '  CCTV  ' })).toEqual({ action: 'add', name: 'CCTV' });
    expect(ProductCategoryMutationSchema.safeParse({ action: 'rename', name: 'CCTV', newName: ' ' }).success).toBe(false);
    expect(ProductCategoryMutationSchema.safeParse({ action: 'add', name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('uses the same active catalog ceiling as creation and restoration', () => {
    const products = Array.from({ length: MAX_ACTIVE_PRODUCTS }, (_, index) => ({ name: `Product ${index}`, category: 'Catalog', dealValue: 0 }));
    expect(ProductInterestConfigSchema.safeParse(products).success).toBe(true);
    expect(ProductInterestConfigSchema.safeParse([...products, { name: 'Overflow', dealValue: 0 }]).success).toBe(false);
  });
});

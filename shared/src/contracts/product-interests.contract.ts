import { z } from 'zod';

/** Accept display currency only at the form boundary; API money remains numeric. */
export function parseProductAmount(input: string): number | null {
  const text = input.trim().replace(/^₱\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

/** New catalog entries accept whole digit-only amounts in the raw form value. */
export function isProductCreateAmountInput(input: string): boolean {
  return /^\d*$/.test(input);
}

export function parseProductCreateAmount(input: string): number | null {
  if (input.length === 0 || !isProductCreateAmountInput(input)) return null;
  const amount = Number(input);
  return Number.isFinite(amount) ? amount : null;
}

export const PRODUCT_DEAL_VALUE_REQUIRED_ERROR = 'Deal value is required.';
export const PRODUCT_DEAL_VALUE_DIGITS_ERROR = 'Deal value must contain digits only.';
export const PRODUCT_DEAL_VALUE_NEGATIVE_ERROR = 'Deal value must not be negative.';
export const PRODUCT_INTEREST_NAME_MAX_LENGTH = 200;
export const PRODUCT_INTEREST_NAME_MAX_ERROR = `Product name must not exceed ${PRODUCT_INTEREST_NAME_MAX_LENGTH} characters.`;

const productNameSchema = z.string().trim().min(1, 'Product name is required').max(PRODUCT_INTEREST_NAME_MAX_LENGTH, PRODUCT_INTEREST_NAME_MAX_ERROR)
  .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed');

export const ProductInterestSchema = z.object({
  name: productNameSchema,
  dealValue: z.number().finite().min(0).max(999_999_999_999).multipleOf(0.01),
}).strict();
export const ProductInterestCreateSchema = ProductInterestSchema.extend({
  dealValue: z.number({ required_error: PRODUCT_DEAL_VALUE_REQUIRED_ERROR, invalid_type_error: PRODUCT_DEAL_VALUE_DIGITS_ERROR })
    .finite().int(PRODUCT_DEAL_VALUE_DIGITS_ERROR).min(0, PRODUCT_DEAL_VALUE_NEGATIVE_ERROR)
    .max(999_999_999_999),
});
export const ProductInterestIdSchema = z.string().uuid();
export const ProductInterestPatchSchema = ProductInterestSchema.partial().refine(v => Object.keys(v).length > 0, 'Provide a name or Deal value');
export const ProductInterestConfigSchema = z.array(ProductInterestSchema).max(100).refine(
  rows => new Set(rows.map(row => row.name.toLowerCase())).size === rows.length, 'Product names must be unique',
);
export interface ProductInterest {
  id: string;
  name: string;
  dealValue: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export type ProductInterestConfig = ProductInterest[];
export interface ProductWonDeal {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  customers: string[];
  company: string | null;
  closedAt: string | null;
  assignedAgent: string | null;
}
export function withProductOptions<T extends { mapToField?: string; options?: string[] }>(fields: T[], products: ProductInterest[]): T[] {
  return fields.map(field => field.mapToField === 'productInterest' ? { ...field, options: products.map(p => p.id), optionLabels: Object.fromEntries(products.map(p => [p.id, p.name])) } : field);
}

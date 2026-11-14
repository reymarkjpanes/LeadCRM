import { z } from 'zod';
import { maxLengthMessage } from '../validation/text-length';

/** Accept display currency only at the form boundary; API money remains numeric. */
export function parseProductAmount(input: string): number | null {
  const text = input.trim().replace(/^₱\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

/** Allow raw monetary input, including empty and trailing-decimal typing states. */
export function isProductCreateAmountInput(input: string): boolean {
  return /^(?:\d+(?:\.\d{0,2})?)?$/.test(input);
}

export function parseProductCreateAmount(input: string): number | null {
  return isProductCreateAmountInput(input) ? parseProductAmount(input) : null;
}

export const PRODUCT_DEAL_VALUE_REQUIRED_ERROR = 'Deal value is required.';
export const PRODUCT_DEAL_VALUE_DIGITS_ERROR = 'Deal value must contain digits only.';
export const PRODUCT_DEAL_VALUE_NEGATIVE_ERROR = 'Deal value must not be negative.';
export const PRODUCT_INTEREST_NAME_MAX_LENGTH = 200;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;
export const PRODUCT_CATEGORY_MAX_LENGTH = 100;
export const MAX_ACTIVE_PRODUCTS = 100;
export const PRODUCT_INTEREST_NAME_MAX_ERROR = `Product name must not exceed ${PRODUCT_INTEREST_NAME_MAX_LENGTH} characters.`;

const productNameSchema = z.string().trim().min(1, 'Product name is required').max(PRODUCT_INTEREST_NAME_MAX_LENGTH, PRODUCT_INTEREST_NAME_MAX_ERROR)
  .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed');

const categoryName = z.string().trim().min(1, 'Category is required.');
export const StoredProductCategoryNameSchema = categoryName.max(200)
  .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.');
export const ProductCategoryNameSchema = categoryName.max(PRODUCT_CATEGORY_MAX_LENGTH, maxLengthMessage('Category name', PRODUCT_CATEGORY_MAX_LENGTH))
  .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.');
export const ProductCategoryMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: ProductCategoryNameSchema }).strict(),
  z.object({ action: z.literal('rename'), name: StoredProductCategoryNameSchema, newName: ProductCategoryNameSchema }).strict(),
  z.object({ action: z.literal('delete'), name: StoredProductCategoryNameSchema }).strict(),
]);
export type ProductCategoryMutation = z.infer<typeof ProductCategoryMutationSchema>;

export const ProductInterestSchema = z.object({
  name: productNameSchema,
  category: ProductCategoryNameSchema,
  description: z.string().trim().max(PRODUCT_DESCRIPTION_MAX_LENGTH, maxLengthMessage('Product description', PRODUCT_DESCRIPTION_MAX_LENGTH)).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.').default(''),
  dealValue: z.number().finite().min(0).max(999_999_999_999).multipleOf(0.01),
}).strict();
export type ProductInterestInput = z.infer<typeof ProductInterestSchema>;
export const ProductInterestCreateSchema = ProductInterestSchema.extend({
  dealValue: z.number({ required_error: PRODUCT_DEAL_VALUE_REQUIRED_ERROR, invalid_type_error: PRODUCT_DEAL_VALUE_DIGITS_ERROR })
    .finite().min(0, PRODUCT_DEAL_VALUE_NEGATIVE_ERROR)
    .max(999_999_999_999).multipleOf(0.01),
});
export const ProductInterestIdSchema = z.string().uuid();
export const ProductInterestPatchSchema = ProductInterestSchema.partial().refine(v => Object.keys(v).length > 0, 'Provide product changes.');
export const ProductInterestConfigSchema = z.array(ProductInterestSchema).max(MAX_ACTIVE_PRODUCTS).refine(
  rows => new Set(rows.map(row => row.name.toLowerCase())).size === rows.length, 'Product names must be unique',
);
export interface ProductInterest {
  id: string;
  name: string;
  /** Blank categories display as Uncategorized; older cached responses may omit this field. */
  category?: string;
  description?: string;
  dealValue: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export type ProductInterestConfig = ProductInterest[];
/** Read-only metadata for a CRM record's canonical selected products, including retired products. */
export type ProductInterestRecord = Pick<ProductInterest, 'id' | 'name' | 'category'>;
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

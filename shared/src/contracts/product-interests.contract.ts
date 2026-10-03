import { z } from 'zod';

export const ProductInterestSchema = z.object({
  name: z.string().max(200).refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed').transform(v => v.trim()).pipe(z.string().min(1, 'Product name is required')),
  dealValue: z.number().finite().min(0).max(999_999_999_999).multipleOf(0.01),
}).strict();
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

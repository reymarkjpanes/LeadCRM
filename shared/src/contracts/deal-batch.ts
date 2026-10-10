import { z } from 'zod';
import { CustomFieldValuesSchema } from './closing-requirements';
import { COMPANY_INDUSTRIES } from '../constants/company-industries';
import { ProductInterestIdSchema } from './product-interests.contract';

export const DealIndustrySchema = z.enum(COMPANY_INDUSTRIES);
const text = (max: number) => z.string().trim().max(max).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Unsupported control characters.');
const id = z.string().min(1);
export const CreateDealBatchSchema = z.object({
  customFieldValues: CustomFieldValuesSchema.optional(),
  idempotencyKey: z.string().uuid(),
  pipelineId: id,
  stageId: id,
  title: text(255).refine(value => !!value && !/[\r\n\t]/.test(value), 'Enter a valid title.'),
  productInterestIds: z.array(ProductInterestIdSchema).min(1, 'Select at least one Product Interest.').max(100).transform(ids => [...new Set(ids)]),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  expectedCloseDate: z.string().datetime().optional(),
  accountId: id.optional(), assignedUserId: id.optional(),
  contactIds: z.array(id).max(100).optional(), leadIds: z.array(id).max(100).optional(),
  leadSource: text(255).optional(), industry: DealIndustrySchema.optional(), address: text(10000).optional(),
  productInterestOther: text(1000).nullable().optional(),
}).strict();
export type CreateDealBatchInput = z.input<typeof CreateDealBatchSchema>;
export interface DealBatchResult<T> { deals: T[]; replayed: boolean }
export function productDealTitle(title: string, product: string, multiple: boolean): string {
  if (!multiple) return title;
  const suffix = ` — ${product}`;
  return `${title.slice(0, Math.max(1, 255 - suffix.length)).trimEnd()}${suffix}`;
}

import { z } from 'zod';
import { DealAddressSourceSchema } from './deal-address';
import { CustomFieldValuesSchema } from './closing-requirements';
import { ProductInterestIdSchema } from './product-interests.contract';

const text = (max: number) => z.string().trim().max(max).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Unsupported control characters.');
const id = z.string().min(1);
export const DealAssociationSchema = z.object({ type: z.enum(['lead', 'contact']), id }).strict();
export const DealAssociationChangeSchema = DealAssociationSchema.extend({ previous: DealAssociationSchema.optional() }).strict();
export type DealAssociationChange = z.infer<typeof DealAssociationChangeSchema>;

/** Target the selected junction only; null means its previous link is stale. */
export function dealAssociationPatch(leadIds: string[], contactIds: string[], change: DealAssociationChange) {
  if (change.previous && !(change.previous.type === 'lead' ? leadIds : contactIds).includes(change.previous.id)) return null;
  const remaining = (type: 'lead' | 'contact', ids: string[]) => ids.filter(id => !(change.previous?.type === type && change.previous.id === id));
  const leads = remaining('lead', leadIds), contacts = remaining('contact', contactIds);
  return { leadIds: [...new Set(change.type === 'lead' ? [change.id, ...leads] : leads)], contactIds: [...new Set(change.type === 'contact' ? [change.id, ...contacts] : contacts)] };
}

/** Manual entry points require one person; internal product creation keeps its existing contract. */
export function validateManualDealAssociation(data: { leadIds?: string[]; contactIds?: string[] }, ctx: z.RefinementCtx) {
  if ((data.leadIds?.length ?? 0) + (data.contactIds?.length ?? 0) !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leadIds'], message: 'Select one Lead or Contact to associate with this Deal.' });
  }
}
export const CreateDealBatchSchema = z.object({
  addressSource: DealAddressSourceSchema.nullable().optional(),
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
  leadSource: text(255).optional(), address: text(10000).optional(),
  productInterestOther: text(1000).nullable().optional(),
}).strict();
export const ManualCreateDealBatchSchema = CreateDealBatchSchema.superRefine(validateManualDealAssociation);
export type CreateDealBatchInput = z.input<typeof CreateDealBatchSchema>;
export interface DealBatchResult<T> { deals: T[]; replayed: boolean }
export function productDealTitle(title: string, product: string, multiple: boolean): string {
  if (!multiple) return title;
  const suffix = ` — ${product}`;
  return `${title.slice(0, Math.max(1, 255 - suffix.length)).trimEnd()}${suffix}`;
}

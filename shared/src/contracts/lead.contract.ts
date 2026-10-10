import { z } from 'zod';
import { cleanText, AdministrationPhoneSchema } from '../validation/administration-user.schema';
import { CrmEmailSchema } from '../validation/crm-email';
import { LeadStatusSchema, LeadSourceSchema } from './record-experience';
import { CustomFieldValuesSchema } from './closing-requirements';

export const LeadNameSchema = cleanText(100).pipe(z.string().min(1, 'Name is required'));
export const LeadPhoneSchema = z.union([z.literal(''), AdministrationPhoneSchema]);
export const OptionalLeadSourceSchema = z.union([z.literal(''), LeadSourceSchema]);
const fields = {
  firstName: LeadNameSchema,
  lastName: LeadNameSchema,
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(),
  companyName: cleanText(2000).optional(),
  status: LeadStatusSchema,
  source: OptionalLeadSourceSchema.optional(),
  accountId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  productInterest: z.array(z.string().uuid()).max(100).optional(),
  address: z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), 'Control characters are not allowed.').transform(value => value.trim()).pipe(z.string().max(2000)).optional(),
  customFieldValues: CustomFieldValuesSchema.optional(),
};
/** The manual Lead API accepts only the final form fields and a retry receipt. */
export const CreateLeadSchema = z.object({ ...fields, status: LeadStatusSchema.default('Warm'), requestId: z.string().uuid().optional() }).strict();
export const UpdateLeadSchema = z.object(fields).partial().strict();
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

export const DeactivateUserSchema = z.object({ replacementAgentId: z.string().uuid().nullable().optional() }).strict();
export interface DeactivationImpact {
  userId: string;
  counts: { leads: number; contacts: number; accounts: number; deals: number; tasks: number };
  total: number;
}

import { z } from 'zod';
import { cleanText, AdministrationPhoneSchema } from '../validation/administration-user.schema';
import { CrmEmailSchema } from '../validation/crm-email';
import { LeadStatusSchema, LeadSourceSchema } from './record-experience';
import { CustomFieldValuesSchema } from './closing-requirements';
import { NewAccountSchema, exclusiveAccountInput, CrmCompanyNameSchema, CrmAddressSchema, COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR } from './organization';
import { personNameSchema } from './profile.contract';

export const LeadNameSchema = cleanText(100).pipe(z.string().min(1, 'Name is required'));
export const LeadPhoneSchema = z.union([z.literal(''), AdministrationPhoneSchema]);
export const OptionalLeadSourceSchema = z.union([z.literal(''), LeadSourceSchema]);
const fields = {
  firstName: personNameSchema('firstName', 'Name is required'),
  lastName: personNameSchema('lastName', 'Name is required'),
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(),
  companyName: CrmCompanyNameSchema.optional(),
  status: LeadStatusSchema,
  source: OptionalLeadSourceSchema.optional(),
  sourceDetail: cleanText(200).optional(),
  accountId: z.string().uuid().nullable().optional(),
  newAccount: NewAccountSchema.optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  productInterest: z.array(z.string().uuid()).max(100).optional(),
  address: CrmAddressSchema.optional(),
  customFieldValues: CustomFieldValuesSchema.optional(),
};
/** The manual Lead API accepts only the final form fields and a retry receipt. */
export const LeadFieldsSchema = z.object(fields).strict();
export const CreateLeadSchema = LeadFieldsSchema.extend({ status: LeadStatusSchema.default('Inquiry'), requestId: z.string().uuid().optional() })
  .refine(exclusiveAccountInput, { path: ['newAccount'], message: 'Select an Account or create a new one, not both.' });
export const ManualCreateLeadSchema = CreateLeadSchema.refine(data => data.status === 'Inquiry', {
  path: ['status'], message: 'Manually created Leads start with Inquiry status.',
});
export const UpdateLeadSchema = LeadFieldsSchema.partial().extend({ expectedUpdatedAt: z.string().datetime().optional() })
  .refine(exclusiveAccountInput, { path: ['newAccount'], message: 'Select an Account or create a new one, not both.' });
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

/** New Account details use the same contract as standalone and linked creation. */
export const ConvertLeadSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountName: z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR).optional(),
  newAccount: NewAccountSchema.optional(),
  skipAccountCreation: z.boolean().optional(),
  createContact: z.literal(true).default(true),
  contactId: z.string().uuid().optional(),
  createDeal: z.literal(false).default(false),
  dealId: z.string().uuid().optional(),
}).strict().refine(value => !value.newAccount || (!value.accountId && !value.accountName && !value.skipAccountCreation), {
  path: ['newAccount'], message: 'Choose one Account creation or linking option.',
});
export type ConvertLeadInput = z.infer<typeof ConvertLeadSchema>;

export const DeactivateUserSchema = z.object({ replacementAgentId: z.string().uuid().nullable().optional() }).strict();
export interface DeactivationImpact {
  userId: string;
  counts: { leads: number; contacts: number; accounts: number; deals: number; tasks: number };
  total: number;
}

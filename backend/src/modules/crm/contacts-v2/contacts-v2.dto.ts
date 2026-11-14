import { CrmEmailSchema, LeadPhoneSchema, CustomFieldValuesSchema, ContactCreationIdentitySchema, NewAccountSchema, exclusiveAccountInput, personNameSchema, CrmCompanyNameSchema, CrmAddressSchema } from '@leadcrm/shared';
import { z } from 'zod';
import { CrmStatusSchema } from '@leadcrm/shared';
import { recordText, recordName } from '../record-validation';
const ContactFields = ContactCreationIdentitySchema.extend({
  customFieldValues: CustomFieldValuesSchema.optional(),
  productInterestOther: recordText(1000).nullable().optional(),
  firstName: personNameSchema('firstName', 'Name is required'),
  lastName: personNameSchema('lastName', 'Name is required'),
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(), companyName: CrmCompanyNameSchema.optional(),
  address: CrmAddressSchema.optional(),
  source: recordText().optional(), notes: recordText(10000).optional(),
  status: CrmStatusSchema.default('Inquiry'),
  accountId: z.string().uuid().nullable().optional(),
  newAccount: NewAccountSchema.optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  productInterests: z.array(recordName(200)).max(100).optional(),
}).strict();
const exclusiveProducts = (data: { productInterestIds?: string[]; productInterests?: string[] }) => data.productInterestIds === undefined || data.productInterests === undefined;
export const CreateClientContactSchema = ContactFields.refine(exclusiveProducts, 'Supply Product IDs or legacy names, not both.')
  .refine(exclusiveAccountInput, { path: ['newAccount'], message: 'Select an Account or create a new one, not both.' });
export const ManualCreateClientContactSchema = CreateClientContactSchema.refine(data => data.status === 'Inquiry', {
  path: ['status'], message: 'Manually created Contacts start with Inquiry status.',
});
export const UpdateClientContactSchema = ContactFields.omit({ requestId: true }).partial().extend({ expectedUpdatedAt: z.string().datetime().optional() }).strict()
  .refine(exclusiveAccountInput, { path: ['newAccount'], message: 'Select an Account or create a new one, not both.' });

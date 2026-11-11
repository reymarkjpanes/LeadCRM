import { CrmEmailSchema, LeadPhoneSchema, CustomFieldValuesSchema, ContactCreationIdentitySchema, NewAccountSchema, exclusiveAccountInput, getNameDigitError } from '@leadcrm/shared';
import { z } from 'zod';
import { CrmStatusSchema } from '@leadcrm/shared';
import { recordText, recordName } from '../record-validation';
const ContactFields = ContactCreationIdentitySchema.extend({
  customFieldValues: CustomFieldValuesSchema.optional(),
  productInterestOther: recordText(1000).nullable().optional(),
  firstName: z.string().superRefine((value, ctx) => {
    const error = getNameDigitError('firstName', value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }).pipe(recordName()),
  lastName: z.string().superRefine((value, ctx) => {
    const error = getNameDigitError('lastName', value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }).pipe(recordName()),
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(), companyName: recordText().optional(),
  address: recordText().optional(),
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

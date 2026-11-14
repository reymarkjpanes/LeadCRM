import { z } from 'zod';
import { AccountUpdateFieldsSchema, CustomFieldValuesSchema, COMPANY_SIZE_OPTIONS, RETIRED_ACCOUNT_FIELDS, CrmCompanyNameSchema, CrmAddressSchema, CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR } from '@leadcrm/shared';
import { recordText } from '../record-validation';
import { consolidateAccountAddress } from './account-address';


const CompanyFieldsSchema = z.object({
  customFieldValues: CustomFieldValuesSchema.optional(),
  name:           CrmCompanyNameSchema.pipe(z.string().min(1, 'Name is required')),
  industry:       recordText().optional(),
  size:           z.enum(COMPANY_SIZE_OPTIONS).optional(),
  website:        z.string().url().optional().or(z.literal('')),
  address:        CrmAddressSchema.optional(),
  city:           recordText().optional(),
  province:       recordText().optional(),
  country:        recordText().optional(),
  notes:          recordText().optional(),
});

const rejectRetired = z.unknown().superRefine((value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.prototype.hasOwnProperty.call(value, 'ownerGroupId')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['ownerGroupId'], message: 'Customer records do not have an owning Group.' });
  for (const field of RETIRED_ACCOUNT_FIELDS) if (Object.prototype.hasOwnProperty.call(value, field)) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'This Account field is retired.' });
});

// Accept legacy split-address input, but persist only the consolidated address.
function fullAddress<T extends { address?: string; city?: string; province?: string; country?: string }>(input: T) {
  const { city, province, country, ...data } = input;
  return { ...data, ...(['address', 'city', 'province', 'country'].some(key => key in input)
    ? { address: consolidateAccountAddress(input) ?? undefined } : {}) };
}
export const CreateCompanySchema = rejectRetired.pipe(CompanyFieldsSchema.extend({ requestId: z.string().uuid().optional() })).transform(fullAddress)
  .refine(data => (data.address?.length ?? 0) <= CRM_ADDRESS_MAX_LENGTH, { path: ['address'], message: CRM_ADDRESS_MAX_ERROR });
export const UpdateCompanySchema = rejectRetired.pipe(CompanyFieldsSchema.partial().extend({ size: AccountUpdateFieldsSchema.shape.size })).transform(fullAddress)
  .refine(data => (data.address?.length ?? 0) <= CRM_ADDRESS_MAX_LENGTH, { path: ['address'], message: CRM_ADDRESS_MAX_ERROR });

export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>;

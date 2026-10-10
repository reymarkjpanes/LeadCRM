import { CrmEmailSchema, CustomFieldValuesSchema } from '@leadcrm/shared';
import { z } from 'zod';
import { CrmStatusSchema } from '@leadcrm/shared';
import { recordText, recordName } from '../record-validation';
export const CreateClientContactSchema = z.object({
  customFieldValues: CustomFieldValuesSchema.optional(),
  productInterestOther: recordText(1000).nullable().optional(),
  firstName: recordName(), lastName: recordName(),
  email: CrmEmailSchema,
  phone: recordText(100).optional(), company: recordText().optional(),
  address: recordText().optional(), jobTitle: recordText().optional(),
  source: recordText().optional(), notes: recordText(10000).optional(),
  status: CrmStatusSchema.default('Warm'),
  accountId: z.string().uuid().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  productInterests: z.array(recordName(200)).max(100).optional(),
});
export const UpdateClientContactSchema = CreateClientContactSchema.partial().extend({
  productInterestIds: z.array(z.string().uuid()).max(100).optional(),
});

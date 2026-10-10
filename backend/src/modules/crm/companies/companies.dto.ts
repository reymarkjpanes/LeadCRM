import { z } from 'zod';
import { CustomFieldValuesSchema, COMPANY_SIZE_OPTIONS } from '@leadcrm/shared';
import { recordText, recordName } from '../record-validation';

const id = () => z.string().min(1);

export const CreateCompanySchema = z.object({
  customFieldValues: CustomFieldValuesSchema.optional(),
  productInterestOther: recordText(1000).nullable().optional(),
  name:           recordName(255),
  industry:       recordText().optional(),
  size:           z.enum(COMPANY_SIZE_OPTIONS).optional(),
  website:        z.string().url().optional().or(z.literal('')),
  tags:           z.array(recordText(200)).max(100).default([]),
  address:        recordText().optional(),
  city:           recordText().optional(),
  province:       recordText().optional(),
  country:        z.string().default('Philippines'),
  assignedUserId: id().optional(),
  notes:          recordText().optional(),
  internalNotes:  recordText().optional(),
  productInterests: z.array(recordText(200)).max(100).optional(),
  activeProducts: z.array(recordText(200)).max(100).optional(),
});

export const UpdateCompanySchema = CreateCompanySchema.partial().extend({
  assignedUserId: id().nullable().optional(),
  productInterestIds: z.array(z.string().uuid()).max(100).optional(),
  activeProductIds: z.array(z.string().uuid()).max(100).optional(),
});

export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>;

import { z } from 'zod';
import { recordText, recordName } from '../record-validation';

const id = () => z.string().min(1);

export const CreateCompanySchema = z.object({
  productInterestOther: recordText(1000).nullable().optional(),
  name:           recordName(255),
  industry:       recordText().optional(),
  size:           z.enum(['1-10', '11-50', '51-200', '200+']).optional(),
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

export const UpdateCompanySchema = CreateCompanySchema.partial().extend({ assignedUserId: id().nullable().optional() });

export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>;

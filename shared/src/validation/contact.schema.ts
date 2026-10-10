import { CrmEmailSchema } from './crm-email';
import { z } from 'zod';
import { CrmStatusSchema } from '../contracts/record-experience';

export const ContactSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: CrmEmailSchema,
  phone: z.string().optional(),
  company: z.string().optional(),
  status: CrmStatusSchema.default('Warm'),
  source: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateContactSchema = ContactSchema.partial();

export type ContactInput = z.infer<typeof ContactSchema>;
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

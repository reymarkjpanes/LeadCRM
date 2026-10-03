import { CrmEmailSchema } from '@leadcrm/shared';
/**
 * Contact form validation schemas — mirrors backend CreateContactSchema/UpdateContactSchema
 * from backend/src/modules/crm/contacts/contacts.dto.ts
 */
import { z } from 'zod';
import { CrmStatusSchema } from '@leadcrm/shared';

export const CreateContactFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100, 'First name must be 100 characters or less'),
  lastName: z.string().trim().min(1, 'Last name is required').max(100, 'Last name must be 100 characters or less'),
  email: CrmEmailSchema,
  phone: z.string().optional(),
  companyName: z.string().optional(),
  status: CrmStatusSchema.default('Warm'),
  source: z.string().optional(),
  accountId: z.string().min(1).optional().or(z.literal('')),
  assignedUserId: z.string().min(1).optional().or(z.literal('')),
  productInterest: z.array(z.string()).optional(),
  address: z.string().optional(),
});

export const UpdateContactFormSchema = z.object({
  firstName: CreateContactFormSchema.shape.firstName,
  lastName: CreateContactFormSchema.shape.lastName,
  email: CrmEmailSchema,
  phone: z.string().optional(),
  companyName: z.string().optional(),
  status: CrmStatusSchema.optional(),
  source: z.string().optional(),
  accountId: z.string().min(1).optional().or(z.literal('')),
  assignedUserId: z.string().min(1).optional().or(z.literal('')),
  productInterest: z.array(z.string()).optional(),
  address: z.string().optional(),
});

export type CreateContactFormValues = z.infer<typeof CreateContactFormSchema>;
export type UpdateContactFormValues = z.infer<typeof UpdateContactFormSchema>;

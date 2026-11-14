import { CrmEmailSchema, LeadPhoneSchema, CrmAddressSchema, personNameSchema } from '@leadcrm/shared';
/**
 * Contact form validation schemas — mirrors the contacts-v2 API DTOs.
 */
import { z } from 'zod';
import { CrmStatusSchema } from '@leadcrm/shared';

export const CreateContactFormSchema = z.object({
  firstName: personNameSchema('firstName'),
  lastName: personNameSchema('lastName'),
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(),
  companyName: z.string().optional(),
  notes: z.string().max(10000).optional(),
  status: CrmStatusSchema.default('Inquiry'),
  source: z.string().optional(),
  accountId: z.string().min(1).optional().or(z.literal('')),
  assignedUserId: z.string().min(1).optional().or(z.literal('')),
  productInterest: z.array(z.string()).optional(),
  address: CrmAddressSchema.optional(),
});

export const UpdateContactFormSchema = z.object({
  firstName: CreateContactFormSchema.shape.firstName.optional(),
  lastName: CreateContactFormSchema.shape.lastName.optional(),
  email: CrmEmailSchema,
  phone: LeadPhoneSchema.optional(),
  companyName: z.string().optional(),
  notes: z.string().max(10000).optional(),
  status: CrmStatusSchema.optional(),
  source: z.string().optional(),
  accountId: z.string().min(1).optional().or(z.literal('')),
  assignedUserId: z.string().min(1).optional().or(z.literal('')),
  productInterest: z.array(z.string()).optional(),
  address: CrmAddressSchema.optional(),
});

export type CreateContactFormValues = z.infer<typeof CreateContactFormSchema>;
export type UpdateContactFormValues = z.infer<typeof UpdateContactFormSchema>;

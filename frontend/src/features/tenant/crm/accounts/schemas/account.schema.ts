import { z } from 'zod';

// ── Zod schemas mirroring backend CreateCompanySchema / UpdateCompanySchema ──
// Backend route POST /crm/accounts validates against CreateCompanySchema from companies.dto.ts.

import { COMPANY_SIZE_OPTIONS } from '@leadcrm/shared';
export { COMPANY_SIZE_OPTIONS } from '@leadcrm/shared';


export const CreateAccountSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required').max(255, 'Max 255 characters'),
  industry: z.string().optional(),
  size: z.enum(COMPANY_SIZE_OPTIONS).optional().or(z.literal('')),
  website: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  tags: z.array(z.string()).default([]),
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  country: z.string().default('Philippines'),
  assignedUserId: z.string().min(1).optional().or(z.literal('')),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  productInterests: z.array(z.string()).optional(),
  activeProducts: z.array(z.string()).optional(),
});

export const UpdateAccountSchema = CreateAccountSchema.partial();

export type CreateAccountFormData = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountFormData = z.infer<typeof UpdateAccountSchema>;

// Unified form data type (used for both create and edit modes)
export type AccountFormValues = CreateAccountFormData;

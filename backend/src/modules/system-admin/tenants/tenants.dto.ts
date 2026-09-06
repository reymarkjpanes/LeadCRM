import { z } from 'zod';

export const CreateTenantSchema = z.object({
  name: z.string().trim().min(2, 'Company name is required'),
  industry: z.string().trim().min(1, 'Industry is required'),
  companySize: z.string().trim().min(1, 'Company size is required'),
  plan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
  firstName: z.string().trim().min(2, 'First name is required'),
  lastName: z.string().trim().min(2, 'Last name is required'),
  email: z.string().trim().email('Valid admin email required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().trim().refine((value) => {
    const compact = value.replace(/[\s().-]/g, '');
    return /^(?:\+?[1-9]\d{7,14}|0?9\d{8,10})$/.test(compact);
  }, 'Enter a valid local or international phone number').optional(),
  address: z.string().trim().optional(),
});

export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;

import { z } from 'zod';

const id = () => z.string().min(1);

export const CreateLeadSchema = z.object({
  firstName:      z.string().min(1, 'First name is required').max(100),
  lastName:       z.string().min(1, 'Last name is required').max(100),
  email:          z.string().email('Invalid email address').optional().or(z.literal('')),
  phone:          z.string().optional(),
  company:        z.string().optional(),
  jobTitle:       z.string().optional(),
  linkedinUrl:    z.string().url().optional().or(z.literal('')),
  status:         z.enum(['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED']).default('WARM'),
  score:          z.number().int().min(0).max(100).optional(),
  source:         z.string().optional(),
  notes:          z.string().optional(),
  doNotLead:   z.boolean().default(false),
  assignedUserId: id().optional(),
  productInterests: z.array(z.string()).optional(),
  address:        z.string().optional(),
  customerType:   z.enum(['Prospect', 'Active Customer', 'Inactive Customer', 'Former Customer']).optional(),
  customerSince:  z.string().datetime().optional(),
  activeProducts: z.array(z.string()).optional(),
}).refine(
  () => true,
  { message: 'Valid record', path: [] },
);

export const UpdateLeadSchema = z.object({
  firstName:      z.string().min(1).max(100).optional(),
  lastName:       z.string().min(1).max(100).optional(),
  email:          z.string().email().optional().or(z.literal('')),
  phone:          z.string().optional(),
  company:        z.string().optional(),
  jobTitle:       z.string().optional(),
  linkedinUrl:    z.string().url().optional().or(z.literal('')),
  status:         z.enum(['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED']).optional(),
  score:          z.number().int().min(0).max(100).optional(),
  source:         z.string().optional(),
  notes:          z.string().optional(),
  doNotLead:   z.boolean().optional(),
  assignedUserId: id().optional(),
  productInterests: z.array(z.string()).optional(),
  address:        z.string().optional(),
  customerType:   z.enum(['Prospect', 'Active Customer', 'Inactive Customer', 'Former Customer']).optional(),
  customerSince:  z.string().datetime().optional(),
  activeProducts: z.array(z.string()).optional(),
});

export type CreateLeadDto = z.infer<typeof CreateLeadSchema>;
export type UpdateLeadDto = z.infer<typeof UpdateLeadSchema>;

// ── Convert Lead (Lead → Contact + Account + optional Deal) ────────
export const ConvertLeadSchema = z.object({
  // Account handling — accountId links to existing Account, accountName creates a new one
  accountId:       z.string().min(1).optional(), // link to existing account
  accountName:     z.string().min(1).optional(), // or create a new one
  // Contact handling
  createContact:   z.boolean().default(true),
  contactId:       z.string().min(1).optional(), // link to existing contact
  // Deal handling
  createDeal:      z.boolean().default(false),
  dealTitle:       z.string().min(1).max(255).optional(),
  dealValue:       z.number().positive().optional(),
  dealPipelineId:  z.string().min(1).optional(),
  dealPriority:    z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  dealId:          z.string().min(1).optional(), // link to existing deal
}).refine(
  (data) => data.accountId || data.accountName,
  { message: 'Either accountId or accountName is required', path: ['accountId'] },
);

export type ConvertLeadDto = z.infer<typeof ConvertLeadSchema>;

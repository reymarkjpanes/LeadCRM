import { CrmEmailSchema } from '@leadcrm/shared';
import { z } from 'zod';
import { LeadStatusSchema, ProductInterestIdSchema } from '@leadcrm/shared';
import { recordText, recordName } from '../record-validation';

const id = () => z.string().min(1);

// Lead model fields (schema ground truth):
// firstName, lastName, email, phone, source, status (validated Lead status, default "Warm"),
// accountId, assignedUserId, productInterest[], address, companyName, createdAt

export const CreateContactSchema = z.object({
  requestId: z.string().uuid().optional(),
  firstName:      recordName(),
  lastName:       recordName(),
  email: CrmEmailSchema,
  phone:          recordText().optional(),
  companyName:    recordText().optional(),
  status:         LeadStatusSchema.default('Warm'),
  source:         recordText().optional(),
  accountId:      id().optional(),
  assignedUserId: id().optional(),
  productInterest: z.array(ProductInterestIdSchema).max(100).optional(),
  address:        recordText().optional(),
  description:    recordText().optional(),
  website:        recordText().optional(),
});

export const UpdateContactSchema = z.object({
  productInterestOther: recordText(1000).nullable().optional(),
  firstName:      recordName().optional(),
  lastName:       recordName().optional(),
  email: CrmEmailSchema.optional(),
  phone:          recordText().optional(),
  companyName:    recordText().optional(),
  status:         LeadStatusSchema.optional(),
  source:         recordText().optional(),
  accountId:      id().nullable().optional(),
  assignedUserId: id().nullable().optional(),
  productInterest: z.array(ProductInterestIdSchema).max(100).optional(),
  address:        recordText().optional(),
  description:    recordText().optional(),
  website:        recordText().optional(),
});

export type CreateContactDto = z.infer<typeof CreateContactSchema>;
export type UpdateContactDto = z.infer<typeof UpdateContactSchema>;

// ── Convert Lead → linked to Account + optional Deal ─────────────────────────
export const ConvertContactSchema = z.object({
  // Account handling
  accountId:    z.string().min(1).optional(), // link to existing account
  accountName:  z.string().min(1).optional(), // or create a new account
  // Contact handling (new — conversion creates a Contact record from the Lead)
  createContact:   z.boolean().default(true),
  contactId:       z.string().min(1).optional(), // link to existing contact instead of creating
  // Deal handling
  createDeal:      z.boolean().default(false),
  dealTitle:       z.string().min(1).max(255).optional(),
  dealValue:       z.number().positive().optional(),
  dealPipelineId:  z.string().min(1).optional(),
  dealPriority:    z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  dealId:          z.string().min(1).optional(), // link to existing deal instead of creating
});

export type ConvertContactDto = z.infer<typeof ConvertContactSchema>;

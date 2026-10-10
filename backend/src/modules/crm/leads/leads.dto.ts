// Canonical Lead contracts. The old contacts path is a compatibility alias.
export { CreateLeadSchema, UpdateLeadSchema } from '@leadcrm/shared';
export type { CreateLeadInput as CreateLeadDto, UpdateLeadInput as UpdateLeadDto } from '@leadcrm/shared';
import { z } from 'zod';
export const ConvertLeadSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountName: z.string().trim().min(1).max(2000).optional(),
  createContact: z.literal(true).default(true),
  contactId: z.string().uuid().optional(),
  createDeal: z.literal(false).default(false),
  dealId: z.string().uuid().optional(),
}).strict();
export type ConvertLeadDto = z.infer<typeof ConvertLeadSchema>;

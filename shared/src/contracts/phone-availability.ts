import { z } from 'zod';
import { LeadPhoneSchema } from './lead.contract';

export const STAFF_PHONE_CONFLICT = 'This phone number belongs to a staff account and cannot be used.';
export const CUSTOMER_PHONE_CONFLICT = 'This phone number is already registered to another Lead or Contact.';
export const PHONE_AVAILABILITY_MESSAGES = {
  STAFF_PHONE_NOT_ALLOWED: STAFF_PHONE_CONFLICT,
  CUSTOMER_PHONE_CONFLICT,
} as const;
export type PhoneAvailabilityReason = keyof typeof PHONE_AVAILABILITY_MESSAGES;
export const CrmPhoneAvailabilityQuerySchema = z.object({
  module: z.enum(['leads', 'contacts']),
  phone: LeadPhoneSchema,
  excludeId: z.string().uuid().optional(),
}).strict();
export const PhoneAvailabilitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), reason: z.enum(['STAFF_PHONE_NOT_ALLOWED', 'CUSTOMER_PHONE_CONFLICT']) }),
]);
export type PhoneAvailability = z.infer<typeof PhoneAvailabilitySchema>;

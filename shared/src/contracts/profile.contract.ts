import { z } from 'zod';
import { isValidPhMobile, PH_MOBILE_ERROR, toE164 } from '../validation/ph-phone';
import { StaffEmailSchema } from '../validation/security.schema';

export const PROFILE_FIELD_LIMITS = { firstName: 50, lastName: 50, jobTitle: 100 } as const;
export const PROFILE_FIELD_LIMIT_ERRORS = {
  firstName: `First name must not exceed ${PROFILE_FIELD_LIMITS.firstName} characters.`,
  lastName: `Last name must not exceed ${PROFILE_FIELD_LIMITS.lastName} characters.`,
  jobTitle: `Job title must not exceed ${PROFILE_FIELD_LIMITS.jobTitle} characters.`,
} as const;

const profilePhone = z.string().nullable().optional().transform((value, context) => {
  if (value == null) return value;
  if (value === '') return null;
  const localNumber = value.startsWith('+63') ? value.slice(3) : value;
  if (!isValidPhMobile(localNumber)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: PH_MOBILE_ERROR });
    return z.NEVER;
  }
  return toE164(localNumber);
});
export const ProfilePhoneInputSchema = z.string().refine(value => value === '' || isValidPhMobile(value), PH_MOBILE_ERROR)
  .transform(value => value === '' ? null : toE164(value));

export const SelfProfileFieldSchemas = {
  firstName: z.string().trim().min(1, 'First name is required').max(PROFILE_FIELD_LIMITS.firstName, PROFILE_FIELD_LIMIT_ERRORS.firstName).optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(PROFILE_FIELD_LIMITS.lastName, PROFILE_FIELD_LIMIT_ERRORS.lastName).optional(),
  phone: ProfilePhoneInputSchema,
};

export const UpdateSelfProfileSchema = z.object({ ...SelfProfileFieldSchemas, phone: profilePhone }).strict()
  .refine(value => Object.keys(value).length > 0, 'No profile changes supplied');

export type UpdateSelfProfile = z.infer<typeof UpdateSelfProfileSchema>;
export const RequestProfileEmailChangeSchema = z.object({
  email: StaffEmailSchema,
  currentPassword: z.string().min(1, 'Enter your current password.').max(72),
}).strict();
export const ConfirmProfileEmailChangeSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{32}$/, 'Enter the verification code from your email.'),
}).strict();
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

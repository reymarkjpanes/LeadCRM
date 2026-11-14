import { z } from 'zod';
import { isValidPhMobile, PH_MOBILE_ERROR, toE164 } from '../validation/ph-phone';
import { maxLengthMessage } from '../validation/text-length';
import { StaffEmailSchema } from '../validation/security.schema';

export const PROFILE_FIELD_LIMITS = { firstName: 100, lastName: 100, jobTitle: 100 } as const;
export const PROFILE_FIELD_LIMIT_ERRORS = {
  firstName: maxLengthMessage('First name', PROFILE_FIELD_LIMITS.firstName),
  lastName: maxLengthMessage('Last name', PROFILE_FIELD_LIMITS.lastName),
  jobTitle: maxLengthMessage('Job title', PROFILE_FIELD_LIMITS.jobTitle),
} as const;

export function getNameDigitError(field: string | undefined, value: unknown, validateSpecialCharacters = true): string | undefined {
  if (typeof value !== 'string') return;
  const label = field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : field === 'fullName' ? 'Full name' : undefined;
  if (!label) return;
  if (/\p{N}/u.test(value) || (validateSpecialCharacters && /[^\p{L}\p{M} '\u2018\u2019\u2010\u2011-]/u.test(value))) {
    return `${label} must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().`;
  }
}

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

export function personNameSchema(field: 'firstName' | 'lastName', requiredMessage?: string) {
  const label = field === 'firstName' ? 'First name' : 'Last name';
  return z.string().superRefine((value, context) => {
    const error = getNameDigitError(field, value);
    if (error) context.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }).pipe(z.string().trim().min(1, requiredMessage ?? label + ' is required').max(PROFILE_FIELD_LIMITS[field], PROFILE_FIELD_LIMIT_ERRORS[field]));
}

export const SelfProfileFieldSchemas = {
  firstName: personNameSchema('firstName').optional(),
  lastName: personNameSchema('lastName').optional(),
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
  code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit verification code from your email.'),
}).strict();
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

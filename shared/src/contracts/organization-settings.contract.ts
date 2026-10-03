import { z } from 'zod';

const optionalText = z.string().trim().nullable().optional()
  .transform(value => value === '' ? null : value);

export const ORGANIZATION_PHONE_ERROR = 'Enter a valid Philippine telephone number.';

/** Nine national landline digits: area 2 + eight digits, or a provincial area + seven. */
export function normalizeOrganizationPhone(value: string): string | null {
  let national = value.trim();
  if (national.startsWith('+63')) national = national.slice(3).trim();
  if (!/^(?:\(\d{1,3}\)|\d+)(?:[ -]?\d+)*$/.test(national)) return null;
  let digits = national.replace(/[ ()-]/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[2-8]\d{8}$/.test(digits)) return null;
  return `+63${digits}`;
}

/** Preserve malformed saved values for correction instead of silently clearing them. */
export function formatOrganizationPhone(value: string): string {
  const normalized = normalizeOrganizationPhone(value);
  if (!normalized) return value.replace(/^\+63\s*/, '');
  const digits = normalized.slice(3);
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 5)}-${digits.slice(5)}`;
}

const organizationPhone = optionalText.transform((value, context) => {
  if (value == null) return value;
  const normalized = normalizeOrganizationPhone(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: ORGANIZATION_PHONE_ERROR });
    return z.NEVER;
  }
  return normalized;
});

export const UpdateOrganizationSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').max(255).optional(),
  industry: optionalText,
  email: optionalText.pipe(z.string().email('Enter a valid email address').nullable().optional()),
  phone: organizationPhone,
  domain: optionalText,
  address: optionalText,
}).strict().refine(value => Object.values(value).some(field => field !== undefined), 'No organization changes supplied');

export type UpdateOrganizationSettings = z.infer<typeof UpdateOrganizationSettingsSchema>;
export interface OrganizationSettings {
  id: string;
  name: string;
  industry: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  address: string | null;
}

import { z } from 'zod';
import { COMPANY_INDUSTRIES } from '../constants/company-industries';
import type { TenantStatus } from '../types/tenant.types';

export const ORGANIZATION_FIELD_LIMITS = { name: 150, industry: 32, email: 254, phone: 24, domain: 253, address: 500 } as const;
export const ORGANIZATION_FIELD_LIMIT_ERRORS = {
  name: `Organization name must not exceed ${ORGANIZATION_FIELD_LIMITS.name} characters.`,
  industry: `Use at most ${ORGANIZATION_FIELD_LIMITS.industry} characters`,
  email: `Email must not exceed ${ORGANIZATION_FIELD_LIMITS.email} characters.`,
  phone: `Phone must not exceed ${ORGANIZATION_FIELD_LIMITS.phone} characters.`,
  domain: `Domain must not exceed ${ORGANIZATION_FIELD_LIMITS.domain} characters.`,
  address: `Address must not exceed ${ORGANIZATION_FIELD_LIMITS.address} characters.`,
} as const;
const text = (limit: number, multiline = false, maxMessage = `Use at most ${limit} characters`) => z.string().trim().max(limit, maxMessage)
  .refine(value => !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/ : /[\u0000-\u001f\u007f<>]/).test(value), 'Enter plain text without markup or control characters');
const optionalText = (limit: number, maxMessage = `Use at most ${limit} characters`) => text(limit, false, maxMessage).nullable().optional().transform(value => value === '' ? null : value);
export const OrganizationRequiredFieldsSchema = z.object({
  name: text(ORGANIZATION_FIELD_LIMITS.name, false, ORGANIZATION_FIELD_LIMIT_ERRORS.name).refine(value => value.length > 0, 'Organization name is required'),
  email: z.string().trim().min(1, 'Email is required').max(ORGANIZATION_FIELD_LIMITS.email, ORGANIZATION_FIELD_LIMIT_ERRORS.email)
    .email('Enter a valid email address').transform(value => value.toLowerCase()),
});

export const ORGANIZATION_PHONE_ERROR = 'Enter a valid Philippine telephone number.';

/** Nine national landline digits: area 2 + eight digits, or a provincial area + seven. */
export function normalizeOrganizationPhone(value: string): string | null {
  let national = value.trim();
  if (national.length > ORGANIZATION_FIELD_LIMITS.phone) return null;
  if (national.startsWith('+63')) national = national.slice(3).trim();
  if (!/^(?:0?\d{9}|\(0?\d{2}\) ?\d{3}[ -]?\d{4}|(?:\(0?2\)|0?2)[ -]?\d{4}[ -]?\d{4}|0?\d{2}[ -]\d{3}[ -]?\d{4})$/.test(national)) return null;
  let digits = national.replace(/[ ()-]/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^(?:2[3-8]\d{7}|(?:3[2-8]|4[2-9]|5[2-6]|6[2-58]|7[24578]|8[2-8])\d{7})$/.test(digits)) return null;
  return `+63${digits}`;
}

/** Preserve malformed saved values for correction instead of silently clearing them. */
export function formatOrganizationPhone(value: string): string {
  const normalized = normalizeOrganizationPhone(value);
  if (!normalized) return value.replace(/^\+63\s*/, '');
  const digits = normalized.slice(3);
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 5)}-${digits.slice(5)}`;
}

const organizationPhone = optionalText(ORGANIZATION_FIELD_LIMITS.phone, ORGANIZATION_FIELD_LIMIT_ERRORS.phone).transform((value, context) => {
  if (value == null) return value;
  const normalized = normalizeOrganizationPhone(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: ORGANIZATION_PHONE_ERROR });
    return z.NEVER;
  }
  return normalized;
});

export const UpdateOrganizationSettingsSchema = z.object({
  name: OrganizationRequiredFieldsSchema.shape.name.optional(),
  industry: optionalText(ORGANIZATION_FIELD_LIMITS.industry, ORGANIZATION_FIELD_LIMIT_ERRORS.industry).pipe(z.enum(COMPANY_INDUSTRIES, { errorMap: () => ({ message: 'Select a supported industry' }) }).nullable().optional()),
  email: OrganizationRequiredFieldsSchema.shape.email.optional(),
  phone: organizationPhone,
  domain: optionalText(ORGANIZATION_FIELD_LIMITS.domain, ORGANIZATION_FIELD_LIMIT_ERRORS.domain).transform(value => value?.toLowerCase() ?? value)
    .refine(value => value == null || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value), 'Enter a valid domain, such as camxian.com'),
  address: z.string().refine(value => value === '' || value.trim().length > 0, 'Office address cannot contain only whitespace')
    .pipe(text(ORGANIZATION_FIELD_LIMITS.address, true, ORGANIZATION_FIELD_LIMIT_ERRORS.address)).nullable().optional().transform(value => value === '' ? null : value),
}).strict().refine(value => Object.values(value).some(field => field !== undefined), 'No organization changes supplied');

export type UpdateOrganizationSettings = z.infer<typeof UpdateOrganizationSettingsSchema>;
export interface OrganizationSettings {
  id: string;
  status: TenantStatus;
  name: string;
  industry: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  address: string | null;
}

import { z } from 'zod';

// Validates a domain hostname: alphanumeric + hyphens, at least one dot
const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export const CreateDomainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .max(253, 'Domain must be 253 characters or fewer')
    .toLowerCase()
    .refine((d) => DOMAIN_REGEX.test(d), 'Invalid domain format (e.g. example.com)'),
});

export const UpdateDomainSettingsSchema = z.object({
  restrictToEmailDomains: z.boolean(),
  joinPolicy: z.enum(['instantly', 'after_approval']),
  defaultRole: z.string().min(1).max(100),
});

export type CreateDomainDTO = z.infer<typeof CreateDomainSchema>;
export type UpdateDomainSettingsDTO = z.infer<typeof UpdateDomainSettingsSchema>;

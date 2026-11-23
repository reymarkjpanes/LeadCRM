import { z } from 'zod';
import { cleanText } from '../validation/administration-user.schema';
import { CustomFieldValuesSchema } from './closing-requirements';
import { COMPANY_SIZE_OPTIONS } from './record-experience';
import { maxLengthMessage } from '../validation/text-length';

export const COMPANY_NAME_MAX_LENGTH = 255;
export const CRM_ADDRESS_MAX_LENGTH = 500;
export const COMPANY_NAME_MAX_ERROR = maxLengthMessage('Company name', COMPANY_NAME_MAX_LENGTH);
export const CRM_ADDRESS_MAX_ERROR = maxLengthMessage('Address', CRM_ADDRESS_MAX_LENGTH);
export const CrmCompanyNameSchema = cleanText(COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR);

export function companyNameMatchKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const legalSuffixes = new Set(['inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited', 'llc', 'co', 'company']);

/** A possible-duplicate key. Keep stored names and relationship matching intact. */
export function accountNameReviewKey(name: string): string {
  const words = name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  while (words.length > 1 && legalSuffixes.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export const ACCOUNT_DUPLICATE_REVIEW_CODE = 'POSSIBLE_DUPLICATE_ACCOUNT';
export const ACCOUNT_DUPLICATE_REVIEW_MESSAGE = 'An Account with a similar name already exists.';
export const AccountDuplicateReviewTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const AccountDuplicateMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  website: z.string().nullish(),
  address: z.string().nullish(),
});
export const AccountDuplicateReviewSchema = z.object({
  token: AccountDuplicateReviewTokenSchema,
  matches: z.array(AccountDuplicateMatchSchema).min(1),
});
export type AccountDuplicateMatch = z.infer<typeof AccountDuplicateMatchSchema>;
export type AccountDuplicateReview = z.infer<typeof AccountDuplicateReviewSchema>;

export const CrmAddressSchema = z.string()
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), 'Control characters are not allowed.')
  .transform(value => value.trim()).pipe(z.string().max(CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR));

/** Native Account fields shared by standalone and linked Account forms. */
export const AccountFieldsSchema = z.object({
  name: CrmCompanyNameSchema.pipe(z.string().min(1, 'Account name is required.')),
  industry: cleanText(2000).optional(),
  size: z.enum(COMPANY_SIZE_OPTIONS).optional(),
  website: z.string().trim().url('Must be a valid URL').optional().or(z.literal('')),
  address: CrmAddressSchema.optional(),
});

/** Omitted fields stay unchanged; null explicitly clears an optional Company Size. */
export const AccountUpdateFieldsSchema = AccountFieldsSchema.partial().extend({
  size: AccountFieldsSchema.shape.size.nullable(),
});

/** A retry identity belongs to this Account creation, including saves from edit forms. */
export const NewAccountSchema = AccountFieldsSchema.extend({
  requestId: z.string().uuid(),
  duplicateReviewToken: AccountDuplicateReviewTokenSchema.optional(),
  customFieldValues: CustomFieldValuesSchema.optional(),
}).strict();
export type NewAccountInput = z.infer<typeof NewAccountSchema>;
export interface AccountSummary {
  id: string; name: string; industry?: string | null; size?: string | null; website?: string | null;
}
export function exclusiveAccountInput(input: { accountId?: unknown; newAccount?: unknown }) {
  return !input.newAccount || !input.accountId;
}

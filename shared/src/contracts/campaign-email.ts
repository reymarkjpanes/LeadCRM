import { z } from 'zod';

export const EMAIL_VARIABLES = ['first_name', 'last_name', 'company_name', 'contact_number', 'status', 'sender_name', 'sender_email'] as const;
export type EmailVariables = Partial<Record<typeof EMAIL_VARIABLES[number], string>>;
export const EMAIL_VARIABLE_TOKENS = EMAIL_VARIABLES.map(key => `{{${key}}}`);
export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function renderEmailVariables(text: string, values: EmailVariables, html = false): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, key: string) => {
    if (!EMAIL_VARIABLES.includes(key as typeof EMAIL_VARIABLES[number])) return '';
    const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key as keyof EmailVariables] ?? '' : '';
    return html ? escapeEmailHtml(value) : value.replace(/[\x00-\x1f\x7f]/g, ' ');
  });
}
export const MarketingNameSchema = z.string().trim().min(1, 'Name is required.').max(150).regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.');
export const EmailSubjectSchema = z.string().max(200).regex(/^[^\x00-\x1f\x7f]*$/, 'Subject must not contain line breaks or control characters.').transform(s => s.trim());
export const AudienceSourceSchema = z.enum(['LEADS', 'CONTACTS', 'ALL']);
export const AUDIENCE_FIELDS = ['status', 'source', 'company', 'productInterest', 'assignedUserId', 'createdAt'] as const;
export const AUDIENCE_OPERATORS = ['equals', 'not_equals', 'contains', 'gte', 'lte'] as const;
export const AudienceConditionSchema = z.object({
  field: z.enum(AUDIENCE_FIELDS), operator: z.enum(AUDIENCE_OPERATORS),
  value: z.string().trim().min(1, 'Value is required.').max(200).regex(/^[^\x00-\x1f\x7f]*$/),
}).strict().superRefine((c, ctx) => {
  const allowed = c.field === 'createdAt' ? ['gte', 'lte'] : ['status', 'assignedUserId', 'productInterest'].includes(c.field) ? ['equals', 'not_equals'] : ['equals', 'not_equals', 'contains'];
  if (!allowed.includes(c.operator)) ctx.addIssue({ code: 'custom', path: ['operator'], message: 'Operator is not supported for this field.' });
  if (c.field === 'createdAt' && (!/^\d{4}-\d{2}-\d{2}$/.test(c.value) || Number.isNaN(Date.parse(c.value)) || new Date(c.value).toISOString().slice(0, 10) !== c.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a valid date (YYYY-MM-DD).' });
  if (c.field === 'assignedUserId' && !z.string().uuid().safeParse(c.value).success) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an agent ID.' });
  if (c.field === 'status' && !['HOT', 'WARM', 'COLD', 'CANCELLED', 'CLOSED', 'Inquiry', 'Qualified', 'Converted', 'Archived'].includes(c.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Select a valid CRM status.' });
});
export const AudiencePreviewSchema = z.object({ source: AudienceSourceSchema, conditions: z.array(AudienceConditionSchema).max(20).default([]) }).strict();
export const CreateAudienceSchema = AudiencePreviewSchema.extend({ name: MarketingNameSchema });
export type AudienceInput = z.infer<typeof AudiencePreviewSchema>;
export interface SavedAudience extends AudienceInput { id: string; name: string }
export interface AudienceBreakdown { matched: number; eligible: number; missingEmail: number; invalidEmail: number; duplicateEmail: number; staffEmail: number; unsubscribed: number; blocked: number; inactive: number; recipientNotAllowed: number }
export const CampaignDraftSchema = z.object({
  name: MarketingNameSchema, type: z.enum(['EMAIL', 'SMS', 'MULTI_CHANNEL']),
  subject: EmailSubjectSchema.optional(), body: z.string().max(50000).optional(),
  audienceSource: AudienceSourceSchema.optional().nullable(), targetAudienceId: z.string().uuid().optional().nullable(),
  emailTemplateId: z.string().uuid().optional().nullable(), smsTemplateId: z.string().uuid().optional().nullable(),
}).strict();
export const CampaignSendSchema = CampaignDraftSchema.superRefine((v, ctx) => {
  if (!v.audienceSource && !v.targetAudienceId) ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Target audience is required.' });
  if (v.type === 'EMAIL' && !v.subject?.trim()) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
  if (!v.body?.trim()) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Body is required.' });
});
export const MarketingTemplateSchema = z.object({ name: MarketingNameSchema, type: z.enum(['Email', 'SMS']), category: MarketingNameSchema.optional(), subject: EmailSubjectSchema.optional(), content: z.string().trim().min(1, 'Message content is required.').max(50000) }).strict().superRefine((v, ctx) => {
  if (v.type === 'Email' && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
});
export interface CampaignSendResult { campaignId: string; eligibleRecipients: number; submittedRecipients: number; failedRecipients: number; status: string }

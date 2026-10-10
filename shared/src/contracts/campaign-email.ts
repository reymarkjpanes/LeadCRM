import { z } from 'zod';
import { CrmStatusSchema, LeadSourceSchema } from './record-experience';
import { LeadCreatedFilterSchema } from './lead-created.contract';

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
export const AUDIENCE_OPERATORS = ['equals', 'not_equals', 'contains', 'any', 'gte', 'lte', 'between'] as const;
const equality = z.enum(['equals', 'not_equals']);
export const AudienceConditionSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('status'), operator: equality, value: z.enum(CrmStatusSchema.options, { errorMap: () => ({ message: 'Select a status.' }) }) }).strict(),
  z.object({ field: z.literal('source'), operator: equality, value: z.enum(LeadSourceSchema.options, { errorMap: () => ({ message: 'Select a source.' }) }) }).strict(),
  z.object({ field: z.literal('company'), operator: z.enum(['equals', 'not_equals', 'contains']), value: z.string().trim().min(1, 'Select a company.').max(200).regex(/^[^\x00-\x1f\x7f]*$/) }).strict(),
  z.object({ field: z.literal('productInterest'), operator: equality, value: z.array(z.string().uuid()).min(1, 'Select a Product Interest.').max(100).transform(ids => [...new Set(ids)]) }).strict(),
  z.object({ field: z.literal('assignedUserId'), operator: equality, value: z.string().uuid('Select an Assigned Agent.') }).strict(),
  z.object({ field: z.literal('createdAt'), operator: z.enum(['any', 'gte', 'lte', 'between']), value: z.union([z.string(), z.object({ from: z.string(), to: z.string() }).strict(), z.null()]) }).strict(),
]).superRefine((c, ctx) => {
  if (c.field !== 'createdAt') return;
  if (c.operator === 'any') {
    if (c.value !== null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Any date has no value.' });
    return;
  }
  const parsed = LeadCreatedFilterSchema.safeParse(c.operator === 'between'
    ? { operator: c.operator, ...(typeof c.value === 'object' ? c.value : {}) }
    : { operator: c.operator, date: c.value });
  if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['value'], message: c.operator === 'between' ? 'Enter valid dates with From on or before To.' : 'Select a valid date.' });
});
export type AudienceCondition = z.infer<typeof AudienceConditionSchema>;
export const AudiencePreviewSchema = z.object({ source: AudienceSourceSchema, conditions: z.array(AudienceConditionSchema).max(20).default([]) }).strict();
export const AudiencePreviewRequestSchema = AudiencePreviewSchema.extend({ channel: z.enum(['EMAIL', 'SMS']).default('EMAIL'), page: z.number().int().min(1).max(100000).default(1), limit: z.number().int().min(1).max(50).default(25) });
export type AudiencePreviewRequest = z.input<typeof AudiencePreviewRequestSchema>;
export const CreateAudienceSchema = AudiencePreviewSchema.extend({ name: MarketingNameSchema });
export type AudienceInput = z.infer<typeof AudiencePreviewSchema>;
export interface SavedAudience extends AudienceInput { id: string; name: string }
export interface AudienceBreakdown { matched: number; eligible: number; missingEmail: number; invalidEmail: number; duplicateEmail: number; staffEmail: number; unsubscribed: number; blocked: number; inactive: number; recipientNotAllowed: number; missingPhone?: number; invalidPhone?: number; duplicatePhone?: number; doNotContact?: number }
export interface AudienceRecipientPreview { id: string; name: string; recordType: 'Lead' | 'Contact'; company: string; email: string | null; phone: string | null }
export interface AudiencePreviewResult extends AudienceBreakdown { recipients: AudienceRecipientPreview[]; meta: { page: number; limit: number; total: number; hasMore: boolean } }

// Application safety bound, not a TextBee limit. TextBee documents multipart
// segmentation but no hard message-length maximum in its public API contract.
export const SMS_MAX_LENGTH = 50000;
export const SMS_CAMXIAN_FOOTER = 'For inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.';
/** Shared by previews, campaign preflight and every server-side SMS caller. */
export function buildFinalSms({ body, variables }: { body: string; variables?: EmailVariables }): string {
  let content = (variables ? renderEmailVariables(body, variables) : body).trim();
  // Rebuilding a prepared message replaces its system footer instead of stacking it.
  const generatedFooter = /(?:\s*\n\n)?(?:For inquiries regarding our products and services, contact Camxian Technologies:\r?\n[^\r\n]+\r?\n\r?\nThis is a no-reply message\.|For product inquiries, contact Camxian Technologies at [^\r\n]+\.\r?\nThis SMS is no-reply\.)$/;
  while (generatedFooter.test(content)) content = content.replace(generatedFooter, '').trimEnd();
  return `${content}\n\n${SMS_CAMXIAN_FOOTER}`;
}
export function appendSmsFooter(content: string): string {
  return buildFinalSms({ body: content });
}
/** GSM extension characters occupy two septets; Unicode uses UTF-16 units. */
export function smsMessageStats(message: string) {
  const basic = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  const extension = '\f^{}\\[~]|€';
  let units = 0;
  for (const character of message) {
    if (basic.includes(character)) units++;
    else if (extension.includes(character)) units += 2;
    else return { characters: [...message].length, encoding: 'Unicode', segments: message.length <= 70 ? 1 : Math.ceil(message.length / 67) };
  }
  return { characters: [...message].length, encoding: 'GSM-7', segments: units <= 160 ? 1 : Math.ceil(units / 153) };
}
export const CampaignDraftSchema = z.object({
  name: MarketingNameSchema, type: z.enum(['EMAIL', 'SMS', 'MULTI_CHANNEL']),
  subject: EmailSubjectSchema.optional(), body: z.string().max(50000).optional(),
  audienceSource: AudienceSourceSchema.optional().nullable(), targetAudienceId: z.string().uuid().optional().nullable(),
  emailTemplateId: z.string().uuid().optional().nullable(), smsTemplateId: z.string().uuid().optional().nullable(),
}).strict();
export const CreateCampaignDraftSchema = CampaignDraftSchema.extend({ type: z.enum(['EMAIL', 'SMS'], { errorMap: () => ({ message: 'Select Email or SMS.' }) }) });
export const CampaignSendSchema = CampaignDraftSchema.superRefine((v, ctx) => {
  if (!v.audienceSource && !v.targetAudienceId) ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Target audience is required.' });
  if (v.type === 'EMAIL' && !v.subject?.trim()) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
  if (!v.body?.trim()) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Body is required.' });
});
export const MarketingTemplateSchema = z.object({ name: MarketingNameSchema, type: z.enum(['Email', 'SMS']), category: MarketingNameSchema.optional(), subject: EmailSubjectSchema.optional(), content: z.string().trim().min(1, 'Message content is required.').max(50000) }).strict().superRefine((v, ctx) => {
  if (v.type === 'Email' && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
});
export interface CampaignSendResult { campaignId: string; eligibleRecipients: number; submittedRecipients: number; failedRecipients: number; status: import('../types/campaign.types').CampaignStatus; submissionComplete?: boolean; submissionInterrupted?: boolean }

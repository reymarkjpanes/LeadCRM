import { z } from 'zod';
import { CrmStatusSchema, LeadSourceSchema } from './record-experience';
import { LeadCreatedFilterSchema } from './lead-created.contract';
import { QuotationTemplateContentSchema } from './quotation.contract';

export const EMAIL_VARIABLES = ['first_name', 'last_name', 'company_name', 'contact_number', 'status', 'sender_name', 'sender_email'] as const;
export type EmailVariables = Record<string, string | undefined>;
export const EMAIL_VARIABLE_TOKENS = EMAIL_VARIABLES.map(key => `{{${key}}}`);
export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function renderEmailVariables(text: string, values: EmailVariables, html = false, preserveUnresolved = false): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, key: string) => {
    if (preserveUnresolved && (!Object.prototype.hasOwnProperty.call(values, key) || values[key] == null)) return _token;
    const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key as keyof EmailVariables] ?? '' : '';
    return html ? escapeEmailHtml(value) : value.replace(/[\x00-\x1f\x7f]/g, ' ');
  });
}
export const MarketingNameSchema = z.string().trim().min(1, 'Name is required.').max(150).regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.');
const currentCompanyVariable = (text: string) => !campaignVariableKeys(text).includes('company');
const companyVariableMessage = 'Use {{companyName}} instead of {{company}}.';
export const EmailSubjectSchema = z.string().max(200).regex(/^[^\x00-\x1f\x7f]*$/, 'Subject must not contain line breaks or control characters.').transform(s => s.trim()).refine(currentCompanyVariable, companyVariableMessage);
/** ALL remains a historical read value only. New operations choose one source. */
export const AudienceSourceSchema = z.enum(['LEADS', 'CONTACTS']);
export const AudienceMatchModeSchema = z.enum(['AND', 'OR']);
export const AUDIENCE_FIELDS = ['status', 'source', 'companyName', 'productInterest', 'assignedUserId', 'createdAt'] as const;
export const AUDIENCE_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'any', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'] as const;
export const AudienceConditionSchema = z.object({
  field: z.string().min(1).max(160).regex(/^(?:[A-Za-z][A-Za-z0-9]*|customFieldValues\.[A-Za-z0-9_-]+)$/),
  operator: z.enum(AUDIENCE_OPERATORS),
  value: z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.array(z.string().max(1000)).max(100), z.object({ from: z.string(), to: z.string() }).strict(), z.null()]),
}).strict().superRefine((c, ctx) => {
  if (['is_empty', 'is_not_empty', 'any'].includes(c.operator)) {
    if (c.value !== null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Presence and Any date operators have no value.' });
  } else if (c.value === null || c.value === '' || Array.isArray(c.value) && !c.value.length) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a condition value.' });
  if (c.field === 'createdAt' && !['is_empty', 'is_not_empty', 'any'].includes(c.operator)) {
    const parsed = LeadCreatedFilterSchema.safeParse(c.operator === 'between' ? { operator: c.operator, ...(typeof c.value === 'object' ? c.value : {}) } : { operator: c.operator, date: c.value });
    if (!parsed.success) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter valid calendar dates with From on or before To.' });
  }
});
export type AudienceCondition = z.infer<typeof AudienceConditionSchema>;
export const AudiencePreviewSchema = z.object({ source: AudienceSourceSchema, matchMode: AudienceMatchModeSchema.default('AND'), conditions: z.array(AudienceConditionSchema).max(20).default([]) }).strict();
export const AudiencePreviewRequestSchema = AudiencePreviewSchema.extend({ channel: z.enum(['EMAIL', 'SMS']).default('EMAIL'), page: z.number().int().min(1).max(100000).default(1), limit: z.number().int().min(1).max(50).default(25) });
export type AudiencePreviewRequest = z.input<typeof AudiencePreviewRequestSchema>;
export const CreateAudienceSchema = AudiencePreviewSchema.extend({ name: MarketingNameSchema });
export type AudienceInput = z.infer<typeof AudiencePreviewSchema>;
export interface SavedAudience { id: string; name: string; source: AudienceInput['source'] | 'ALL'; matchMode?: 'AND' | 'OR'; conditions: AudienceCondition[]; repairReason?: string }
export const CampaignScheduleSchema = z.object({ scheduledFor: z.string().datetime({ offset: true }).refine(value => new Date(value).getTime() > Date.now(), 'Schedule a future date and time.') }).strict();
export const CampaignScheduleConfigSchema = AudiencePreviewSchema.extend({ timezone: z.literal('Asia/Manila'), scheduleFailureReason: z.string().max(1000).optional() });
export type CampaignScheduleConfig = z.infer<typeof CampaignScheduleConfigSchema>;
export function campaignVariableKeys(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]))];
}
export interface AudienceBreakdown { matched: number; eligible: number; missingEmail: number; invalidEmail: number; duplicateEmail: number; staffEmail: number; unsubscribed: number; blocked: number; inactive: number; recipientNotAllowed: number; missingPhone?: number; invalidPhone?: number; duplicatePhone?: number; doNotContact?: number }
export interface AudienceRecipientPreview { id: string; name: string; recordType: 'Lead' | 'Contact'; companyName: string; email: string | null; phone: string | null }
export interface AudiencePreviewResult extends AudienceBreakdown { recipients: AudienceRecipientPreview[]; meta: { page: number; limit: number; total: number; hasMore: boolean } }

// Application safety bound, not a TextBee limit. TextBee documents multipart
// segmentation but no hard message-length maximum in its public API contract.
export const SMS_MAX_LENGTH = 50000;
/** Editable starting content for a new SMS, never appended by the transport. */
export const SMS_DEFAULT_FOOTER = 'For inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.';
export function hasDefaultSmsFooter(body: string): boolean {
  return body.replace(/\r\n?/g, '\n').includes(SMS_DEFAULT_FOOTER);
}
export function insertDefaultSmsFooter(body: string): string {
  if (hasDefaultSmsFooter(body)) return body;
  const content = body.trimEnd();
  return content ? `${content}\n\n${SMS_DEFAULT_FOOTER}` : SMS_DEFAULT_FOOTER;
}
/** Shared by previews, campaign preflight and every server-side SMS caller. */
export function buildFinalSms({ body, variables }: { body: string; variables?: EmailVariables }): string {
  return (variables ? renderEmailVariables(body, variables) : body).trim();
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
  subject: EmailSubjectSchema.optional(), body: z.string().max(50000).refine(currentCompanyVariable, companyVariableMessage).optional(),
  audienceSource: AudienceSourceSchema.optional().nullable(), targetAudienceId: z.string().uuid().optional().nullable(),
  emailTemplateId: z.string().uuid().optional().nullable(), smsTemplateId: z.string().uuid().optional().nullable(),
}).strict();
export const CreateCampaignDraftSchema = CampaignDraftSchema.extend({ type: z.enum(['EMAIL', 'SMS'], { errorMap: () => ({ message: 'Select Email or SMS.' }) }) });
export const CampaignSendSchema = CampaignDraftSchema.superRefine((v, ctx) => {
  if (v.audienceSource && v.targetAudienceId) ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Select a saved audience or a source, not both.' });
  if (!v.audienceSource && !v.targetAudienceId) ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Target audience is required.' });
  if (v.type === 'EMAIL' && !v.subject?.trim()) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
  if (!v.body?.trim()) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Body is required.' });
});
export const MarketingTemplateSchema = z.object({ name: MarketingNameSchema, type: z.enum(['Email', 'SMS', 'Quotation']), category: MarketingNameSchema.optional(), subject: EmailSubjectSchema.optional(), content: z.string().trim().min(1, 'Message content is required.').max(50000).refine(currentCompanyVariable, companyVariableMessage) }).strict().superRefine((v, ctx) => {
  if (v.type === 'Email' && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
  if (v.type === 'Quotation') {
    if (!v.category) ctx.addIssue({ code: 'custom', path: ['category'], message: 'Category is required.' });
    let content: unknown;
    try { content = JSON.parse(v.content); } catch { /* Report through the shared schema below. */ }
    const parsed = QuotationTemplateContentSchema.safeParse(content);
    if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: ['content', ...issue.path], message: issue.message });
  }
});
export interface CampaignSendResult { campaignId: string; eligibleRecipients: number; submittedRecipients: number; failedRecipients: number; status: import('../types/campaign.types').CampaignStatus; submissionComplete?: boolean; submissionInterrupted?: boolean }

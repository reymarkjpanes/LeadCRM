"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketingTemplateSchema = exports.CampaignSendSchema = exports.CreateCampaignDraftSchema = exports.CampaignDraftSchema = exports.SMS_CAMXIAN_FOOTER = exports.SMS_MAX_LENGTH = exports.CreateAudienceSchema = exports.AudiencePreviewRequestSchema = exports.AudiencePreviewSchema = exports.AudienceConditionSchema = exports.AUDIENCE_OPERATORS = exports.AUDIENCE_FIELDS = exports.AudienceSourceSchema = exports.EmailSubjectSchema = exports.MarketingNameSchema = exports.EMAIL_VARIABLE_TOKENS = exports.EMAIL_VARIABLES = void 0;
exports.escapeEmailHtml = escapeEmailHtml;
exports.renderEmailVariables = renderEmailVariables;
exports.buildFinalSms = buildFinalSms;
exports.appendSmsFooter = appendSmsFooter;
exports.smsMessageStats = smsMessageStats;
const zod_1 = require("zod");
const record_experience_1 = require("./record-experience");
const lead_created_contract_1 = require("./lead-created.contract");
exports.EMAIL_VARIABLES = ['first_name', 'last_name', 'company_name', 'contact_number', 'status', 'sender_name', 'sender_email'];
exports.EMAIL_VARIABLE_TOKENS = exports.EMAIL_VARIABLES.map(key => `{{${key}}}`);
function escapeEmailHtml(value) {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function renderEmailVariables(text, values, html = false) {
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, key) => {
        if (!exports.EMAIL_VARIABLES.includes(key))
            return '';
        const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] ?? '' : '';
        return html ? escapeEmailHtml(value) : value.replace(/[\x00-\x1f\x7f]/g, ' ');
    });
}
exports.MarketingNameSchema = zod_1.z.string().trim().min(1, 'Name is required.').max(150).regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.');
exports.EmailSubjectSchema = zod_1.z.string().max(200).regex(/^[^\x00-\x1f\x7f]*$/, 'Subject must not contain line breaks or control characters.').transform(s => s.trim());
exports.AudienceSourceSchema = zod_1.z.enum(['LEADS', 'CONTACTS', 'ALL']);
exports.AUDIENCE_FIELDS = ['status', 'source', 'company', 'productInterest', 'assignedUserId', 'createdAt'];
exports.AUDIENCE_OPERATORS = ['equals', 'not_equals', 'contains', 'any', 'gte', 'lte', 'between'];
const equality = zod_1.z.enum(['equals', 'not_equals']);
exports.AudienceConditionSchema = zod_1.z.discriminatedUnion('field', [
    zod_1.z.object({ field: zod_1.z.literal('status'), operator: equality, value: zod_1.z.enum(record_experience_1.CrmStatusSchema.options, { errorMap: () => ({ message: 'Select a status.' }) }) }).strict(),
    zod_1.z.object({ field: zod_1.z.literal('source'), operator: equality, value: zod_1.z.enum(record_experience_1.LeadSourceSchema.options, { errorMap: () => ({ message: 'Select a source.' }) }) }).strict(),
    zod_1.z.object({ field: zod_1.z.literal('company'), operator: zod_1.z.enum(['equals', 'not_equals', 'contains']), value: zod_1.z.string().trim().min(1, 'Select a company.').max(200).regex(/^[^\x00-\x1f\x7f]*$/) }).strict(),
    zod_1.z.object({ field: zod_1.z.literal('productInterest'), operator: equality, value: zod_1.z.array(zod_1.z.string().uuid()).min(1, 'Select a Product Interest.').max(100).transform(ids => [...new Set(ids)]) }).strict(),
    zod_1.z.object({ field: zod_1.z.literal('assignedUserId'), operator: equality, value: zod_1.z.string().uuid('Select an Assigned Agent.') }).strict(),
    zod_1.z.object({ field: zod_1.z.literal('createdAt'), operator: zod_1.z.enum(['any', 'gte', 'lte', 'between']), value: zod_1.z.union([zod_1.z.string(), zod_1.z.object({ from: zod_1.z.string(), to: zod_1.z.string() }).strict(), zod_1.z.null()]) }).strict(),
]).superRefine((c, ctx) => {
    if (c.field !== 'createdAt')
        return;
    if (c.operator === 'any') {
        if (c.value !== null)
            ctx.addIssue({ code: 'custom', path: ['value'], message: 'Any date has no value.' });
        return;
    }
    const parsed = lead_created_contract_1.LeadCreatedFilterSchema.safeParse(c.operator === 'between'
        ? { operator: c.operator, ...(typeof c.value === 'object' ? c.value : {}) }
        : { operator: c.operator, date: c.value });
    if (!parsed.success)
        ctx.addIssue({ code: 'custom', path: ['value'], message: c.operator === 'between' ? 'Enter valid dates with From on or before To.' : 'Select a valid date.' });
});
exports.AudiencePreviewSchema = zod_1.z.object({ source: exports.AudienceSourceSchema, conditions: zod_1.z.array(exports.AudienceConditionSchema).max(20).default([]) }).strict();
exports.AudiencePreviewRequestSchema = exports.AudiencePreviewSchema.extend({ channel: zod_1.z.enum(['EMAIL', 'SMS']).default('EMAIL'), page: zod_1.z.number().int().min(1).max(100000).default(1), limit: zod_1.z.number().int().min(1).max(50).default(25) });
exports.CreateAudienceSchema = exports.AudiencePreviewSchema.extend({ name: exports.MarketingNameSchema });
// Application safety bound, not a TextBee limit. TextBee documents multipart
// segmentation but no hard message-length maximum in its public API contract.
exports.SMS_MAX_LENGTH = 50000;
exports.SMS_CAMXIAN_FOOTER = 'For inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.';
/** Shared by previews, campaign preflight and every server-side SMS caller. */
function buildFinalSms({ body, variables }) {
    let content = (variables ? renderEmailVariables(body, variables) : body).trim();
    // Rebuilding a prepared message replaces its system footer instead of stacking it.
    const generatedFooter = /(?:\s*\n\n)?(?:For inquiries regarding our products and services, contact Camxian Technologies:\r?\n[^\r\n]+\r?\n\r?\nThis is a no-reply message\.|For product inquiries, contact Camxian Technologies at [^\r\n]+\.\r?\nThis SMS is no-reply\.)$/;
    while (generatedFooter.test(content))
        content = content.replace(generatedFooter, '').trimEnd();
    return `${content}\n\n${exports.SMS_CAMXIAN_FOOTER}`;
}
function appendSmsFooter(content) {
    return buildFinalSms({ body: content });
}
/** GSM extension characters occupy two septets; Unicode uses UTF-16 units. */
function smsMessageStats(message) {
    const basic = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
    const extension = '\f^{}\\[~]|€';
    let units = 0;
    for (const character of message) {
        if (basic.includes(character))
            units++;
        else if (extension.includes(character))
            units += 2;
        else
            return { characters: [...message].length, encoding: 'Unicode', segments: message.length <= 70 ? 1 : Math.ceil(message.length / 67) };
    }
    return { characters: [...message].length, encoding: 'GSM-7', segments: units <= 160 ? 1 : Math.ceil(units / 153) };
}
exports.CampaignDraftSchema = zod_1.z.object({
    name: exports.MarketingNameSchema, type: zod_1.z.enum(['EMAIL', 'SMS', 'MULTI_CHANNEL']),
    subject: exports.EmailSubjectSchema.optional(), body: zod_1.z.string().max(50000).optional(),
    audienceSource: exports.AudienceSourceSchema.optional().nullable(), targetAudienceId: zod_1.z.string().uuid().optional().nullable(),
    emailTemplateId: zod_1.z.string().uuid().optional().nullable(), smsTemplateId: zod_1.z.string().uuid().optional().nullable(),
}).strict();
exports.CreateCampaignDraftSchema = exports.CampaignDraftSchema.extend({ type: zod_1.z.enum(['EMAIL', 'SMS'], { errorMap: () => ({ message: 'Select Email or SMS.' }) }) });
exports.CampaignSendSchema = exports.CampaignDraftSchema.superRefine((v, ctx) => {
    if (!v.audienceSource && !v.targetAudienceId)
        ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Target audience is required.' });
    if (v.type === 'EMAIL' && !v.subject?.trim())
        ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
    if (!v.body?.trim())
        ctx.addIssue({ code: 'custom', path: ['body'], message: 'Body is required.' });
});
exports.MarketingTemplateSchema = zod_1.z.object({ name: exports.MarketingNameSchema, type: zod_1.z.enum(['Email', 'SMS']), category: exports.MarketingNameSchema.optional(), subject: exports.EmailSubjectSchema.optional(), content: zod_1.z.string().trim().min(1, 'Message content is required.').max(50000) }).strict().superRefine((v, ctx) => {
    if (v.type === 'Email' && !v.subject)
        ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
});

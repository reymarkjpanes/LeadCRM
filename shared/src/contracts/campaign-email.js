"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketingTemplateSchema = exports.CampaignSendSchema = exports.CreateCampaignDraftSchema = exports.CampaignDraftSchema = exports.SMS_DEFAULT_FOOTER = exports.SMS_MAX_LENGTH = exports.CampaignScheduleConfigSchema = exports.CampaignScheduleSchema = exports.CreateAudienceSchema = exports.AudiencePreviewRequestSchema = exports.AudiencePreviewSchema = exports.AudienceConditionSchema = exports.AUDIENCE_OPERATORS = exports.AUDIENCE_FIELDS = exports.AudienceMatchModeSchema = exports.AudienceSourceSchema = exports.EmailSubjectSchema = exports.MarketingNameSchema = exports.EMAIL_VARIABLE_TOKENS = exports.EMAIL_VARIABLES = void 0;
exports.escapeEmailHtml = escapeEmailHtml;
exports.renderEmailVariables = renderEmailVariables;
exports.campaignVariableKeys = campaignVariableKeys;
exports.hasDefaultSmsFooter = hasDefaultSmsFooter;
exports.insertDefaultSmsFooter = insertDefaultSmsFooter;
exports.buildFinalSms = buildFinalSms;
exports.smsMessageStats = smsMessageStats;
const zod_1 = require("zod");
const lead_created_contract_1 = require("./lead-created.contract");
const quotation_contract_1 = require("./quotation.contract");
exports.EMAIL_VARIABLES = ['first_name', 'last_name', 'company_name', 'contact_number', 'status', 'sender_name', 'sender_email'];
exports.EMAIL_VARIABLE_TOKENS = exports.EMAIL_VARIABLES.map(key => `{{${key}}}`);
function escapeEmailHtml(value) {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function renderEmailVariables(text, values, html = false, preserveUnresolved = false) {
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_token, key) => {
        if (preserveUnresolved && (!Object.prototype.hasOwnProperty.call(values, key) || values[key] == null))
            return _token;
        const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] ?? '' : '';
        return html ? escapeEmailHtml(value) : value.replace(/[\x00-\x1f\x7f]/g, ' ');
    });
}
exports.MarketingNameSchema = zod_1.z.string().trim().min(1, 'Name is required.').max(150).regex(/^[^\x00-\x1f\x7f]*$/, 'Control characters are not allowed.');
const currentCompanyVariable = (text) => !campaignVariableKeys(text).includes('company');
const companyVariableMessage = 'Use {{companyName}} instead of {{company}}.';
exports.EmailSubjectSchema = zod_1.z.string().max(200).regex(/^[^\x00-\x1f\x7f]*$/, 'Subject must not contain line breaks or control characters.').transform(s => s.trim()).refine(currentCompanyVariable, companyVariableMessage);
/** ALL remains a historical read value only. New operations choose one source. */
exports.AudienceSourceSchema = zod_1.z.enum(['LEADS', 'CONTACTS']);
exports.AudienceMatchModeSchema = zod_1.z.enum(['AND', 'OR']);
exports.AUDIENCE_FIELDS = ['status', 'source', 'companyName', 'productInterest', 'assignedUserId', 'createdAt'];
exports.AUDIENCE_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'any', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'];
exports.AudienceConditionSchema = zod_1.z.object({
    field: zod_1.z.string().min(1).max(160).regex(/^(?:[A-Za-z][A-Za-z0-9]*|customFieldValues\.[A-Za-z0-9_-]+)$/),
    operator: zod_1.z.enum(exports.AUDIENCE_OPERATORS),
    value: zod_1.z.union([zod_1.z.string().max(10000), zod_1.z.number().finite(), zod_1.z.boolean(), zod_1.z.array(zod_1.z.string().max(1000)).max(100), zod_1.z.object({ from: zod_1.z.string(), to: zod_1.z.string() }).strict(), zod_1.z.null()]),
}).strict().superRefine((c, ctx) => {
    if (['is_empty', 'is_not_empty', 'any'].includes(c.operator)) {
        if (c.value !== null)
            ctx.addIssue({ code: 'custom', path: ['value'], message: 'Presence and Any date operators have no value.' });
    }
    else if (c.value === null || c.value === '' || Array.isArray(c.value) && !c.value.length)
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter a condition value.' });
    if (c.field === 'createdAt' && !['is_empty', 'is_not_empty', 'any'].includes(c.operator)) {
        const parsed = lead_created_contract_1.LeadCreatedFilterSchema.safeParse(c.operator === 'between' ? { operator: c.operator, ...(typeof c.value === 'object' ? c.value : {}) } : { operator: c.operator, date: c.value });
        if (!parsed.success)
            ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter valid calendar dates with From on or before To.' });
    }
});
exports.AudiencePreviewSchema = zod_1.z.object({ source: exports.AudienceSourceSchema, matchMode: exports.AudienceMatchModeSchema.default('AND'), conditions: zod_1.z.array(exports.AudienceConditionSchema).max(20).default([]) }).strict();
exports.AudiencePreviewRequestSchema = exports.AudiencePreviewSchema.extend({ channel: zod_1.z.enum(['EMAIL', 'SMS']).default('EMAIL'), page: zod_1.z.number().int().min(1).max(100000).default(1), limit: zod_1.z.number().int().min(1).max(50).default(25) });
exports.CreateAudienceSchema = exports.AudiencePreviewSchema.extend({ name: exports.MarketingNameSchema });
exports.CampaignScheduleSchema = zod_1.z.object({ scheduledFor: zod_1.z.string().datetime({ offset: true }).refine(value => new Date(value).getTime() > Date.now(), 'Schedule a future date and time.') }).strict();
exports.CampaignScheduleConfigSchema = exports.AudiencePreviewSchema.extend({ timezone: zod_1.z.literal('Asia/Manila'), scheduleFailureReason: zod_1.z.string().max(1000).optional() });
function campaignVariableKeys(text) {
    return [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]))];
}
// Application safety bound, not a TextBee limit. TextBee documents multipart
// segmentation but no hard message-length maximum in its public API contract.
exports.SMS_MAX_LENGTH = 50000;
/** Editable starting content for a new SMS, never appended by the transport. */
exports.SMS_DEFAULT_FOOTER = 'For inquiries regarding our products and services, contact Camxian Technologies:\n+63 (28) 462-3488 or go to the official website.\n\nThis is a no-reply message.';
function hasDefaultSmsFooter(body) {
    return body.replace(/\r\n?/g, '\n').includes(exports.SMS_DEFAULT_FOOTER);
}
function insertDefaultSmsFooter(body) {
    if (hasDefaultSmsFooter(body))
        return body;
    const content = body.trimEnd();
    return content ? `${content}\n\n${exports.SMS_DEFAULT_FOOTER}` : exports.SMS_DEFAULT_FOOTER;
}
/** Shared by previews, campaign preflight and every server-side SMS caller. */
function buildFinalSms({ body, variables }) {
    return (variables ? renderEmailVariables(body, variables) : body).trim();
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
    subject: exports.EmailSubjectSchema.optional(), body: zod_1.z.string().max(50000).refine(currentCompanyVariable, companyVariableMessage).optional(),
    audienceSource: exports.AudienceSourceSchema.optional().nullable(), targetAudienceId: zod_1.z.string().uuid().optional().nullable(),
    emailTemplateId: zod_1.z.string().uuid().optional().nullable(), smsTemplateId: zod_1.z.string().uuid().optional().nullable(),
}).strict();
exports.CreateCampaignDraftSchema = exports.CampaignDraftSchema.extend({ type: zod_1.z.enum(['EMAIL', 'SMS'], { errorMap: () => ({ message: 'Select Email or SMS.' }) }) });
exports.CampaignSendSchema = exports.CampaignDraftSchema.superRefine((v, ctx) => {
    if (v.audienceSource && v.targetAudienceId)
        ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Select a saved audience or a source, not both.' });
    if (!v.audienceSource && !v.targetAudienceId)
        ctx.addIssue({ code: 'custom', path: ['targetAudienceId'], message: 'Target audience is required.' });
    if (v.type === 'EMAIL' && !v.subject?.trim())
        ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
    if (!v.body?.trim())
        ctx.addIssue({ code: 'custom', path: ['body'], message: 'Body is required.' });
});
exports.MarketingTemplateSchema = zod_1.z.object({ name: exports.MarketingNameSchema, type: zod_1.z.enum(['Email', 'SMS', 'Quotation']), category: exports.MarketingNameSchema.optional(), subject: exports.EmailSubjectSchema.optional(), content: zod_1.z.string().trim().min(1, 'Message content is required.').max(50000).refine(currentCompanyVariable, companyVariableMessage) }).strict().superRefine((v, ctx) => {
    if (v.type === 'Email' && !v.subject)
        ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Subject line is required.' });
    if (v.type === 'Quotation') {
        if (!v.category)
            ctx.addIssue({ code: 'custom', path: ['category'], message: 'Category is required.' });
        let content;
        try {
            content = JSON.parse(v.content);
        }
        catch { /* Report through the shared schema below. */ }
        const parsed = quotation_contract_1.QuotationTemplateContentSchema.safeParse(content);
        if (!parsed.success)
            for (const issue of parsed.error.issues)
                ctx.addIssue({ code: 'custom', path: ['content', ...issue.path], message: issue.message });
    }
});

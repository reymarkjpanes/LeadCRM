"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotationSendSchema = exports.QuotationDraftSchema = exports.QuotationTemplateContentSchema = exports.QUOTATION_CONTEXT_VARIABLES = exports.QUOTATION_VARIABLE_GROUPS = exports.QUOTATION_CATEGORIES = void 0;
exports.parseQuotationTemplate = parseQuotationTemplate;
exports.defaultQuotationContent = defaultQuotationContent;
exports.quotationNumber = quotationNumber;
const zod_1 = require("zod");
exports.QUOTATION_CATEGORIES = ['Sales', 'Services', 'Software', 'Maintenance', 'Product', 'Custom'];
exports.QUOTATION_VARIABLE_GROUPS = ['Recipient (Lead / Contact)', 'Account', 'Sender', 'Organization', 'Quotation Details'];
exports.QUOTATION_CONTEXT_VARIABLES = {
    fullName: 'Recipient (Lead / Contact)', accountName: 'Account', accountAddress: 'Account',
    sender_name: 'Sender', sender_email: 'Sender', sender_job_title: 'Sender',
    organizationName: 'Organization', organizationAddress: 'Organization', organizationEmail: 'Organization', organizationPhone: 'Organization',
    quotationNumber: 'Quotation Details', quotationDate: 'Quotation Details', validUntil: 'Quotation Details', total: 'Quotation Details',
};
const section = zod_1.z.string().max(15000).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Control characters are not allowed.');
exports.QuotationTemplateContentSchema = zod_1.z.object({
    quotationTitle: zod_1.z.string().trim().min(1, 'Quotation title is required.').max(200).refine(value => !/[\r\n\x00-\x1f]/.test(value) && !value.includes('{{'), 'Enter a single-line title without variables.'),
    header: section, introduction: section, footer: section, tableLayout: zod_1.z.literal('standard'),
}).strict();
function parseQuotationTemplate(content) {
    return exports.QuotationTemplateContentSchema.parse(JSON.parse(content));
}
function defaultQuotationContent() {
    return { quotationTitle: 'QUOTATION', header: '{{organizationName}}\n{{organizationAddress}}\n{{organizationEmail}} | {{organizationPhone}}',
        introduction: 'Dear {{firstName}},\n\nThank you for your interest in our products and services.\nPlease see the details of the quotation below.',
        footer: 'Terms and Conditions:\n• This quotation is valid until {{validUntil}}.\n• Prices are subject to change without prior notice.\n• Please contact us if you have any questions.\n\nPrepared by:\n{{sender_name}}\n{{sender_email}}', tableLayout: 'standard' };
}
const calendarDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid calendar date.');
exports.QuotationDraftSchema = zod_1.z.object({
    quotationId: zod_1.z.string().uuid(), templateId: zod_1.z.string().uuid(), recipientType: zod_1.z.enum(['Lead', 'Contact']), recipientId: zod_1.z.string().uuid(),
    dealId: zod_1.z.string().uuid().optional(), products: zod_1.z.array(zod_1.z.object({ productId: zod_1.z.string().uuid(), quantity: zod_1.z.number().int().positive().max(1000000) }).strict()).min(1, 'Add at least one product.').max(100),
    quotationDate: calendarDate, validUntil: calendarDate, notes: section,
}).strict().superRefine((value, context) => {
    if (value.validUntil < value.quotationDate)
        context.addIssue({ code: 'custom', path: ['validUntil'], message: 'Valid Until cannot be earlier than Quotation Date.' });
    if (new Set(value.products.map(row => row.productId)).size !== value.products.length)
        context.addIssue({ code: 'custom', path: ['products'], message: 'Select each product once; change its quantity instead.' });
});
exports.QuotationSendSchema = zod_1.z.object({ draft: exports.QuotationDraftSchema, requestId: zod_1.z.string().uuid(), fingerprint: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function quotationNumber(id, date) { return `QT-${date.slice(0, 4)}-${id.toUpperCase()}`; }

import { z } from 'zod';

export const QUOTATION_CATEGORIES = ['Sales', 'Services', 'Software', 'Maintenance', 'Product', 'Custom'] as const;
export const QUOTATION_VARIABLE_GROUPS = ['Recipient (Lead / Contact)', 'Account', 'Sender', 'Organization', 'Quotation Details'] as const;
export const QUOTATION_CONTEXT_VARIABLES = {
  fullName: 'Recipient (Lead / Contact)', accountName: 'Account', accountAddress: 'Account',
  sender_name: 'Sender', sender_email: 'Sender', sender_job_title: 'Sender',
  organizationName: 'Organization', organizationAddress: 'Organization', organizationEmail: 'Organization', organizationPhone: 'Organization',
  quotationNumber: 'Quotation Details', quotationDate: 'Quotation Details', validUntil: 'Quotation Details', total: 'Quotation Details',
} as const;
const section = z.string().max(15000).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Control characters are not allowed.');
export const QuotationTemplateContentSchema = z.object({
  quotationTitle: z.string().trim().min(1, 'Quotation title is required.').max(200).refine(value => !/[\r\n\x00-\x1f]/.test(value) && !value.includes('{{'), 'Enter a single-line title without variables.'),
  header: section, introduction: section, footer: section, tableLayout: z.literal('standard'),
}).strict();
export type QuotationTemplateContent = z.infer<typeof QuotationTemplateContentSchema>;
export function parseQuotationTemplate(content: string): QuotationTemplateContent {
  return QuotationTemplateContentSchema.parse(JSON.parse(content));
}
export function defaultQuotationContent(): QuotationTemplateContent {
  return { quotationTitle: 'QUOTATION', header: '{{organizationName}}\n{{organizationAddress}}\n{{organizationEmail}} | {{organizationPhone}}',
    introduction: 'Dear {{firstName}},\n\nThank you for your interest in our products and services.\nPlease see the details of the quotation below.',
    footer: 'Terms and Conditions:\n• This quotation is valid until {{validUntil}}.\n• Prices are subject to change without prior notice.\n• Please contact us if you have any questions.\n\nPrepared by:\n{{sender_name}}\n{{sender_email}}', tableLayout: 'standard' };
}
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid calendar date.');
export const QuotationDraftSchema = z.object({
  quotationId: z.string().uuid(), templateId: z.string().uuid(), recipientType: z.enum(['Lead', 'Contact']), recipientId: z.string().uuid(),
  dealId: z.string().uuid().optional(), products: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(1000000) }).strict()).min(1, 'Add at least one product.').max(100),
  quotationDate: calendarDate, validUntil: calendarDate, notes: section,
}).strict().superRefine((value, context) => {
  if (value.validUntil < value.quotationDate) context.addIssue({ code: 'custom', path: ['validUntil'], message: 'Valid Until cannot be earlier than Quotation Date.' });
  if (new Set(value.products.map(row => row.productId)).size !== value.products.length) context.addIssue({ code: 'custom', path: ['products'], message: 'Select each product once; change its quantity instead.' });
});
export type QuotationDraft = z.infer<typeof QuotationDraftSchema>;
export const QuotationSendSchema = z.object({ draft: QuotationDraftSchema, requestId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type QuotationSendInput = z.infer<typeof QuotationSendSchema>;
export function quotationNumber(id: string, date: string): string { return `QT-${date.slice(0, 4)}-${id.toUpperCase()}`; }
export interface QuotationDocument {
  quotationTitle: string; header: string; introduction: string; footer: string; notes: string;
  number: string; date: string; validUntil: string;
  recipient: { name: string; companyName: string; email: string; address: string };
  products: { name: string; description: string; quantity: number; unitPrice: string; total: string }[];
  total: string;
}
export interface QuotationPreview { pdfBase64: string; filename: string; fingerprint: string; document: QuotationDocument }

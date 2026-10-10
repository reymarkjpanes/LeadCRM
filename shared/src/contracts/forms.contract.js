"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SETTINGS = exports.DEFAULT_DESIGN = exports.PublicSubmissionSchema = exports.UpdateFormSchema = exports.CreateFormSchema = exports.FormDefinitionSchema = exports.FormSettingsSchema = exports.FormDesignSchema = exports.FormFieldSchema = exports.FORM_MAPPINGS = exports.FormFieldTypeSchema = exports.FORM_TRACKING_KEYS = exports.FORM_PRODUCT_INTERESTS = void 0;
exports.getFormProductValues = getFormProductValues;
exports.defaultContactForm = defaultContactForm;
exports.validateFormValues = validateFormValues;
const zod_1 = require("zod");
const administration_user_schema_1 = require("../validation/administration-user.schema");
// Legacy seed labels for database fixtures only. Runtime forms resolve database IDs.
exports.FORM_PRODUCT_INTERESTS = [
    'CCTV Surveillance System', 'Biometrics', 'Door Access Control', 'Smart Lock',
    'Network Infrastructure', 'Structured Cabling', 'Internet and Voice Postpaid plans',
    'IPBX/IP PHONES/PABGM', 'Electric Fence', 'Fire Detection and Alarm System',
    'Laptop/Server/Data Cabinets', 'Others',
];
exports.FORM_TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const text = (max) => zod_1.z.string().max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.').transform(v => v.trim());
exports.FormFieldTypeSchema = zod_1.z.enum(['heading', 'paragraph', 'divider', 'single-line', 'multi-line', 'email', 'phone', 'number', 'date', 'checkbox', 'radio', 'dropdown', 'url', 'rating', 'file', 'contact-name', 'contact-email', 'contact-phone', 'company-name', 'company-website']);
exports.FORM_MAPPINGS = ['firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName', 'website', 'productInterest', 'address'];
exports.FormFieldSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/).refine(id => !['constructor', 'prototype', 'toString', 'hasOwnProperty'].includes(id), 'Reserved field ID.'), type: exports.FormFieldTypeSchema,
    label: text(500), placeholder: text(500).optional(), required: zod_1.z.boolean().optional(),
    optionLabels: zod_1.z.record(zod_1.z.string().uuid(), text(200)).optional(),
    options: zod_1.z.array(text(200).pipe(zod_1.z.string().min(1))).max(100).optional(),
    mapToField: zod_1.z.enum(['', ...exports.FORM_MAPPINGS]).optional(), width: zod_1.z.enum(['half', 'full']).optional(),
}).strict();
const color = zod_1.z.string().regex(/^(?:|#[\da-fA-F]{3}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/, 'Use a hex color, such as #3B82F6.').default('');
exports.FormDesignSchema = zod_1.z.object({ generalBg: color, generalBorder: color, generalText: color, fieldBg: color, fieldBorder: color, fieldText: color,
    fieldRadius: zod_1.z.enum(['none', 'sm', 'md', 'lg', 'full']).default('md'), fieldSize: zod_1.z.enum(['sm', 'regular', 'lg']).default('regular'), buttonBg: color, buttonBorder: color, buttonText: color }).strict();
exports.FormSettingsSchema = zod_1.z.object({
    notificationEmail: text(254).transform(v => v.toLowerCase()).pipe(zod_1.z.string().email().or(zod_1.z.literal(''))).default(''),
    trackUrlParams: zod_1.z.boolean().default(true),
    utmParams: zod_1.z.array(zod_1.z.object({ key: zod_1.z.enum(exports.FORM_TRACKING_KEYS), mapTo: zod_1.z.literal('') }).strict()).max(5).default([]),
}).strict();
exports.FormDefinitionSchema = zod_1.z.object({ name: text(200).pipe(zod_1.z.string().min(1, 'Form name is required.')), fields: zod_1.z.array(exports.FormFieldSchema).max(100), design: exports.FormDesignSchema, settings: exports.FormSettingsSchema }).strict().superRefine((form, ctx) => {
    const ids = new Set(), mappings = new Set();
    form.fields.forEach((f, i) => {
        const issue = (message) => ctx.addIssue({ code: 'custom', path: ['fields', i], message });
        if (ids.has(f.id))
            issue('Field IDs must be unique.');
        ids.add(f.id);
        if (f.type === 'file')
            issue('File Upload is not supported. Remove this field before saving or publishing.');
        if (f.mapToField) {
            if (mappings.has(f.mapToField))
                issue('Each CRM mapping can only be used once.');
            mappings.add(f.mapToField);
        }
        if (f.mapToField !== 'productInterest' && ['dropdown', 'radio'].includes(f.type) && !f.options?.length)
            issue('Add at least one option.');
        if (f.mapToField === 'productInterest' && f.type !== 'dropdown')
            issue('Product Interest must use the approved dropdown options.');
        const allowed = { email: ['email', 'contact-email'], phone: ['phone', 'contact-phone'], website: ['url', 'company-website'], firstName: ['single-line'], lastName: ['single-line'], fullName: ['contact-name', 'single-line'], companyName: ['company-name', 'single-line'], address: ['multi-line', 'single-line'] };
        if (f.mapToField && allowed[f.mapToField] && !allowed[f.mapToField].includes(f.type))
            issue('This CRM mapping is incompatible with the field type.');
    });
    if (mappings.has('fullName') && (mappings.has('firstName') || mappings.has('lastName')))
        ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Use full name or separate first and last name mappings.' });
});
exports.CreateFormSchema = zod_1.z.object({ name: text(200).pipe(zod_1.z.string().min(1)).default('Contact Us') }).strict();
exports.UpdateFormSchema = zod_1.z.object({ name: text(200).pipe(zod_1.z.string().min(1)).optional(), fields: zod_1.z.array(exports.FormFieldSchema).max(100).optional(), design: exports.FormDesignSchema.optional(), settings: exports.FormSettingsSchema.optional(), revision: zod_1.z.number().int().nonnegative() }).strict();
exports.PublicSubmissionSchema = zod_1.z.object({
    requestId: zod_1.z.string().uuid().optional(),
    version: zod_1.z.number().int().positive(),
    values: zod_1.z.record(zod_1.z.string().max(80), zod_1.z.union([zod_1.z.string().max(4000), zod_1.z.boolean(), zod_1.z.array(zod_1.z.string().max(200)).max(100)])).refine(v => Object.keys(v).length <= 100, 'Too many fields.'),
    tracking: zod_1.z.record(zod_1.z.enum(exports.FORM_TRACKING_KEYS), text(200)).default({}),
    website: zod_1.z.string().max(200).default(''), // honeypot; never CRM data
}).strict();
/** Product selections were historically stored as arrays or comma-separated IDs. */
function getFormProductValues(value) {
    return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
        .filter((item) => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}
exports.DEFAULT_DESIGN = exports.FormDesignSchema.parse({});
exports.DEFAULT_SETTINGS = exports.FormSettingsSchema.parse({});
function defaultContactForm(name = 'Contact Us') {
    return exports.FormDefinitionSchema.parse({ name, design: {}, settings: {}, fields: [
            { id: 'firstName', type: 'single-line', label: 'First Name', placeholder: 'Enter your first name', required: true, mapToField: 'firstName', width: 'half' },
            { id: 'lastName', type: 'single-line', label: 'Last Name', placeholder: 'Enter your last name', required: true, mapToField: 'lastName', width: 'half' },
            { id: 'company', type: 'single-line', label: 'Company', placeholder: 'Enter company name', mapToField: 'companyName', width: 'half' },
            { id: 'phone', type: 'phone', label: 'Contact Number', placeholder: '9XXXXXXXXX', mapToField: 'phone', width: 'half' },
            { id: 'email', type: 'email', label: 'Email Address', placeholder: 'Enter your email address', required: true, mapToField: 'email' },
            { id: 'productInterest', type: 'dropdown', label: 'Product Interest', placeholder: 'Select a product interest', required: true, mapToField: 'productInterest', options: [] },
            { id: 'address', type: 'multi-line', label: 'Full Address', placeholder: 'Enter your complete address', mapToField: 'address' },
        ] });
}
/** Same field rules in the public UI and authoritative server validation. Text stays plain text. */
function validateFormValues(fields, values) {
    const errors = {}, clean = {};
    const inputs = fields.filter(f => !['heading', 'paragraph', 'divider'].includes(f.type));
    for (const key of Object.keys(values))
        if (!inputs.some(f => f.id === key))
            errors[key] = 'Unknown field.';
    for (const f of inputs) {
        const raw = values[f.id] ?? (f.type === 'checkbox' ? false : '');
        if (f.mapToField === 'productInterest' && Array.isArray(raw)) {
            if ((f.required && !raw.length) || raw.some(v => typeof v !== 'string' || !f.options?.includes(v)))
                errors[f.id] = 'Select approved product interests.';
            else
                clean[f.id] = [...new Set(raw)];
            continue;
        }
        if (f.type === 'checkbox') {
            if (typeof raw !== 'boolean' || (f.required && !raw))
                errors[f.id] = 'Please check this field.';
            else
                clean[f.id] = raw;
            continue;
        }
        const parsed = text(f.mapToField === 'firstName' || f.mapToField === 'lastName' ? 100 : f.type === 'multi-line' ? 4000 : 254).safeParse(raw);
        if (!parsed.success) {
            errors[f.id] = parsed.error.issues[0].message;
            continue;
        }
        let value = parsed.data;
        if (!value) {
            if (f.required)
                errors[f.id] = `${f.label} is required.`;
            clean[f.id] = '';
            continue;
        }
        if (['email', 'contact-email'].includes(f.type)) {
            value = value.toLowerCase();
            if (!zod_1.z.string().email().safeParse(value).success)
                errors[f.id] = 'Enter a valid email address.';
        }
        if (['phone', 'contact-phone'].includes(f.type)) {
            const phone = administration_user_schema_1.AdministrationPhoneSchema.safeParse(value);
            if (!phone.success)
                errors[f.id] = 'Enter 10 digits starting with 9.';
            else
                value = phone.data;
        }
        if (['dropdown', 'radio'].includes(f.type) && !f.options?.includes(value))
            errors[f.id] = 'Select an available option.';
        if (['url', 'company-website'].includes(f.type) && !zod_1.z.string().url().refine(v => /^https?:\/\//i.test(v)).safeParse(value).success)
            errors[f.id] = 'Enter an HTTP or HTTPS website URL.';
        if (f.type === 'number' && (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))))
            errors[f.id] = 'Enter a valid number.';
        if (f.type === 'rating' && !/^[1-5]$/.test(value))
            errors[f.id] = 'Select a rating from 1 to 5.';
        if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
            errors[f.id] = 'Enter a valid date.';
        if (f.type === 'file')
            errors[f.id] = 'File Upload is not supported.';
        clean[f.id] = value;
    }
    return { values: clean, errors };
}

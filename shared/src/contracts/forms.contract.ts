import { z } from 'zod';
import { AttributionContextSchema, type SourceAttribution } from './source-attribution';
import { AdministrationPhoneSchema } from '../validation/administration-user.schema';
import type { CrmFieldCatalogEntry } from './field-catalog';
import type { ProductInterest } from './product-interests.contract';
import { isDirectMailSource } from './record-experience';
import { getNameDigitError, PROFILE_FIELD_LIMITS, PROFILE_FIELD_LIMIT_ERRORS } from './profile.contract';
import { COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR, CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR } from './organization';

// Legacy seed labels for database fixtures only. Runtime forms resolve database IDs.
export const FORM_PRODUCT_INTERESTS = [
  'CCTV Surveillance System', 'Biometrics', 'Door Access Control', 'Smart Lock',
  'Network Infrastructure', 'Structured Cabling', 'Internet and Voice Postpaid plans',
  'IPBX/IP PHONES/PABGM', 'Electric Fence', 'Fire Detection and Alarm System',
  'Laptop/Server/Data Cabinets', 'Others',
] as const;
export const FORM_TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const plainText = z.string().refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.').transform(v => v.trim());
const text = (max: number) => z.string().max(max).pipe(plainText);
export const FormFieldTypeSchema = z.enum(['header', 'heading', 'paragraph', 'divider', 'single-line', 'multi-line', 'email', 'phone', 'number', 'date', 'checkbox', 'radio', 'dropdown', 'url', 'rating', 'file', 'contact-name', 'contact-email', 'contact-phone', 'company-name', 'company-website']);
export const FORM_MAPPINGS = ['firstName', 'lastName', 'fullName', 'email', 'phone', 'companyName', 'website', 'productInterest', 'address', 'source'] as const;
export const FormFieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/).refine(id => !['constructor', 'prototype', 'toString', 'hasOwnProperty'].includes(id), 'Reserved field ID.'), type: FormFieldTypeSchema,
  label: text(500), placeholder: text(500).optional(), required: z.boolean().optional(),
  optionLabels: z.record(z.string().uuid(), text(200)).optional(),
  options: z.array(text(200).pipe(z.string().min(1))).max(100).optional(),
  mapToField: z.enum(['', ...FORM_MAPPINGS]).optional(), customFieldId: z.string().min(1).max(100).optional(), width: z.enum(['half', 'full']).optional(),
}).strict();
const color = z.string().regex(/^(?:|#[\da-fA-F]{3}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/, 'Use a hex color, such as #3B82F6.').default('');
export const FormDesignSchema = z.object({ generalBg: color, generalBorder: color, generalText: color, fieldBg: color, fieldBorder: color, fieldText: color,
  fieldRadius: z.enum(['none', 'sm', 'md', 'lg', 'full']).default('md'), fieldSize: z.enum(['sm', 'regular', 'lg']).default('regular'), buttonBg: color, buttonBorder: color, buttonText: color }).strict();
export const FormSettingsSchema = z.object({
  notificationEmail: text(254).transform(v => v.toLowerCase()).pipe(z.string().email().or(z.literal(''))).default(''),
  trackUrlParams: z.boolean().default(true),
  allowedEmbedOrigins: z.array(z.string().url().refine(v => { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.origin === v; }, 'Use an exact origin, such as https://example.com.')).max(20).default([]),
  utmParams: z.array(z.object({ key: z.enum(FORM_TRACKING_KEYS), mapTo: z.literal('') }).strict()).max(5).default([]),
}).strict();
export const FormDefinitionSchema = z.object({ name: text(200).pipe(z.string().min(1, 'Form name is required.')), fields: z.array(FormFieldSchema).max(100), design: FormDesignSchema, settings: FormSettingsSchema }).strict().superRefine((form, ctx) => {
  const ids = new Set<string>(), mappings = new Set<string>();
  form.fields.forEach((f, i) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['fields', i], message });
    if (ids.has(f.id)) issue('Field IDs must be unique.'); ids.add(f.id);
    if (f.type === 'file') issue('File Upload is not supported. Remove this field before saving or publishing.');
    if (f.mapToField && f.customFieldId) issue('A field cannot use both a CRM mapping and a Custom Field.');
    if (f.customFieldId) { if (mappings.has(`custom:${f.customFieldId}`)) issue('Each Custom Field can only be used once.'); mappings.add(`custom:${f.customFieldId}`); }
    if (f.mapToField) { if (mappings.has(f.mapToField)) issue('Each CRM mapping can only be used once.'); mappings.add(f.mapToField); }
    if (f.mapToField !== 'productInterest' && ['dropdown', 'radio'].includes(f.type) && !f.options?.length) issue('Add at least one option.');
    if (f.mapToField === 'productInterest' && f.type !== 'dropdown') issue('Product Interest must use the approved dropdown options.');
    if (['header', 'heading', 'paragraph', 'divider'].includes(f.type) && (f.mapToField || f.customFieldId)) issue('Layout blocks cannot map to CRM fields.');
    const allowed: Record<string, string[]> = { email: ['email', 'contact-email'], phone: ['phone', 'contact-phone'], website: ['url', 'company-website'], firstName: ['single-line'], lastName: ['single-line'], fullName: ['contact-name', 'single-line'], companyName: ['company-name', 'single-line'], address: ['multi-line', 'single-line'], status: ['dropdown'], source: ['dropdown'] };
    if (f.mapToField && allowed[f.mapToField] && !allowed[f.mapToField].includes(f.type)) issue('This CRM mapping is incompatible with the field type.');
  });
  if (mappings.has('fullName') && (mappings.has('firstName') || mappings.has('lastName'))) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Use full name or separate first and last name mappings.' });
});
export const CreateFormSchema = z.object({ name: text(200).pipe(z.string().min(1)).default('Contact Us') }).strict();
export const UpdateFormSchema = z.object({ name: text(200).pipe(z.string().min(1)).optional(), fields: z.array(FormFieldSchema).max(100).optional(), design: FormDesignSchema.optional(), settings: FormSettingsSchema.optional(), revision: z.number().int().nonnegative() }).strict();
export const PublicSubmissionSchema = z.object({
  requestId: z.string().uuid(),
  version: z.number().int().positive(),
  values: z.record(z.string().max(80), z.union([z.string().max(10000), z.boolean(), z.array(z.string().max(200)).max(100)])).refine(v => Object.keys(v).length <= 100, 'Too many fields.'),
  tracking: z.record(z.enum(FORM_TRACKING_KEYS), text(200)).default({}),
  attribution: AttributionContextSchema.optional(),
  website: z.string().max(200).default(''), // honeypot; never CRM data
}).strict();
/** Normalized request identity, shared by retrying clients and saved submission receipts. */
export function publicSubmissionContent(version: number, values: Record<string, unknown>, tracking: Record<string, unknown>, attribution?: unknown): string {
  const stable = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])])) : value;
  const sorted = (value: Record<string, unknown>) => Object.fromEntries(Object.keys(value).sort().map(key =>
    [key, Array.isArray(value[key]) ? [...value[key] as unknown[]].sort() : value[key]]));
  return JSON.stringify({ version, values: sorted(values), tracking: sorted(tracking), ...(attribution ? { attribution: stable(attribution) } : {}) });
}
export type FormField = z.infer<typeof FormFieldSchema>;
export type FormFieldType = FormField['type'];
export type FormDesign = z.infer<typeof FormDesignSchema>;
export type FormSettings = z.infer<typeof FormSettingsSchema>;
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;
/** Adapt eligible canonical Lead definitions; labels never determine identity or input type. */
export function leadCatalogFormField(field: CrmFieldCatalogEntry): Omit<FormField, 'id'> | undefined {
  if (field.module !== 'leads' || !field.active || !field.visibleInForm || field.unavailableReason) return;
  const mapToField = field.kind === 'System' && !field.customFieldId
    ? field.technicalKey === 'productInterestIds' ? 'productInterest'
      : (['firstName', 'lastName', 'email', 'phone', 'companyName', 'address', 'source'] as const).find(key => key === field.technicalKey)
    : undefined;
  if ((field.kind === 'System' && !mapToField) || (field.kind === 'Custom' && !field.customFieldId)) return;
  let type: FormFieldType;
  switch (field.type) {
    case 'text': type = mapToField === 'email' ? 'email' : mapToField === 'phone' ? 'phone' : 'single-line'; break;
    case 'longText': type = 'multi-line'; break;
    case 'number': type = 'number'; break;
    case 'date': type = 'date'; break;
    case 'dropdown': case 'products': type = 'dropdown'; break;
    case 'boolean': type = 'checkbox'; break;
    default: return; // References and private file uploads have no public Forms integration.
  }
  const options = field.options ?? [];
  return { label: field.label, type, required: field.required, ...(mapToField ? { mapToField } : { customFieldId: field.customFieldId }),
    ...(type === 'dropdown' ? { options: mapToField === 'source' ? options.filter(option => !isDirectMailSource(option)) : [...options] } : {}) };
}

export function withoutRetiredFormSources(fields: FormField[]) {
  return fields.map(field => field.mapToField === 'source' && field.options
    ? { ...field, options: field.options.filter(option => !isDirectMailSource(option)) }
    : field);
}
export type FormProductCatalog = { categories: string[]; products: Pick<ProductInterest, 'id' | 'name' | 'category'>[] };
export type PublicFormDefinition = Omit<FormDefinition, 'settings'> & { version: number; trackUrlParams: boolean; allowedEmbedOrigins?: string[]; productCatalog?: FormProductCatalog };
export interface FormSubmissionRecord {
  id: string; formId: string; leadId: string | null; contactId: string | null;
  submittedAt: string; publishedVersion: number; publishedConfig: Omit<FormDefinition, 'settings'>;
  values: Record<string, string | boolean | string[]>; tracking: Record<string, string>; notificationStatus: string;
  productLabels?: Record<string, string>;
  attribution?: SourceAttribution;
}

/** Product selections were historically stored as arrays or comma-separated IDs. */
export function getFormProductValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}
export const DEFAULT_DESIGN = FormDesignSchema.parse({});
export const DEFAULT_SETTINGS = FormSettingsSchema.parse({});
export function defaultContactForm(name = 'Contact Us'): FormDefinition {
  return FormDefinitionSchema.parse({ name, design: {}, settings: {}, fields: [
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
export function validateFormValues(fields: FormField[], values: Record<string, unknown>) {
  const errors: Record<string, string> = {}, clean: Record<string, string | boolean | string[]> = {};
  const inputs = fields.filter(f => !['header', 'heading', 'paragraph', 'divider'].includes(f.type));
  for (const key of Object.keys(values)) if (!inputs.some(f => f.id === key)) errors[key] = 'Unknown field.';
  for (const f of inputs) {
    const raw = values[f.id] ?? (f.type === 'checkbox' ? false : '');
    if (f.mapToField === 'productInterest' && Array.isArray(raw)) {
      if ((f.required && !raw.length) || raw.some(v => typeof v !== 'string' || !f.options?.includes(v))) errors[f.id] = 'Select approved product interests.';
      else clean[f.id] = [...new Set(raw)];
      continue;
    }
    if (f.type === 'checkbox') { if (typeof raw !== 'boolean' || (f.required && !raw)) errors[f.id] = 'Please check this field.'; else clean[f.id] = raw; continue; }
    const nameError = getNameDigitError(f.mapToField, raw);
    if (nameError) { errors[f.id] = nameError; continue; }
    const field = f.mapToField;
    const capped = field === 'firstName' || field === 'lastName' ? [PROFILE_FIELD_LIMITS[field], PROFILE_FIELD_LIMIT_ERRORS[field]] as const
      : field === 'companyName' ? [COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR] as const
      : field === 'address' ? [CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR] as const : undefined;
    const parsed = capped
      ? plainText.pipe(z.string().max(capped[0], capped[1])).safeParse(raw)
      : text(f.customFieldId ? f.type === 'multi-line' ? 10000 : 1000 : f.type === 'multi-line' ? 4000 : 254).safeParse(raw);
    if (!parsed.success) { errors[f.id] = parsed.error.issues[0].message; continue; }
    let value = parsed.data;
    if (field === 'fullName' && value) {
      const [first, ...rest] = value.split(/\s+/);
      const nameLengthError = first.length > PROFILE_FIELD_LIMITS.firstName ? PROFILE_FIELD_LIMIT_ERRORS.firstName
        : rest.join(' ').length > PROFILE_FIELD_LIMITS.lastName ? PROFILE_FIELD_LIMIT_ERRORS.lastName : undefined;
      if (nameLengthError) { errors[f.id] = nameLengthError; continue; }
    }
    if (!value) { if (f.required) errors[f.id] = `${f.label} is required.`; clean[f.id] = ''; continue; }
    if (['email', 'contact-email'].includes(f.type)) { value = value.toLowerCase(); if (!z.string().email().safeParse(value).success) errors[f.id] = 'Enter a valid email address.'; }
    if (['phone', 'contact-phone'].includes(f.type)) { const phone = AdministrationPhoneSchema.safeParse(value); if (!phone.success) errors[f.id] = 'Enter 10 digits starting with 9.'; else value = phone.data; }
    if (['dropdown', 'radio'].includes(f.type) && !f.options?.includes(value)) errors[f.id] = 'Select an available option.';
    if (['url', 'company-website'].includes(f.type) && !z.string().url().refine(v => /^https?:\/\//i.test(v)).safeParse(value).success) errors[f.id] = 'Enter an HTTP or HTTPS website URL.';
    if (f.type === 'number' && (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) errors[f.id] = 'Enter a valid number.';
    if (f.type === 'rating' && !/^[1-5]$/.test(value)) errors[f.id] = 'Select a rating from 1 to 5.';
    if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) errors[f.id] = 'Enter a valid date.';
    if (f.type === 'file') errors[f.id] = 'File Upload is not supported.';
    clean[f.id] = value;
  }
  return { values: clean, errors };
}

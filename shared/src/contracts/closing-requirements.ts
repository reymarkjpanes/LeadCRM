import { z } from 'zod';
import { RECORD_FILE_MAX_BYTES } from './record-experience';

export const CLOSING_FIELD_TYPES = ['Text', 'Long Text', 'Number', 'Date', 'Dropdown', 'File Upload'] as const;
export const CUSTOM_FIELD_MODULES = ['leads', 'contacts', 'accounts', 'deals'] as const;
export type CustomFieldModule = typeof CUSTOM_FIELD_MODULES[number];
export const CUSTOM_FIELD_MODULE_LABELS: Record<CustomFieldModule, string> = { leads: 'Leads', contacts: 'Contacts', accounts: 'Accounts', deals: 'Deals' };
export const CLOSED_WON_GROUP = 'Closed Won Requirements';
export const CUSTOM_FIELD_BUILT_IN_GROUPS: Record<CustomFieldModule, readonly string[]> = {
  leads: ['Basic Information', 'Status & Interest', 'Organization', 'Additional Information'],
  contacts: ['Basic Information', 'Status & Classification', 'Relationships', 'Additional Information'],
  accounts: ['Basic Information', 'Address', 'Relationships', 'Products & Interests', 'Notes'],
  deals: ['Deal Information', 'Relationships', 'Additional Details', CLOSED_WON_GROUP],
};
export const customFieldGroupOptions = (module: CustomFieldModule, previous?: { module: CustomFieldModule; group: string }): string[] =>
  [...new Set([...CUSTOM_FIELD_BUILT_IN_GROUPS[module], ...(previous?.module === module ? [previous.group] : [])])];
export const customFieldNameKey = (value: string) => value.trim().toLowerCase();
export const ClosingFieldInputSchema = z.object({
  name: z.string().trim().min(1, 'Field name is required.').max(100),
  type: z.enum(CLOSING_FIELD_TYPES),
  // Retained only for old API clients. Module/group are the canonical context.
  appliesTo: z.literal('Closed Won Requirements').optional(),
  module: z.enum(CUSTOM_FIELD_MODULES).default('deals'),
  group: z.string().trim().min(1, 'Group / Section is required.').max(100).default(CLOSED_WON_GROUP),
  visibleInForm: z.boolean().default(true),
  order: z.number().int().min(0).max(100000).default(0),
  required: z.boolean(),
  active: z.boolean().default(true),
  description: z.string().trim().max(1000).default(''),
  options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
}).strict().superRefine((field, ctx) => {
  if (field.type === 'Dropdown' && (!field.options.length || new Set(field.options.map(o => o.toLowerCase())).size !== field.options.length)) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option; options must be unique.' });
  }
});
export type ClosingFieldInput = z.infer<typeof ClosingFieldInputSchema>;
export type ClosingField = ClosingFieldInput & { id: string; version: number };
export type ClosingValues = Record<string, string | number | null>;
export const CustomFieldValuesSchema = z.record(z.string().min(1).max(100), z.union([z.string().max(10000), z.number().finite(), z.null()])).refine(v => Object.keys(v).length <= 100, 'Supply at most 100 field values.');
export interface CustomFieldState { fields: ClosingField[]; values: ClosingValues; files: { id: string; name: string; url: string }[] }
export const isClosedWonField = (field: Pick<ClosingField, 'module' | 'group'>) => field.module === 'deals' && customFieldNameKey(field.group) === customFieldNameKey(CLOSED_WON_GROUP);
/** Legacy definitions/snapshots retain their IDs and original context. */
export const normalizeCustomField = (field: ClosingField): ClosingField => ({ ...field, module: field.module ?? 'deals', group: field.group ?? CLOSED_WON_GROUP, visibleInForm: field.visibleInForm ?? true, order: field.order ?? 0 });
export const ClosingValuesPatchSchema = z.object({ values: z.record(z.string().min(1).max(100), z.union([z.string().max(10000), z.number().finite(), z.null()])).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 100, 'Supply 1–100 field values.') }).strict();
export interface ClosingRequirementsState {
  fields: ClosingField[];
  values: ClosingValues;
  errors: Record<string, string>;
  locked: boolean;
  closedAt?: string;
  files: { id: string; name: string; type: string; size: number; url: string }[];
}
export const DEFAULT_CLOSING_FIELDS: ClosingField[] = [
  { id: 'confirmation-type', name: 'Confirmation Type', type: 'Dropdown', required: true, options: ['Approved Quotation', 'Signed Contract', 'Purchase Order Received', 'Order Confirmed', 'Other'] },
  { id: 'confirmation-date', name: 'Confirmation Date', type: 'Date', required: true },
  { id: 'reference-number', name: 'Reference Number', type: 'Text', required: false },
  { id: 'required-document', name: 'Required Document', type: 'File Upload', required: false },
  { id: 'closing-notes', name: 'Closing Notes', type: 'Long Text', required: false },
].map((field, order) => ({ options: [], description: '', active: true, module: 'deals', group: CLOSED_WON_GROUP, visibleInForm: true, order, version: 1, ...field })) as ClosingField[];

/** File IDs are checked against tenant/Deal-owned persistent records by the backend. */
export function closingValueError(field: ClosingField, value: unknown): string | undefined {
  const empty = value == null || typeof value === 'string' && !value.trim();
  if (empty) return field.required ? `${field.name} is required.` : undefined;
  if (field.type === 'Number') return typeof value === 'number' && Number.isFinite(value) ? undefined : 'Enter a valid number.';
  if (typeof value !== 'string') return 'Enter a valid value.';
  if (field.type === 'Date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return 'Enter a valid date.';
  if (field.type === 'Dropdown' && !field.options.includes(value)) return 'Select a configured option.';
  if (field.type === 'File Upload' && !z.string().uuid().safeParse(value).success) return 'Upload a persistent file first.';
  if (value.length > (field.type === 'Long Text' ? 10000 : 1000)) return 'Value is too long.';
}
export { RECORD_FILE_MAX_BYTES as CLOSING_FILE_MAX_BYTES };

import { z } from 'zod';
import { LeadFieldsSchema, LeadPhoneSchema, OptionalLeadSourceSchema } from '../contracts/lead.contract';
import { personNameSchema } from '../contracts/profile.contract';
import { COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR, CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR } from '../contracts/organization';

export const CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;
export const CSV_MAX_COLUMNS = 100;
export type CrmImportModule = 'leads' | 'contacts' | 'accounts';
export const importIdentity = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export const splitProductInterests = (value: string) => [...new Map(value.split(';').map(v => v.trim()).filter(Boolean).map(v => [importIdentity(v), v])).values()];

const text = (max: number, message?: string) => z.string().trim().max(max, message).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), 'Unsupported control character.');
const required = (label: string, max = 255, message?: string) => text(max, message).refine(Boolean, `${label} is required.`);
const optional = (max = 255, message?: string) => text(max, message).optional().default('');
const products = optional(20000).refine(v => splitProductInterests(v).length <= 100, 'Maximum 100 Product Interests.');
const website = optional(500).refine(v => {
  if (!v) return true;
  try { return ['http:', 'https:'].includes(new URL(v.includes('://') ? v : `https://${v}`).protocol); } catch { return false; }
}, 'Website must be a valid HTTP or HTTPS URL.');
const person = {
  firstName: personNameSchema('firstName', 'First Name is required.'),
  lastName: personNameSchema('lastName', 'Last Name is required.'),
  email: z.string().trim().toLowerCase().max(254).email('Invalid email address.'),
  phone: required('Phone Number', 50), companyName: required('Company Name', COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR),
  address: required('Full Address', CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR), productInterest: products,
};
export const ImportLeadRowSchema = z.object({ ...person, firstName: LeadFieldsSchema.shape.firstName, lastName: LeadFieldsSchema.shape.lastName, phone: LeadPhoneSchema.optional().default(''), companyName: optional(COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR), address: optional(CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR), source: OptionalLeadSourceSchema.optional().default(''),
  status: optional(30).transform(v => v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : 'Inquiry')
    .pipe(z.enum(['Inquiry', 'Hot', 'Warm', 'Cold', 'Cancelled'], { errorMap: () => ({ message: 'Status must be Inquiry, Hot, Warm, Cold or Cancelled. Close customers through a confirmed Closed Deal Deal.' }) })),
}).strict();
export const ImportContactRowSchema = z.object(person).strict();
const importAccountFields = z.object({ name: required('Company Name', COMPANY_NAME_MAX_LENGTH, COMPANY_NAME_MAX_ERROR).transform(v => v.replace(/\s+/g, ' ')),
  // Split components are accepted only for legacy CSV/API compatibility.
  industry: optional(255), website, address: optional(CRM_ADDRESS_MAX_LENGTH, CRM_ADDRESS_MAX_ERROR), city: optional(100), province: optional(100), country: optional(100),
  size: optional(20).refine(v => !v || ['1-10', '11-50', '51-200', '200+'].includes(v), 'Invalid Company Size.'),
}).strict();
export const ImportAccountRowSchema = importAccountFields.refine(row => normalizeAccountImportRow(row).address.length <= CRM_ADDRESS_MAX_LENGTH, {
  path: ['address'], message: CRM_ADDRESS_MAX_ERROR,
});

/** CSV values are explicit: never infer or discard a supplied country. */
export function normalizeAccountImportRow(data: Record<string, string>): Record<string, string> {
  const { city, province, country, ...canonical } = data;
  let address = data.address ?? '';
  const normalize = (value: string) => value.toLowerCase().replace(/[\s,;]+/g, ' ').trim();
  for (const value of [city, province, country]) {
    const component = value?.trim();
    if (!component || ` ${normalize(address)} `.includes(` ${normalize(component)} `)) continue;
    address = address.trim() ? `${address.replace(/[\s,;]+$/g, '')}, ${component}` : component;
  }
  return { ...canonical, address };
}

/** Resolve old headers without exposing retired fields as new mapping destinations. */
export function resolveAccountImportMappings(headers: string[], mappings: Record<string, number>): Record<string, number> {
  const resolved = { ...mappings };
  const used = new Set(Object.values(mappings));
  const aliases: Record<string, string[]> = {
    city: ['city', 'town', 'municipality'],
    province: ['province', 'state', 'region', 'province state', 'state province'],
    country: ['country', 'nation', 'country name'],
  };
  for (const [key, patterns] of Object.entries(aliases)) {
    if (mappings[key] !== undefined) continue;
    const matches = headers.flatMap((header, index) => !used.has(index)
      && patterns.includes(header.toLowerCase().trim().replace(/[_\s/]+/g, ' ')) ? [index] : []);
    if (matches.length > 1) throw new Error(`Ambiguous legacy address columns for ${key}. Combine them into Full Address before importing.`);
    if (matches.length === 1) { resolved[key] = matches[0]; used.add(matches[0]); }
  }
  return resolved;
}
export const importRowSchemas = { leads: ImportLeadRowSchema, contacts: ImportContactRowSchema, accounts: ImportAccountRowSchema };
export const importRequiredFields: Record<CrmImportModule, string[]> = {
  leads: ['firstName', 'lastName', 'email'],
  contacts: ['firstName', 'lastName', 'email', 'phone', 'companyName', 'address'],
  accounts: ['name'],
};

// Source CSV is validated on the server; callers cannot bypass parsing with mapped rows.
export const CreateCrmImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255).regex(/\.csv$/i, 'Please upload a CSV file.'),
  csvText: z.string().min(1).max(CSV_MAX_BYTES).refine(v => new TextEncoder().encode(v).length <= CSV_MAX_BYTES, 'CSV exceeds the 10MB limit.').optional(),
  uploadId: z.string().uuid().optional(),
  mappings: z.record(z.number().int().nonnegative()).refine(v => Object.keys(v).length <= 100, 'Too many mappings.'),
  idempotencyKey: z.string().uuid(),
}).strict().refine(v => (v.csvText !== undefined) !== (v.uploadId !== undefined), 'Provide a CSV or a completed CSV upload.');
export type CreateCrmImportInput = z.infer<typeof CreateCrmImportSchema>;
export const CsvUploadChunkSchema = z.object({
  uploadId: z.string().uuid(), chunkIndex: z.number().int().min(0).max(159), totalChunks: z.number().int().min(1).max(160),
  content: z.string().min(1).max(65536),
}).strict().refine(v => v.chunkIndex < v.totalChunks, 'Invalid CSV chunk index.');
export const ImportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['pending', 'importing', 'completed', 'completed_with_errors', 'failed']).optional(),
});
export const ImportResultsQuerySchema = ImportListQuerySchema.omit({ status: true }).extend({ status: z.enum(['imported', 'failed', 'duplicate']).optional() });
export interface ImportReviewRow {
  rowNumber: number;
  data: Record<string, string>;
  isValid: boolean;
  status: 'valid' | 'invalid' | 'duplicate';
  errors: string[];
}

/** Quoted commas, BOM, CRLF, multiline cells and physical CSV line numbers. */
export function parseImportCsv(source: string) {
  const records: string[][] = [], rowNumbers: number[] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
  const finishCell = () => { row.push(cell.trim()); cell = ''; closed = false; if (row.length > CSV_MAX_COLUMNS) throw new Error('Maximum 100 CSV columns.'); };
  const finishRow = () => { finishCell(); if (row.some(Boolean)) { records.push(row); rowNumbers.push(start); } row = []; };
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else { cell += char; if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line++; }
    } else if (char === ',') finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRow(); line++; start = line;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (char === '"' || (closed && char.trim())) throw new Error(`Malformed CSV at line ${line}: unexpected text outside a quoted field.`);
      if (!closed) cell += char;
    }
    if (records.length > CSV_MAX_ROWS + 1) throw new Error('Maximum 5000 rows per import.');
  }
  if (quoted) throw new Error('Malformed CSV: a quoted field is not closed.');
  if (cell || row.length || closed) finishRow();
  if (!records.length) return { headers: [], rows: [], rowNumbers: [] };
  const [headers, ...rows] = records;
  if (headers.some(h => !h) || new Set(headers.map(importIdentity)).size !== headers.length) throw new Error('CSV headers must be nonempty and unique.');
  if (rows.length > CSV_MAX_ROWS) throw new Error('Maximum 5000 rows per import.');
  if (rows.some(r => r.length !== headers.length)) throw new Error('Malformed CSV: every row must have the same number of columns as the header.');
  return { headers, rows, rowNumbers: rowNumbers.slice(1) };
}

export function mapImportCsv(module: CrmImportModule, input: CreateCrmImportInput) {
  if (!input.csvText) throw new Error('CSV upload is unavailable. Select the file again.');
  const parsed = parseImportCsv(input.csvText);
  if (!parsed.rows.length) throw new Error('The CSV must contain headers and at least one data row.');
  if (!Object.prototype.hasOwnProperty.call(importRowSchemas, module)) throw new Error('Unsupported CRM import module.');
  const fields = Object.keys((module === 'accounts' ? importAccountFields : importRowSchemas[module]).shape);
  const indices = Object.values(input.mappings);
  if (new Set(indices).size !== indices.length) throw new Error('Each CSV column may only be mapped once.');
  for (const [key, index] of Object.entries(input.mappings)) {
    if (!fields.includes(key)) throw new Error(`Unsupported import field: ${key}.`);
    if (index >= parsed.headers.length) throw new Error(`Invalid column mapping for ${key}.`);
  }
  for (const key of importRequiredFields[module]) if (input.mappings[key] === undefined) throw new Error(`Missing required column mapping: ${key}.`);
  const mappings = module === 'accounts' ? resolveAccountImportMappings(parsed.headers, input.mappings) : input.mappings;
  return parsed.rows.map((row, index) => ({ rowNumber: parsed.rowNumbers[index],
    data: Object.fromEntries(fields.map(key => [key, mappings[key] === undefined ? '' : row[mappings[key]]])),
  }));
}

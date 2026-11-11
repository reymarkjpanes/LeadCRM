"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportResultsQuerySchema = exports.ImportListQuerySchema = exports.CsvUploadChunkSchema = exports.CreateCrmImportSchema = exports.importRequiredFields = exports.importRowSchemas = exports.ImportAccountRowSchema = exports.ImportContactRowSchema = exports.ImportLeadRowSchema = exports.splitProductInterests = exports.importIdentity = exports.CSV_MAX_COLUMNS = exports.CSV_MAX_ROWS = exports.CSV_MAX_BYTES = void 0;
exports.normalizeAccountImportRow = normalizeAccountImportRow;
exports.resolveAccountImportMappings = resolveAccountImportMappings;
exports.parseImportCsv = parseImportCsv;
exports.mapImportCsv = mapImportCsv;
const zod_1 = require("zod");
const lead_contract_1 = require("../contracts/lead.contract");
const profile_contract_1 = require("../contracts/profile.contract");
exports.CSV_MAX_BYTES = 10 * 1024 * 1024;
exports.CSV_MAX_ROWS = 5000;
exports.CSV_MAX_COLUMNS = 100;
const importIdentity = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
exports.importIdentity = importIdentity;
const splitProductInterests = (value) => [...new Map(value.split(';').map(v => v.trim()).filter(Boolean).map(v => [(0, exports.importIdentity)(v), v])).values()];
exports.splitProductInterests = splitProductInterests;
const text = (max) => zod_1.z.string().trim().max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), 'Unsupported control character.');
const required = (label, max = 255) => text(max).refine(Boolean, `${label} is required.`);
const optional = (max = 255) => text(max).optional().default('');
const products = optional(20000).refine(v => (0, exports.splitProductInterests)(v).length <= 100, 'Maximum 100 Product Interests.');
const website = optional(500).refine(v => {
    if (!v)
        return true;
    try {
        return ['http:', 'https:'].includes(new URL(v.includes('://') ? v : `https://${v}`).protocol);
    }
    catch {
        return false;
    }
}, 'Website must be a valid HTTP or HTTPS URL.');
const person = {
    firstName: zod_1.z.string().superRefine((value, ctx) => {
        const error = (0, profile_contract_1.getNameDigitError)('firstName', value);
        if (error)
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: error });
    }).pipe(required('First Name', 100)),
    lastName: zod_1.z.string().superRefine((value, ctx) => {
        const error = (0, profile_contract_1.getNameDigitError)('lastName', value);
        if (error)
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: error });
    }).pipe(required('Last Name', 100)),
    email: zod_1.z.string().trim().toLowerCase().max(254).email('Invalid email address.'),
    phone: required('Phone Number', 50), companyName: required('Company Name', 200),
    address: required('Full Address', 500), productInterest: products,
};
exports.ImportLeadRowSchema = zod_1.z.object({ ...person, firstName: lead_contract_1.LeadFieldsSchema.shape.firstName, lastName: lead_contract_1.LeadFieldsSchema.shape.lastName, phone: lead_contract_1.LeadPhoneSchema.optional().default(''), companyName: optional(2000), address: optional(2000), source: lead_contract_1.OptionalLeadSourceSchema.optional().default(''),
    status: optional(30).transform(v => v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : 'Inquiry')
        .pipe(zod_1.z.enum(['Inquiry', 'Hot', 'Warm', 'Cold', 'Cancelled'], { errorMap: () => ({ message: 'Status must be Inquiry, Hot, Warm, Cold or Cancelled. Close customers through a confirmed Closed Deal Deal.' }) })),
}).strict();
exports.ImportContactRowSchema = zod_1.z.object(person).strict();
exports.ImportAccountRowSchema = zod_1.z.object({ name: required('Company Name').transform(v => v.replace(/\s+/g, ' ')),
    // Split components are accepted only for legacy CSV/API compatibility.
    industry: optional(255), website, address: optional(500), city: optional(100), province: optional(100), country: optional(100),
    size: optional(20).refine(v => !v || ['1-10', '11-50', '51-200', '200+'].includes(v), 'Invalid Company Size.'),
}).strict();
/** CSV values are explicit: never infer or discard a supplied country. */
function normalizeAccountImportRow(data) {
    const { city, province, country, ...canonical } = data;
    let address = data.address ?? '';
    const normalize = (value) => value.toLowerCase().replace(/[\s,;]+/g, ' ').trim();
    for (const value of [city, province, country]) {
        const component = value?.trim();
        if (!component || ` ${normalize(address)} `.includes(` ${normalize(component)} `))
            continue;
        address = address.trim() ? `${address.replace(/[\s,;]+$/g, '')}, ${component}` : component;
    }
    return { ...canonical, address };
}
/** Resolve old headers without exposing retired fields as new mapping destinations. */
function resolveAccountImportMappings(headers, mappings) {
    const resolved = { ...mappings };
    const used = new Set(Object.values(mappings));
    const aliases = {
        city: ['city', 'town', 'municipality'],
        province: ['province', 'state', 'region', 'province state', 'state province'],
        country: ['country', 'nation', 'country name'],
    };
    for (const [key, patterns] of Object.entries(aliases)) {
        if (mappings[key] !== undefined)
            continue;
        const matches = headers.flatMap((header, index) => !used.has(index)
            && patterns.includes(header.toLowerCase().trim().replace(/[_\s/]+/g, ' ')) ? [index] : []);
        if (matches.length > 1)
            throw new Error(`Ambiguous legacy address columns for ${key}. Combine them into Full Address before importing.`);
        if (matches.length === 1) {
            resolved[key] = matches[0];
            used.add(matches[0]);
        }
    }
    return resolved;
}
exports.importRowSchemas = { leads: exports.ImportLeadRowSchema, contacts: exports.ImportContactRowSchema, accounts: exports.ImportAccountRowSchema };
exports.importRequiredFields = {
    leads: ['firstName', 'lastName', 'email'],
    contacts: ['firstName', 'lastName', 'email', 'phone', 'companyName', 'address'],
    accounts: ['name'],
};
// Source CSV is validated on the server; callers cannot bypass parsing with mapped rows.
exports.CreateCrmImportSchema = zod_1.z.object({
    fileName: zod_1.z.string().trim().min(1).max(255).regex(/\.csv$/i, 'Please upload a CSV file.'),
    csvText: zod_1.z.string().min(1).max(exports.CSV_MAX_BYTES).refine(v => new TextEncoder().encode(v).length <= exports.CSV_MAX_BYTES, 'CSV exceeds the 10MB limit.').optional(),
    uploadId: zod_1.z.string().uuid().optional(),
    mappings: zod_1.z.record(zod_1.z.number().int().nonnegative()).refine(v => Object.keys(v).length <= 100, 'Too many mappings.'),
    idempotencyKey: zod_1.z.string().uuid(),
}).strict().refine(v => (v.csvText !== undefined) !== (v.uploadId !== undefined), 'Provide a CSV or a completed CSV upload.');
exports.CsvUploadChunkSchema = zod_1.z.object({
    uploadId: zod_1.z.string().uuid(), chunkIndex: zod_1.z.number().int().min(0).max(159), totalChunks: zod_1.z.number().int().min(1).max(160),
    content: zod_1.z.string().min(1).max(65536),
}).strict().refine(v => v.chunkIndex < v.totalChunks, 'Invalid CSV chunk index.');
exports.ImportListQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1), limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    status: zod_1.z.enum(['pending', 'importing', 'completed', 'completed_with_errors', 'failed']).optional(),
});
exports.ImportResultsQuerySchema = exports.ImportListQuerySchema.omit({ status: true }).extend({ status: zod_1.z.enum(['imported', 'failed', 'duplicate']).optional() });
/** Quoted commas, BOM, CRLF, multiline cells and physical CSV line numbers. */
function parseImportCsv(source) {
    const records = [], rowNumbers = [];
    let row = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
    const finishCell = () => { row.push(cell.trim()); cell = ''; closed = false; if (row.length > exports.CSV_MAX_COLUMNS)
        throw new Error('Maximum 100 CSV columns.'); };
    const finishRow = () => { finishCell(); if (row.some(Boolean)) {
        records.push(row);
        rowNumbers.push(start);
    } row = []; };
    const text = source.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (char === '"') {
                quoted = false;
                closed = true;
            }
            else {
                cell += char;
                if (char === '\n' || (char === '\r' && text[i + 1] !== '\n'))
                    line++;
            }
        }
        else if (char === ',')
            finishCell();
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n')
                i++;
            finishRow();
            line++;
            start = line;
        }
        else if (char === '"' && !cell && !closed)
            quoted = true;
        else {
            if (char === '"' || (closed && char.trim()))
                throw new Error(`Malformed CSV at line ${line}: unexpected text outside a quoted field.`);
            if (!closed)
                cell += char;
        }
        if (records.length > exports.CSV_MAX_ROWS + 1)
            throw new Error('Maximum 5000 rows per import.');
    }
    if (quoted)
        throw new Error('Malformed CSV: a quoted field is not closed.');
    if (cell || row.length || closed)
        finishRow();
    if (!records.length)
        return { headers: [], rows: [], rowNumbers: [] };
    const [headers, ...rows] = records;
    if (headers.some(h => !h) || new Set(headers.map(exports.importIdentity)).size !== headers.length)
        throw new Error('CSV headers must be nonempty and unique.');
    if (rows.length > exports.CSV_MAX_ROWS)
        throw new Error('Maximum 5000 rows per import.');
    if (rows.some(r => r.length !== headers.length))
        throw new Error('Malformed CSV: every row must have the same number of columns as the header.');
    return { headers, rows, rowNumbers: rowNumbers.slice(1) };
}
function mapImportCsv(module, input) {
    if (!input.csvText)
        throw new Error('CSV upload is unavailable. Select the file again.');
    const parsed = parseImportCsv(input.csvText);
    if (!parsed.rows.length)
        throw new Error('The CSV must contain headers and at least one data row.');
    if (!Object.prototype.hasOwnProperty.call(exports.importRowSchemas, module))
        throw new Error('Unsupported CRM import module.');
    const schema = exports.importRowSchemas[module];
    const fields = Object.keys(schema.shape);
    const indices = Object.values(input.mappings);
    if (new Set(indices).size !== indices.length)
        throw new Error('Each CSV column may only be mapped once.');
    for (const [key, index] of Object.entries(input.mappings)) {
        if (!fields.includes(key))
            throw new Error(`Unsupported import field: ${key}.`);
        if (index >= parsed.headers.length)
            throw new Error(`Invalid column mapping for ${key}.`);
    }
    for (const key of exports.importRequiredFields[module])
        if (input.mappings[key] === undefined)
            throw new Error(`Missing required column mapping: ${key}.`);
    const mappings = module === 'accounts' ? resolveAccountImportMappings(parsed.headers, input.mappings) : input.mappings;
    return parsed.rows.map((row, index) => ({ rowNumber: parsed.rowNumbers[index],
        data: Object.fromEntries(fields.map(key => [key, mappings[key] === undefined ? '' : row[mappings[key]]])),
    }));
}

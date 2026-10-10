"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportResultsQuerySchema = exports.ImportListQuerySchema = exports.CsvUploadChunkSchema = exports.CreateCrmImportSchema = exports.importRequiredFields = exports.importRowSchemas = exports.ImportDealRowSchema = exports.ImportAccountRowSchema = exports.ImportContactRowSchema = exports.ImportLeadRowSchema = exports.splitProductInterests = exports.importIdentity = exports.CSV_MAX_ROWS = exports.CSV_MAX_BYTES = void 0;
exports.parseImportCsv = parseImportCsv;
exports.mapImportCsv = mapImportCsv;
const zod_1 = require("zod");
const lead_contract_1 = require("../contracts/lead.contract");
exports.CSV_MAX_BYTES = 10 * 1024 * 1024;
exports.CSV_MAX_ROWS = 5000;
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
    firstName: required('First Name', 100), lastName: required('Last Name', 100),
    email: zod_1.z.string().trim().toLowerCase().max(254).email('Invalid email address.'),
    phone: required('Phone Number', 50), companyName: required('Company Name', 200),
    address: required('Full Address', 500), productInterest: products,
};
exports.ImportLeadRowSchema = zod_1.z.object({ ...person, firstName: lead_contract_1.LeadNameSchema, lastName: lead_contract_1.LeadNameSchema, phone: lead_contract_1.LeadPhoneSchema.optional().default(''), companyName: optional(2000), address: optional(2000), source: lead_contract_1.OptionalLeadSourceSchema.optional().default(''),
    status: optional(30).transform(v => v ? v[0].toUpperCase() + v.slice(1).toLowerCase() : 'Warm')
        .pipe(zod_1.z.enum(['Hot', 'Warm', 'Cold', 'Cancelled'], { errorMap: () => ({ message: 'Status must be Hot, Warm, Cold or Cancelled. Close customers through a confirmed Closed Won Deal.' }) })),
}).strict();
exports.ImportContactRowSchema = zod_1.z.object(person).strict();
exports.ImportAccountRowSchema = zod_1.z.object({ name: required('Company Name').transform(v => v.replace(/\s+/g, ' ')),
    industry: optional(255), website, address: optional(500), city: optional(100), province: optional(100), country: optional(100),
    size: optional(20).refine(v => !v || ['1-10', '11-50', '51-200', '200+'].includes(v), 'Invalid Company Size.'), productInterest: products,
}).strict();
exports.ImportDealRowSchema = zod_1.z.object({
    title: required('Deal Title'), pipeline: required('Pipeline'), stage: required('Stage'),
    productInterest: required('Product Interest', 200).refine(v => (0, exports.splitProductInterests)(v).length === 1, 'Each Deal must have exactly one Product Interest.'),
    customer: optional(254), contact: optional(254), lead: optional(254), account: optional(255), assignedUser: optional(254),
    priority: optional(10).transform(v => v.toUpperCase() || 'MEDIUM').pipe(zod_1.z.enum(['LOW', 'MEDIUM', 'HIGH'])),
    expectedCloseDate: optional(10).refine(v => {
        if (!v)
            return true;
        const date = new Date(`${v}T00:00:00.000Z`);
        return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
    }, 'Expected close date must be a real date in YYYY-MM-DD format.'),
}).strict();
exports.importRowSchemas = { leads: exports.ImportLeadRowSchema, contacts: exports.ImportContactRowSchema, accounts: exports.ImportAccountRowSchema, deals: exports.ImportDealRowSchema };
exports.importRequiredFields = {
    leads: ['firstName', 'lastName', 'email'],
    contacts: ['firstName', 'lastName', 'email', 'phone', 'companyName', 'address'],
    accounts: ['name'], deals: ['title', 'productInterest', 'pipeline', 'stage'],
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
    const finishCell = () => { row.push(cell.trim()); cell = ''; closed = false; if (row.length > 100)
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
    const fields = Object.keys(exports.importRowSchemas[module].shape);
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
    return parsed.rows.map((row, index) => ({ rowNumber: parsed.rowNumbers[index],
        data: Object.fromEntries(fields.map(key => [key, input.mappings[key] === undefined ? '' : row[input.mappings[key]]])),
    }));
}

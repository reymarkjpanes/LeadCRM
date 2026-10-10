"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSING_FILE_MAX_BYTES = exports.DEFAULT_CLOSING_FIELDS = exports.ClosingValuesPatchSchema = exports.normalizeCustomField = exports.isClosedWonField = exports.CustomFieldValuesSchema = exports.ClosingFieldInputSchema = exports.customFieldNameKey = exports.customFieldGroupOptions = exports.CUSTOM_FIELD_BUILT_IN_GROUPS = exports.CLOSED_WON_GROUP = exports.CUSTOM_FIELD_MODULE_LABELS = exports.CUSTOM_FIELD_MODULES = exports.CLOSING_FIELD_TYPES = void 0;
exports.closingValueError = closingValueError;
const zod_1 = require("zod");
const record_experience_1 = require("./record-experience");
Object.defineProperty(exports, "CLOSING_FILE_MAX_BYTES", { enumerable: true, get: function () { return record_experience_1.RECORD_FILE_MAX_BYTES; } });
exports.CLOSING_FIELD_TYPES = ['Text', 'Long Text', 'Number', 'Date', 'Dropdown', 'File Upload'];
exports.CUSTOM_FIELD_MODULES = ['leads', 'contacts', 'accounts', 'deals'];
exports.CUSTOM_FIELD_MODULE_LABELS = { leads: 'Leads', contacts: 'Contacts', accounts: 'Accounts', deals: 'Deals' };
exports.CLOSED_WON_GROUP = 'Closed Won Requirements';
exports.CUSTOM_FIELD_BUILT_IN_GROUPS = {
    leads: ['Basic Information', 'Status & Interest', 'Organization', 'Additional Information'],
    contacts: ['Basic Information', 'Status & Classification', 'Relationships', 'Additional Information'],
    accounts: ['Basic Information', 'Address', 'Relationships', 'Products & Interests', 'Notes'],
    deals: ['Deal Information', 'Relationships', 'Additional Details', exports.CLOSED_WON_GROUP],
};
const customFieldGroupOptions = (module, previous) => [...new Set([...exports.CUSTOM_FIELD_BUILT_IN_GROUPS[module], ...(previous?.module === module ? [previous.group] : [])])];
exports.customFieldGroupOptions = customFieldGroupOptions;
const customFieldNameKey = (value) => value.trim().toLowerCase();
exports.customFieldNameKey = customFieldNameKey;
exports.ClosingFieldInputSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'Field name is required.').max(100),
    type: zod_1.z.enum(exports.CLOSING_FIELD_TYPES),
    // Retained only for old API clients. Module/group are the canonical context.
    appliesTo: zod_1.z.literal('Closed Won Requirements').optional(),
    module: zod_1.z.enum(exports.CUSTOM_FIELD_MODULES).default('deals'),
    group: zod_1.z.string().trim().min(1, 'Group / Section is required.').max(100).default(exports.CLOSED_WON_GROUP),
    visibleInForm: zod_1.z.boolean().default(true),
    order: zod_1.z.number().int().min(0).max(100000).default(0),
    required: zod_1.z.boolean(),
    active: zod_1.z.boolean().default(true),
    description: zod_1.z.string().trim().max(1000).default(''),
    options: zod_1.z.array(zod_1.z.string().trim().min(1).max(100)).max(100).default([]),
}).strict().superRefine((field, ctx) => {
    if (field.type === 'Dropdown' && (!field.options.length || new Set(field.options.map(o => o.toLowerCase())).size !== field.options.length)) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option; options must be unique.' });
    }
});
exports.CustomFieldValuesSchema = zod_1.z.record(zod_1.z.string().min(1).max(100), zod_1.z.union([zod_1.z.string().max(10000), zod_1.z.number().finite(), zod_1.z.null()])).refine(v => Object.keys(v).length <= 100, 'Supply at most 100 field values.');
const isClosedWonField = (field) => field.module === 'deals' && (0, exports.customFieldNameKey)(field.group) === (0, exports.customFieldNameKey)(exports.CLOSED_WON_GROUP);
exports.isClosedWonField = isClosedWonField;
/** Legacy definitions/snapshots retain their IDs and original context. */
const normalizeCustomField = (field) => ({ ...field, module: field.module ?? 'deals', group: field.group ?? exports.CLOSED_WON_GROUP, visibleInForm: field.visibleInForm ?? true, order: field.order ?? 0 });
exports.normalizeCustomField = normalizeCustomField;
exports.ClosingValuesPatchSchema = zod_1.z.object({ values: zod_1.z.record(zod_1.z.string().min(1).max(100), zod_1.z.union([zod_1.z.string().max(10000), zod_1.z.number().finite(), zod_1.z.null()])).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 100, 'Supply 1–100 field values.') }).strict();
exports.DEFAULT_CLOSING_FIELDS = [
    { id: 'confirmation-type', name: 'Confirmation Type', type: 'Dropdown', required: true, options: ['Approved Quotation', 'Signed Contract', 'Purchase Order Received', 'Order Confirmed', 'Other'] },
    { id: 'confirmation-date', name: 'Confirmation Date', type: 'Date', required: true },
    { id: 'reference-number', name: 'Reference Number', type: 'Text', required: false },
    { id: 'required-document', name: 'Required Document', type: 'File Upload', required: false },
    { id: 'closing-notes', name: 'Closing Notes', type: 'Long Text', required: false },
].map((field, order) => ({ options: [], description: '', active: true, module: 'deals', group: exports.CLOSED_WON_GROUP, visibleInForm: true, order, version: 1, ...field }));
/** File IDs are checked against tenant/Deal-owned persistent records by the backend. */
function closingValueError(field, value) {
    const empty = value == null || typeof value === 'string' && !value.trim();
    if (empty)
        return field.required ? `${field.name} is required.` : undefined;
    if (field.type === 'Number')
        return typeof value === 'number' && Number.isFinite(value) ? undefined : 'Enter a valid number.';
    if (typeof value !== 'string')
        return 'Enter a valid value.';
    if (field.type === 'Date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
        return 'Enter a valid date.';
    if (field.type === 'Dropdown' && !field.options.includes(value))
        return 'Select a configured option.';
    if (field.type === 'File Upload' && !zod_1.z.string().uuid().safeParse(value).success)
        return 'Upload a persistent file first.';
    if (value.length > (field.type === 'Long Text' ? 10000 : 1000))
        return 'Value is too long.';
}

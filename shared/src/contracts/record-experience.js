"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordEmailAttachmentContextSchema = exports.CRM_FILE_FORMAT_ERROR = exports.CRM_FILE_SIZE_ERROR = exports.CRM_FILE_ACCEPT = exports.CRM_FILE_EXTENSIONS = exports.RECORD_FILE_MAX_BYTES = exports.LeadStatusSchema = exports.LEAD_STATUSES = exports.CrmStatusSchema = exports.COMPANY_SIZE_OPTIONS = exports.LeadSourceSchema = exports.SELECTABLE_LEAD_SOURCES = exports.isDirectMailSource = exports.LEAD_SOURCES = exports.CRM_STATUSES = void 0;
exports.isAssignableAgent = isAssignableAgent;
exports.normalizeCrmStatus = normalizeCrmStatus;
exports.crmFileExtension = crmFileExtension;
exports.crmFileValidationError = crmFileValidationError;
const zod_1 = require("zod");
exports.CRM_STATUSES = ['Inquiry', 'Hot', 'Warm', 'Cold', 'Closed Deal', 'Cancelled'];
exports.LEAD_SOURCES = ['Google Ads', 'Referral', 'Email Campaign', 'Direct Email', 'Website', 'Social Media Advertisement', 'Direct Mail', 'Content Marketing', 'Others'];
const isDirectMailSource = (value) => typeof value === 'string' && value.trim().toLowerCase() === 'direct mail';
exports.isDirectMailSource = isDirectMailSource;
exports.SELECTABLE_LEAD_SOURCES = exports.LEAD_SOURCES.filter(source => !(0, exports.isDirectMailSource)(source));
exports.LeadSourceSchema = zod_1.z.enum(exports.LEAD_SOURCES);
exports.COMPANY_SIZE_OPTIONS = ['1-10', '11-50', '51-200', '200+'];
/** Keep assignment eligibility consistent between CRM controls and audience validation. */
function isAssignableAgent(user) {
    return !user.isArchived && !['client admin', 'guest'].includes(user.role?.trim().toLowerCase() ?? '')
        && user.status?.toUpperCase() === 'ACTIVE' && user.assignableAgent === true;
}
exports.CrmStatusSchema = zod_1.z.enum(exports.CRM_STATUSES);
exports.LEAD_STATUSES = exports.CRM_STATUSES;
exports.LeadStatusSchema = exports.CrmStatusSchema;
/** Read legacy stored statuses into canonical UI state. API validation stays strict. */
function normalizeCrmStatus(status) {
    // Historical workflow snapshots and Contact enum values remain readable.
    if (['closed', 'closed_deal', 'closed deal'].includes(status?.trim().toLowerCase() ?? ''))
        return 'Closed Deal';
    return exports.CRM_STATUSES.find(value => value.toLowerCase() === status?.toLowerCase()) ?? 'Warm';
}
exports.RECORD_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Manual CRM Files tabs only; custom-field and import policies remain independent. */
exports.CRM_FILE_EXTENSIONS = ['csv', 'png', 'jpg', 'jpeg', 'pdf', 'txt', 'docx'];
exports.CRM_FILE_ACCEPT = exports.CRM_FILE_EXTENSIONS.map(extension => `.${extension}`).join(',');
exports.CRM_FILE_SIZE_ERROR = 'File size must not exceed 10 MB.';
exports.CRM_FILE_FORMAT_ERROR = 'Unsupported file format. Please upload CSV, PNG, JPG, JPEG, PDF, TXT, or DOCX files.';
function crmFileExtension(name) {
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    return exports.CRM_FILE_EXTENSIONS.find(allowed => allowed === extension);
}
function crmFileValidationError(file) {
    if (file.size > exports.RECORD_FILE_MAX_BYTES)
        return exports.CRM_FILE_SIZE_ERROR;
    if (!crmFileExtension(file.name))
        return exports.CRM_FILE_FORMAT_ERROR;
    if (!file.size)
        return 'Choose a nonempty file.';
}
exports.RecordEmailAttachmentContextSchema = zod_1.z.object({
    recordModule: zod_1.z.enum(['leads', 'contacts', 'deals']),
    recordId: zod_1.z.string().uuid(),
    accountId: zod_1.z.string().uuid().optional(),
}).strict();

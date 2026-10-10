"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECORD_FILE_MAX_BYTES = exports.LeadStatusSchema = exports.LEAD_STATUSES = exports.CrmStatusSchema = exports.COMPANY_SIZE_OPTIONS = exports.LeadSourceSchema = exports.LEAD_SOURCES = exports.CRM_STATUSES = void 0;
exports.isAssignableAgent = isAssignableAgent;
exports.normalizeCrmStatus = normalizeCrmStatus;
const zod_1 = require("zod");
exports.CRM_STATUSES = ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled'];
exports.LEAD_SOURCES = ['Google Ads', 'Referral', 'Email Campaign', 'Website', 'Social Media Advertisement', 'Direct Mail', 'Content Marketing', 'Others'];
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
    return exports.CRM_STATUSES.find(value => value.toLowerCase() === status?.toLowerCase()) ?? 'Warm';
}
exports.RECORD_FILE_MAX_BYTES = 10 * 1024 * 1024;

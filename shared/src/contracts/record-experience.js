"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECORD_FILE_MAX_BYTES = exports.LeadStatusSchema = exports.LEAD_STATUSES = exports.CrmStatusSchema = exports.CRM_STATUSES = void 0;
exports.normalizeCrmStatus = normalizeCrmStatus;
const zod_1 = require("zod");
exports.CRM_STATUSES = ['Hot', 'Warm', 'Cold', 'Closed', 'Cancelled'];
exports.CrmStatusSchema = zod_1.z.enum(exports.CRM_STATUSES);
exports.LEAD_STATUSES = exports.CRM_STATUSES;
exports.LeadStatusSchema = exports.CrmStatusSchema;
/** Read legacy stored statuses into canonical UI state. API validation stays strict. */
function normalizeCrmStatus(status) {
    var _a;
    return (_a = exports.CRM_STATUSES.find(value => value.toLowerCase() === (status === null || status === void 0 ? void 0 : status.toLowerCase()))) !== null && _a !== void 0 ? _a : 'Warm';
}
exports.RECORD_FILE_MAX_BYTES = 10 * 1024 * 1024;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeactivateUserSchema = exports.UpdateLeadSchema = exports.CreateLeadSchema = exports.OptionalLeadSourceSchema = exports.LeadPhoneSchema = exports.LeadNameSchema = void 0;
const zod_1 = require("zod");
const administration_user_schema_1 = require("../validation/administration-user.schema");
const crm_email_1 = require("../validation/crm-email");
const record_experience_1 = require("./record-experience");
const closing_requirements_1 = require("./closing-requirements");
exports.LeadNameSchema = (0, administration_user_schema_1.cleanText)(100).pipe(zod_1.z.string().min(1, 'Name is required'));
exports.LeadPhoneSchema = zod_1.z.union([zod_1.z.literal(''), administration_user_schema_1.AdministrationPhoneSchema]);
exports.OptionalLeadSourceSchema = zod_1.z.union([zod_1.z.literal(''), record_experience_1.LeadSourceSchema]);
const fields = {
    firstName: exports.LeadNameSchema,
    lastName: exports.LeadNameSchema,
    email: crm_email_1.CrmEmailSchema,
    phone: exports.LeadPhoneSchema.optional(),
    companyName: (0, administration_user_schema_1.cleanText)(2000).optional(),
    status: record_experience_1.LeadStatusSchema,
    source: exports.OptionalLeadSourceSchema.optional(),
    accountId: zod_1.z.string().uuid().nullable().optional(),
    assignedUserId: zod_1.z.string().uuid().nullable().optional(),
    productInterest: zod_1.z.array(zod_1.z.string().uuid()).max(100).optional(),
    address: zod_1.z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), 'Control characters are not allowed.').transform(value => value.trim()).pipe(zod_1.z.string().max(2000)).optional(),
    customFieldValues: closing_requirements_1.CustomFieldValuesSchema.optional(),
};
/** The manual Lead API accepts only the final form fields and a retry receipt. */
exports.CreateLeadSchema = zod_1.z.object({ ...fields, status: record_experience_1.LeadStatusSchema.default('Warm'), requestId: zod_1.z.string().uuid().optional() }).strict();
exports.UpdateLeadSchema = zod_1.z.object(fields).partial().strict();
exports.DeactivateUserSchema = zod_1.z.object({ replacementAgentId: zod_1.z.string().uuid().nullable().optional() }).strict();

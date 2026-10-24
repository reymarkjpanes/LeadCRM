"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeactivateUserSchema = exports.ConvertLeadSchema = exports.UpdateLeadSchema = exports.ManualCreateLeadSchema = exports.CreateLeadSchema = exports.LeadFieldsSchema = exports.OptionalLeadSourceSchema = exports.LeadPhoneSchema = exports.LeadNameSchema = void 0;
const zod_1 = require("zod");
const administration_user_schema_1 = require("../validation/administration-user.schema");
const crm_email_1 = require("../validation/crm-email");
const record_experience_1 = require("./record-experience");
const closing_requirements_1 = require("./closing-requirements");
const organization_1 = require("./organization");
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
    newAccount: organization_1.NewAccountSchema.optional(),
    assignedUserId: zod_1.z.string().uuid().nullable().optional(),
    productInterest: zod_1.z.array(zod_1.z.string().uuid()).max(100).optional(),
    address: zod_1.z.string().refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), 'Control characters are not allowed.').transform(value => value.trim()).pipe(zod_1.z.string().max(2000)).optional(),
    customFieldValues: closing_requirements_1.CustomFieldValuesSchema.optional(),
};
/** The manual Lead API accepts only the final form fields and a retry receipt. */
exports.LeadFieldsSchema = zod_1.z.object(fields).strict();
exports.CreateLeadSchema = exports.LeadFieldsSchema.extend({ status: record_experience_1.LeadStatusSchema.default('Inquiry'), requestId: zod_1.z.string().uuid().optional() })
    .refine(organization_1.exclusiveAccountInput, { path: ['newAccount'], message: 'Select an Account or create a new one, not both.' });
exports.ManualCreateLeadSchema = exports.CreateLeadSchema.refine(data => data.status === 'Inquiry', {
    path: ['status'], message: 'Manually created Leads start with Inquiry status.',
});
exports.UpdateLeadSchema = exports.LeadFieldsSchema.partial().extend({ expectedUpdatedAt: zod_1.z.string().datetime().optional() })
    .refine(organization_1.exclusiveAccountInput, { path: ['newAccount'], message: 'Select an Account or create a new one, not both.' });
/** New Account details use the same contract as standalone and linked creation. */
exports.ConvertLeadSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid().optional(),
    accountName: zod_1.z.string().trim().min(1).max(2000).optional(),
    newAccount: organization_1.NewAccountSchema.optional(),
    skipAccountCreation: zod_1.z.boolean().optional(),
    createContact: zod_1.z.literal(true).default(true),
    contactId: zod_1.z.string().uuid().optional(),
    createDeal: zod_1.z.literal(false).default(false),
    dealId: zod_1.z.string().uuid().optional(),
}).strict().refine(value => !value.newAccount || (!value.accountId && !value.accountName && !value.skipAccountCreation), {
    path: ['newAccount'], message: 'Choose one Account creation or linking option.',
});
exports.DeactivateUserSchema = zod_1.z.object({ replacementAgentId: zod_1.z.string().uuid().nullable().optional() }).strict();

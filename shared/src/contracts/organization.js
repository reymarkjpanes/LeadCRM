"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewAccountSchema = exports.AccountUpdateFieldsSchema = exports.AccountFieldsSchema = exports.CrmAddressSchema = exports.CrmCompanyNameSchema = exports.CRM_ADDRESS_MAX_ERROR = exports.COMPANY_NAME_MAX_ERROR = exports.CRM_ADDRESS_MAX_LENGTH = exports.COMPANY_NAME_MAX_LENGTH = void 0;
exports.exclusiveAccountInput = exclusiveAccountInput;
const zod_1 = require("zod");
const administration_user_schema_1 = require("../validation/administration-user.schema");
const closing_requirements_1 = require("./closing-requirements");
const record_experience_1 = require("./record-experience");
const text_length_1 = require("../validation/text-length");
exports.COMPANY_NAME_MAX_LENGTH = 255;
exports.CRM_ADDRESS_MAX_LENGTH = 500;
exports.COMPANY_NAME_MAX_ERROR = (0, text_length_1.maxLengthMessage)('Company name', exports.COMPANY_NAME_MAX_LENGTH);
exports.CRM_ADDRESS_MAX_ERROR = (0, text_length_1.maxLengthMessage)('Address', exports.CRM_ADDRESS_MAX_LENGTH);
exports.CrmCompanyNameSchema = (0, administration_user_schema_1.cleanText)(exports.COMPANY_NAME_MAX_LENGTH, exports.COMPANY_NAME_MAX_ERROR);
exports.CrmAddressSchema = zod_1.z.string()
    .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value), 'Control characters are not allowed.')
    .transform(value => value.trim()).pipe(zod_1.z.string().max(exports.CRM_ADDRESS_MAX_LENGTH, exports.CRM_ADDRESS_MAX_ERROR));
/** Native Account fields shared by standalone and linked Account forms. */
exports.AccountFieldsSchema = zod_1.z.object({
    name: exports.CrmCompanyNameSchema.pipe(zod_1.z.string().min(1, 'Account name is required.')),
    industry: (0, administration_user_schema_1.cleanText)(2000).optional(),
    size: zod_1.z.enum(record_experience_1.COMPANY_SIZE_OPTIONS).optional(),
    website: zod_1.z.string().trim().url('Must be a valid URL').optional().or(zod_1.z.literal('')),
    address: exports.CrmAddressSchema.optional(),
});
/** Omitted fields stay unchanged; null explicitly clears an optional Company Size. */
exports.AccountUpdateFieldsSchema = exports.AccountFieldsSchema.partial().extend({
    size: exports.AccountFieldsSchema.shape.size.nullable(),
});
/** A retry identity belongs to this Account creation, including saves from edit forms. */
exports.NewAccountSchema = exports.AccountFieldsSchema.extend({
    requestId: zod_1.z.string().uuid(),
    customFieldValues: closing_requirements_1.CustomFieldValuesSchema.optional(),
}).strict();
function exclusiveAccountInput(input) {
    return !input.newAccount || !input.accountId;
}

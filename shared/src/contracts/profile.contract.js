"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AVATAR_MAX_BYTES = exports.AVATAR_MIME_TYPES = exports.ConfirmProfileEmailChangeSchema = exports.RequestProfileEmailChangeSchema = exports.UpdateSelfProfileSchema = exports.SelfProfileFieldSchemas = exports.ProfilePhoneInputSchema = exports.PROFILE_FIELD_LIMIT_ERRORS = exports.PROFILE_FIELD_LIMITS = void 0;
exports.getNameDigitError = getNameDigitError;
exports.personNameSchema = personNameSchema;
const zod_1 = require("zod");
const ph_phone_1 = require("../validation/ph-phone");
const text_length_1 = require("../validation/text-length");
const security_schema_1 = require("../validation/security.schema");
exports.PROFILE_FIELD_LIMITS = { firstName: 100, lastName: 100, jobTitle: 100 };
exports.PROFILE_FIELD_LIMIT_ERRORS = {
    firstName: (0, text_length_1.maxLengthMessage)('First name', exports.PROFILE_FIELD_LIMITS.firstName),
    lastName: (0, text_length_1.maxLengthMessage)('Last name', exports.PROFILE_FIELD_LIMITS.lastName),
    jobTitle: (0, text_length_1.maxLengthMessage)('Job title', exports.PROFILE_FIELD_LIMITS.jobTitle),
};
function getNameDigitError(field, value, validateSpecialCharacters = true) {
    if (typeof value !== 'string')
        return;
    const label = field === 'firstName' ? 'First name' : field === 'lastName' ? 'Last name' : field === 'fullName' ? 'Full name' : undefined;
    if (!label)
        return;
    if (/\p{N}/u.test(value) || (validateSpecialCharacters && /[^\p{L}\p{M} '\u2018\u2019\u2010\u2011-]/u.test(value))) {
        return `${label} must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().`;
    }
}
const profilePhone = zod_1.z.string().nullable().optional().transform((value, context) => {
    if (value == null)
        return value;
    if (value === '')
        return null;
    const localNumber = value.startsWith('+63') ? value.slice(3) : value;
    if (!(0, ph_phone_1.isValidPhMobile)(localNumber)) {
        context.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: ph_phone_1.PH_MOBILE_ERROR });
        return zod_1.z.NEVER;
    }
    return (0, ph_phone_1.toE164)(localNumber);
});
exports.ProfilePhoneInputSchema = zod_1.z.string().refine(value => value === '' || (0, ph_phone_1.isValidPhMobile)(value), ph_phone_1.PH_MOBILE_ERROR)
    .transform(value => value === '' ? null : (0, ph_phone_1.toE164)(value));
function personNameSchema(field, requiredMessage) {
    const label = field === 'firstName' ? 'First name' : 'Last name';
    return zod_1.z.string().superRefine((value, context) => {
        const error = getNameDigitError(field, value);
        if (error)
            context.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: error });
    }).pipe(zod_1.z.string().trim().min(1, requiredMessage ?? label + ' is required').max(exports.PROFILE_FIELD_LIMITS[field], exports.PROFILE_FIELD_LIMIT_ERRORS[field]));
}
exports.SelfProfileFieldSchemas = {
    firstName: personNameSchema('firstName').optional(),
    lastName: personNameSchema('lastName').optional(),
    phone: exports.ProfilePhoneInputSchema,
};
exports.UpdateSelfProfileSchema = zod_1.z.object({ ...exports.SelfProfileFieldSchemas, phone: profilePhone }).strict()
    .refine(value => Object.keys(value).length > 0, 'No profile changes supplied');
exports.RequestProfileEmailChangeSchema = zod_1.z.object({
    email: security_schema_1.StaffEmailSchema,
    currentPassword: zod_1.z.string().min(1, 'Enter your current password.').max(72),
}).strict();
exports.ConfirmProfileEmailChangeSchema = zod_1.z.object({
    code: zod_1.z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit verification code from your email.'),
}).strict();
exports.AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
exports.AVATAR_MAX_BYTES = 5 * 1024 * 1024;

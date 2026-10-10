"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AVATAR_MAX_BYTES = exports.AVATAR_MIME_TYPES = exports.UpdateSelfProfileSchema = exports.SelfProfileFieldSchemas = exports.ProfilePhoneInputSchema = exports.PROFILE_FIELD_LIMIT_ERRORS = exports.PROFILE_FIELD_LIMITS = void 0;
const zod_1 = require("zod");
const ph_phone_1 = require("../validation/ph-phone");
exports.PROFILE_FIELD_LIMITS = { firstName: 50, lastName: 50, jobTitle: 100 };
exports.PROFILE_FIELD_LIMIT_ERRORS = {
    firstName: `First name must not exceed ${exports.PROFILE_FIELD_LIMITS.firstName} characters.`,
    lastName: `Last name must not exceed ${exports.PROFILE_FIELD_LIMITS.lastName} characters.`,
    jobTitle: `Job title must not exceed ${exports.PROFILE_FIELD_LIMITS.jobTitle} characters.`,
};
const optionalText = (max, message) => zod_1.z.string().trim().max(max, message).nullable().optional();
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
exports.SelfProfileFieldSchemas = {
    firstName: zod_1.z.string().trim().min(1, 'First name is required').max(exports.PROFILE_FIELD_LIMITS.firstName, exports.PROFILE_FIELD_LIMIT_ERRORS.firstName).optional(),
    lastName: zod_1.z.string().trim().min(1, 'Last name is required').max(exports.PROFILE_FIELD_LIMITS.lastName, exports.PROFILE_FIELD_LIMIT_ERRORS.lastName).optional(),
    phone: exports.ProfilePhoneInputSchema,
    jobTitle: optionalText(exports.PROFILE_FIELD_LIMITS.jobTitle, exports.PROFILE_FIELD_LIMIT_ERRORS.jobTitle),
};
exports.UpdateSelfProfileSchema = zod_1.z.object({ ...exports.SelfProfileFieldSchemas, phone: profilePhone }).strict()
    .refine(value => Object.keys(value).length > 0, 'No profile changes supplied');
exports.AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
exports.AVATAR_MAX_BYTES = 5 * 1024 * 1024;

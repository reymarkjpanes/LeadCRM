"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailAvailabilitySchema = exports.PublicFormEmailAvailabilityQuerySchema = exports.UserEmailAvailabilityQuerySchema = exports.CrmEmailAvailabilityQuerySchema = exports.EMAIL_AVAILABILITY_MESSAGES = void 0;
const zod_1 = require("zod");
const crm_email_1 = require("../validation/crm-email");
const security_schema_1 = require("../validation/security.schema");
exports.EMAIL_AVAILABILITY_MESSAGES = {
    STAFF_EMAIL_NOT_ALLOWED: 'This email belongs to a staff account and cannot be used.',
    EMAIL_IN_USE: 'A user with this email already exists in this tenant',
    EXTERNAL_STAFF_EMAIL_NOT_ALLOWED: 'Only Client Admin users can approve an external staff email.',
};
exports.CrmEmailAvailabilityQuerySchema = zod_1.z.object({
    module: zod_1.z.enum(['leads', 'contacts']),
    email: crm_email_1.CrmEmailSchema,
}).strict();
exports.UserEmailAvailabilityQuerySchema = zod_1.z.object({
    email: security_schema_1.StaffEmailSchema, purpose: zod_1.z.literal('staff-creation').optional(),
}).strict().superRefine(({ email, purpose }, context) => {
    if (purpose !== 'staff-creation')
        return;
    const parsed = security_schema_1.StaffCreationEmailSchema.safeParse(email);
    if (!parsed.success)
        context.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: ['email'], message: parsed.error.issues[0].message });
});
exports.PublicFormEmailAvailabilityQuerySchema = exports.CrmEmailAvailabilityQuerySchema.omit({ module: true });
exports.EmailAvailabilitySchema = zod_1.z.discriminatedUnion('available', [
    zod_1.z.object({ available: zod_1.z.literal(true) }),
    zod_1.z.object({ available: zod_1.z.literal(false), reason: zod_1.z.enum(['STAFF_EMAIL_NOT_ALLOWED', 'EMAIL_IN_USE', 'EXTERNAL_STAFF_EMAIL_NOT_ALLOWED']) }),
]);
